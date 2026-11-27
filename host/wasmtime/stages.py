"""Bounded ordinal replay for the independent Wasmtime adapter."""

from dataclasses import dataclass
from hashlib import sha256
import json
import struct
from threading import Lock
from time import monotonic_ns

import wasmtime

from .wasi import (
    AUDIT, FD_READ, FD_WRITE, MAX_FDS, U32, U64, Descriptor, GuestExit, GuestFault, GuestMemory, Wasi,
)


PORT = "fpv_port"
FAILED = b"NOT CHECKED: internal-stage\n"
PIPE_TYPE = 0  # Preview 1 has no dedicated pipe file type.
MAX_PAGES = 57344
PARENT_PAGES = 9216
_active = Lock()  # Wasmtime's Python callbacks share exception state within the process.


class Journal:
    def __init__(self):
        self.hash = sha256()

    def add(self, tag, *fields):
        for field in (tag, *fields):
            if isinstance(field, int):
                self.hash.update(b"I" + U64.pack(field & ((1 << 64) - 1)))
            else:
                self.hash.update(b"B" + U64.pack(len(field)))
                self.hash.update(field)

    def digest(self):
        return self.hash.digest()


class RecordedMemory(GuestMemory):
    def __init__(self, caller, journal):
        super().__init__(caller)
        self.journal = journal

    def read(self, span):
        data = super().read(span)
        self.journal.add(b"read", *span, data)
        return data

    def write(self, start, data):
        super().write(start, data)
        self.journal.add(b"write", start, data)


@dataclass(frozen=True)
class ForkRecord:
    ordinal: int
    argv_digest: bytes
    file_view_digest: bytes
    observation_digest: bytes


@dataclass(frozen=True)
class Result:
    status: int
    stdout: bytes
    stderr: bytes


class ProcessHost(Wasi):
    def __init__(self, runner, argv, files, *, expected=None, replay_clock=(), output_limit=8 << 20, stages=1):
        super().__init__(argv, files, clock=self.tick, output_limit=output_limit)
        self.runner = runner
        self.expected = expected
        self.replay_clock = replay_clock
        self.times = []
        self.stages = stages
        self.forks = 0
        self.recording = True
        self.journal = Journal()
        self.pending = None
        self.redirect_fd = None
        self.pipe_data = bytearray()
        self.redirected = False
        self.wait_words = {}
        self.fault = False
        self.replays = []

    def tick(self):
        if not self.recording:
            return self.runner.clock()
        if self.expected is None:
            value = self.runner.clock()
        elif len(self.times) < len(self.replay_clock):
            value = self.replay_clock[len(self.times)]
        else:
            raise GuestFault("replay clock mismatch")
        self.times.append(value)
        return value

    def memory_callback(self, callback):
        ordinary = super().memory_callback(callback)

        def call(caller, *args):
            if not self.recording:
                return ordinary(caller, *args)
            self.journal.add(b"call", callback.__name__.encode(), *args)
            result = callback(RecordedMemory(caller, self.journal), *args)
            self.journal.add(b"reply", result)
            return result
        return call

    def link(self, linker, module):
        super().link(linker, module)
        approved = set(json.loads(AUDIT.read_text())["imports"])
        callbacks = {"abi_version": self.abi_version, "pipe": self.pipe, "fork": self.fork,
                     "dup2": self.dup2, "waitpid": self.waitpid}
        for entry in module.imports:
            if entry.module != PORT:
                continue
            if not isinstance(entry.type, wasmtime.FuncType):
                raise GuestFault("non-function process import")
            params = ",".join(map(str, entry.type.params))
            results = ",".join(map(str, entry.type.results))
            if entry.name not in callbacks or f"{PORT}.{entry.name} ({params})->({results})" not in approved:
                raise GuestFault("unaudited process import")
            linker.define_func(PORT, entry.name, entry.type,
                               self.memory_callback(callbacks[entry.name]), access_caller=True)

    @staticmethod
    def abi_version(memory):
        return 1

    def pipe(self, memory, pointer):
        if self.fault or not self.recording or self.pending is not None:
            raise GuestFault("unexpected stage pipe")
        destination, _ = memory.span(pointer, 8)
        free = (fd for fd in range(4, MAX_FDS) if fd not in self.fds)
        read_fd, write_fd = next(free, None), next(free, None)
        if write_fd is None:
            raise GuestFault("guest descriptor limit")
        data = bytearray()
        self.fds[read_fd] = Descriptor(PIPE_TYPE, FD_READ, data=data)
        self.fds[write_fd] = Descriptor(PIPE_TYPE, FD_WRITE, data=data)
        self.pending = read_fd, write_fd
        memory.write(destination, struct.pack("<II", read_fd, write_fd))
        return 0

    def fork_record(self, ordinal):
        argv, files = Journal(), Journal()
        argv.add(b"argv", *self.argv)
        for path, data in sorted(self.files.items()):
            files.add(b"file", b"/" + b"/".join(path), data)
        return ForkRecord(ordinal, argv.digest(), files.digest(), self.journal.digest())

    def fork(self, memory):
        if not self.recording or self.pending is None or any(fd not in self.fds for fd in self.pending):
            raise GuestFault("invalid fork sequence")
        read_fd, write_fd = self.pending
        self.pending = None
        ordinal = self.forks
        self.forks += 1
        pid = self.forks
        if self.expected is not None and ordinal < self.expected.ordinal:
            return pid
        record = self.fork_record(ordinal)
        if self.expected is not None:
            if record != self.expected or len(self.times) != len(self.replay_clock):
                raise GuestFault("fork replay mismatch")
            self.recording = False
            self.redirect_fd = write_fd
            self.pipe_data = self.fds[write_fd].data
            self.stdout.clear()
            self.stderr.clear()
            self.written = 0
            return 0

        self.recording = self.forks < self.stages
        try:
            child = ProcessHost(self.runner, self.argv,
                                {b"/" + b"/".join(path): data for path, data in self.files.items()},
                                expected=record, replay_clock=tuple(self.times),
                                output_limit=self.output_limit - self.written, stages=self.stages)
            status = self.runner.start(child)
            if child.recording or not child.redirected:
                raise GuestFault("child ended before replay or redirect")
            # Child stores are closed by start(). Only pipe bytes, stderr and status survive.
            for fd in (read_fd, write_fd):
                self.fds[fd].data = child.pipe_data
            self.stderr.extend(child.stderr)
            self.written += len(child.pipe_data) + len(child.stderr)
            self.wait_words[pid] = status << 8
            # The pinned child's top-level allocation and thread exceptions exit 5.
            self.fault |= status == 5
            self.replays.append({"ordinal": ordinal, "observationSha256": record.observation_digest.hex(),
                                 "replayedClockReads": len(self.times), "childStatus": status,
                                 "pipeBytes": len(child.pipe_data)})
        except Exception:
            self.wait_words[pid] = 6
            self.fault = True
        return pid

    def dup2(self, memory, old_fd, new_fd):
        if (self.expected is None or self.recording or self.redirected
                or old_fd != self.redirect_fd or new_fd != 1 or old_fd not in self.fds):
            raise GuestFault("invalid child stdout redirect")
        self.fds[new_fd] = self.fds[old_fd]
        self.redirected = True
        return new_fd

    def waitpid(self, memory, pid, pointer, flags):
        if self.expected is not None or flags != 0 or pid not in self.wait_words:
            raise GuestFault("invalid waitpid sequence")
        destination, _ = memory.span(pointer, 4)
        memory.write(destination, U32.pack(self.wait_words.pop(pid)))
        return pid


class PartRunner:
    def __init__(self, module_path, *, clock=monotonic_ns, max_pages=MAX_PAGES, parent_pages=None, observe=None):
        self.parent_pages = min(max_pages, PARENT_PAGES) if parent_pages is None else parent_pages
        if not all(1 <= pages <= MAX_PAGES for pages in (max_pages, self.parent_pages)):
            raise ValueError("invalid Wasmtime page limit")
        config = wasmtime.Config()
        config.wasm_exceptions = True
        config.wasm_threads = False
        config.wasm_relaxed_simd = False
        self.engine = wasmtime.Engine(config)
        self.module = wasmtime.Module.from_file(self.engine, module_path)
        self.clock = clock
        self.max_pages = max_pages
        self.observe = observe

    def start(self, host):
        with wasmtime.Store(self.engine) as store, wasmtime.Linker(self.engine) as linker:
            runs_stage = host.expected is not None or host.argv[1:2] == (b"-plan",)
            pages = self.max_pages if runs_stage else self.parent_pages
            store.set_limits(memory_size=pages << 16, instances=1, memories=1)
            host.link(linker, self.module)
            if self.observe is not None:
                self.observe(host.expected, "before", 0)
            instance = linker.instantiate(store, self.module)
            exports = instance.exports(store)
            configure = exports.get("fpv_set_memory_limit")
            if configure is not None and configure(store, pages) != 0:
                raise GuestFault("guest memory limit setup failed")
            if self.observe is not None:
                self.observe(host.expected, "start", exports["memory"].size(store))
            try:
                exports["_start"](store)
            except GuestExit as exit_:
                return exit_.status
            finally:
                if self.observe is not None:
                    self.observe(host.expected, "end", exports["memory"].size(store))
            return 0

    def run(self, argv, files):
        if len(argv) < 2 or argv[1] not in (b"-key", b"-leaf", b"-plan"):
            return Result(5, FAILED, b"")
        return self._run(argv, files, stages=1)

    def run_whole(self, argv, files, evidence=None):
        """A whole call: the parent and its three serial stages, each child replayed in a fresh store."""
        if len(argv) < 2 or argv[1] in (b"-key", b"-leaf", b"-plan"):
            return Result(5, FAILED, b"")
        return self._run(argv, files, stages=3, evidence=evidence)

    def _run(self, argv, files, *, stages, evidence=None):
        if not _active.acquire(blocking=False):
            return Result(5, FAILED, b"")
        try:
            host = ProcessHost(self, argv, files, stages=stages)
            status = self.start(host)
            if evidence is not None:
                evidence.extend(host.replays)
            if host.fault or (status in (0, 3, 14) and (host.forks != stages or host.wait_words or host.pending)):
                return Result(5, FAILED, b"")
            return Result(status, bytes(host.stdout), bytes(host.stderr))
        except Exception:
            return Result(5, FAILED, b"")
        finally:
            _active.release()
