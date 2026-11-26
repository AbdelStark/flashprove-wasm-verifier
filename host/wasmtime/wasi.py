"""The audited Preview 1 imports for the independent Wasmtime fixture runner."""

from dataclasses import dataclass
import json
from pathlib import Path
import struct
from time import monotonic_ns
from types import MappingProxyType
from typing import Optional, Union

import wasmtime


AUDIT = Path(__file__).resolve().parents[2] / "port/audit.json"
PREVIEW1 = "wasi_snapshot_preview1"
U32_MAX = (1 << 32) - 1
I64_MAX = (1 << 63) - 1
MAX_IOVECS = 1024
MAX_FDS = 1024
U32 = struct.Struct("<I")
U64 = struct.Struct("<Q")
IOVEC = struct.Struct("<II")

# Preview 1 interface values from the pinned SDK's wasi/wasip1.h.
BADF, INVAL, ISDIR, MFILE, NOENT, NOTDIR, NOTSUP, SPIPE, NOTCAPABLE = 8, 28, 31, 33, 44, 54, 58, 70, 76
CHARACTER, DIRECTORY, REGULAR = 2, 3, 4
FD_READ, FD_SEEK, FD_SET_FLAGS, FD_TELL, FD_WRITE = (1 << bit for bit in (1, 2, 3, 5, 6))
PATH_OPEN, PATH_STAT, FD_STAT = (1 << bit for bit in (13, 18, 21))
FILE_RIGHTS = FD_READ | FD_SEEK | FD_TELL | FD_STAT | FD_SET_FLAGS
DIR_RIGHTS = PATH_OPEN | PATH_STAT | FD_STAT


class GuestFault(Exception):
    """A guest violated the host ABI or exceeded its I/O budget."""


class GuestExit(Exception):
    def __init__(self, status):
        self.status = status


class GuestMemory:
    def __init__(self, caller):
        self.caller = caller
        memory = caller.get("memory")
        if not isinstance(memory, wasmtime.Memory):
            raise GuestFault("missing guest memory")
        self.memory = memory
        self.size = memory.data_len(caller)

    def span(self, pointer, length):
        start = pointer & U32_MAX
        if start > self.size or length < 0 or length > self.size - start:
            raise GuestFault("guest memory range")
        return start, length

    def read(self, span):
        start, length = span
        return self.memory.read(self.caller, start, start + length)

    def write(self, start, data):
        if data:
            self.memory.write(self.caller, data, start)

    def iovecs(self, pointer, count):
        if not 0 <= count <= MAX_IOVECS:
            raise GuestFault("guest iovec count")
        entries = self.read(self.span(pointer, count * IOVEC.size))
        spans = [self.span(start, length) for start, length in IOVEC.iter_unpack(entries)]
        if sum(length for _, length in spans) > U32_MAX:
            raise GuestFault("guest iovec length overflow")
        return spans


@dataclass
class Descriptor:
    kind: int
    rights: int
    inheriting: int = 0
    data: Optional[Union[bytes, bytearray]] = None
    path: tuple[bytes, ...] = ()
    position: int = 0


class Wasi:
    def __init__(self, argv, files, *, clock=monotonic_ns, output_limit=8 << 20):
        if not 0 <= output_limit <= U32_MAX:
            raise ValueError("invalid output limit")
        self.argv = tuple(argv)
        if (len(self.argv) > 4096 or any(not isinstance(arg, bytes) or b"\0" in arg for arg in self.argv)
                or sum(len(arg) + 1 for arg in self.argv) > 1 << 20):
            raise ValueError("invalid guest arguments")
        self.arg_bytes = b"".join(arg + b"\0" for arg in self.argv)
        self.files = {}
        self.directories = {()}
        for path, data in files.items():
            if not isinstance(path, bytes) or not isinstance(data, bytes) or not path.startswith(b"/"):
                raise ValueError("guest files require absolute byte paths and immutable bytes")
            path.decode("utf-8", errors="strict")
            components = tuple(path[1:].split(b"/"))
            if b"\0" in path or any(component in (b"", b".", b"..") for component in components):
                raise ValueError("noncanonical guest file path")
            self.files[components] = data
            self.directories.update(components[:i] for i in range(len(components)))
        if self.directories.intersection(self.files):
            raise ValueError("guest file and directory collide")
        self.files = MappingProxyType(self.files)
        self.directories = frozenset(self.directories)
        self.clock = clock
        self.output_limit = output_limit
        self.stdout = bytearray()
        self.stderr = bytearray()
        self.fds = {
            0: Descriptor(CHARACTER, FD_READ | FD_STAT, data=b""),
            1: Descriptor(CHARACTER, FD_WRITE | FD_STAT | FD_SET_FLAGS, data=self.stdout),
            2: Descriptor(CHARACTER, FD_WRITE | FD_STAT | FD_SET_FLAGS, data=self.stderr),
            3: Descriptor(DIRECTORY, DIR_RIGHTS, FILE_RIGHTS | DIR_RIGHTS),
        }

    def link(self, linker, module):
        approved = set(json.loads(AUDIT.read_text())["imports"])
        for entry in module.imports:
            if entry.module != PREVIEW1:
                continue
            if not isinstance(entry.type, wasmtime.FuncType):
                raise GuestFault("non-function WASI import")
            params = ",".join(map(str, entry.type.params))
            results = ",".join(map(str, entry.type.results))
            if f"{PREVIEW1}.{entry.name} ({params})->({results})" not in approved:
                raise GuestFault("unaudited WASI import")
            if entry.name == "proc_exit":
                linker.define_func(PREVIEW1, entry.name, entry.type, self.proc_exit)
            else:
                callback = getattr(self, entry.name, None)
                if not callable(callback):
                    raise GuestFault("unimplemented WASI import")
                linker.define_func(PREVIEW1, entry.name, entry.type,
                                   self.memory_callback(callback), access_caller=True)

    @staticmethod
    def memory_callback(callback):
        def call(caller, *args):
            return callback(GuestMemory(caller), *args)
        return call

    @staticmethod
    def proc_exit(status):
        if not 0 <= status <= 255:
            raise GuestFault("invalid guest exit status")
        raise GuestExit(status)

    def args_sizes_get(self, memory, count_out, size_out):
        count, _ = memory.span(count_out, 4)
        size, _ = memory.span(size_out, 4)
        memory.write(count, U32.pack(len(self.argv)))
        memory.write(size, U32.pack(len(self.arg_bytes)))
        return 0

    def args_get(self, memory, table_pointer, buffer_pointer):
        table, _ = memory.span(table_pointer, 4 * len(self.argv))
        buffer, _ = memory.span(buffer_pointer, len(self.arg_bytes))
        indexes = bytearray()
        position = buffer
        for arg in self.argv:
            indexes.extend(U32.pack(position))
            position += len(arg) + 1
        memory.write(table, indexes)
        memory.write(buffer, self.arg_bytes)
        return 0

    @staticmethod
    def environ_sizes_get(memory, count_out, size_out):
        count, _ = memory.span(count_out, 4)
        size, _ = memory.span(size_out, 4)
        memory.write(count, U32.pack(0))
        memory.write(size, U32.pack(0))
        return 0

    @staticmethod
    def environ_get(memory, table, buffer):
        memory.span(table, 0)
        memory.span(buffer, 0)
        return 0

    @staticmethod
    def random_get(memory, pointer, length):
        return NOTCAPABLE

    def clock_time_get(self, memory, clock_id, precision, pointer):
        if clock_id != 1:
            return NOTSUP
        destination, _ = memory.span(pointer, 8)
        memory.write(destination, U64.pack(self.clock()))
        return 0

    def fd_prestat_get(self, memory, fd, pointer):
        if fd != 3 or fd not in self.fds:
            return BADF
        start, _ = memory.span(pointer, 8)
        memory.write(start, struct.pack("<II", 0, 1))
        return 0

    def fd_prestat_dir_name(self, memory, fd, pointer, length):
        if fd != 3 or fd not in self.fds:
            return BADF
        if length != 1:
            return INVAL
        start, _ = memory.span(pointer, length)
        memory.write(start, b"/")
        return 0

    def resolve(self, memory, fd, pointer, length, flags, right):
        directory = self.fds.get(fd)
        if directory is None:
            return BADF, ()
        if directory.kind != DIRECTORY:
            return NOTDIR, ()
        if not directory.rights & right:
            return NOTCAPABLE, ()
        if flags not in (0, 1):
            return INVAL, ()
        length &= U32_MAX
        if length > 4096:
            return INVAL, ()
        raw = memory.read(memory.span(pointer, length))
        if not raw:
            return NOENT, ()
        if b"\0" in raw:
            return INVAL, ()
        if raw.startswith(b"/"):
            return NOTCAPABLE, ()
        current = directory.path
        for part in raw.split(b"/"):
            if current in self.files:
                return NOTDIR, ()
            if part in (b"", b"."):
                continue
            if part == b"..":
                if len(current) <= len(directory.path):
                    return NOTCAPABLE, ()
                current = current[:-1]
            else:
                current += (bytes(part),)
                if current not in self.directories and current not in self.files:
                    return NOENT, ()
        return 0, current

    def path_open(self, memory, fd, flags, pointer, length, oflags, base, inheriting, fdflags, opened):
        if oflags not in (0, 2) or fdflags:
            return NOTCAPABLE
        error, path = self.resolve(memory, fd, pointer, length, flags, PATH_OPEN)
        if error:
            return error
        if (base | inheriting) & ~self.fds[fd].inheriting:
            return NOTCAPABLE
        fd_out, _ = memory.span(opened, 4)
        if path in self.directories:
            descriptor = Descriptor(DIRECTORY, base & DIR_RIGHTS, inheriting, path=path)
        elif oflags == 2:
            return NOTDIR
        else:
            descriptor = Descriptor(REGULAR, base & FILE_RIGHTS, data=self.files[path], path=path)
        for new_fd in range(4, MAX_FDS):
            if new_fd not in self.fds:
                self.fds[new_fd] = descriptor
                memory.write(fd_out, U32.pack(new_fd))
                return 0
        return MFILE

    @staticmethod
    def filestat(memory, pointer, filetype, size):
        start, _ = memory.span(pointer, 64)
        memory.write(start, struct.pack("<QQB7xQQQQQ", 0, 0, filetype, 1, size, 0, 0, 0))
        return 0

    def path_filestat_get(self, memory, fd, flags, pointer, length, out):
        error, path = self.resolve(memory, fd, pointer, length, flags, PATH_STAT)
        if error:
            return error
        file = self.files.get(path)
        return self.filestat(memory, out, DIRECTORY if file is None else REGULAR, 0 if file is None else len(file))

    def fd_filestat_get(self, memory, fd, pointer):
        entry = self.fds.get(fd)
        if entry is None:
            return BADF
        if not entry.rights & FD_STAT:
            return NOTCAPABLE
        return self.filestat(memory, pointer, entry.kind, len(entry.data) if entry.kind == REGULAR else 0)

    def fd_fdstat_get(self, memory, fd, pointer):
        entry = self.fds.get(fd)
        if entry is None:
            return BADF
        start, _ = memory.span(pointer, 24)
        memory.write(start, struct.pack("<B1xH4xQQ", entry.kind, 0, entry.rights, entry.inheriting))
        return 0

    def fd_fdstat_set_flags(self, memory, fd, flags):
        entry = self.fds.get(fd)
        if entry is None:
            return BADF
        return NOTCAPABLE if flags or not entry.rights & FD_SET_FLAGS else 0

    def fd_close(self, memory, fd):
        return BADF if self.fds.pop(fd, None) is None else 0

    def fd_seek(self, memory, fd, offset, whence, pointer):
        entry = self.fds.get(fd)
        if entry is None:
            return BADF
        if entry.kind != REGULAR:
            return SPIPE
        if not entry.rights & FD_SEEK:
            return NOTCAPABLE
        if not 0 <= whence <= 2:
            return INVAL
        position = (0, entry.position, len(entry.data))[whence] + offset
        if not 0 <= position <= I64_MAX:
            return INVAL
        start, _ = memory.span(pointer, 8)
        memory.write(start, U64.pack(position))
        entry.position = position
        return 0

    def read_from(self, memory, fd, vectors, count, pointer, offset):
        entry = self.fds.get(fd)
        if entry is None:
            return BADF
        if entry.kind == DIRECTORY:
            return ISDIR
        if not entry.rights & FD_READ:
            return NOTCAPABLE
        if offset is not None and not 0 <= offset <= I64_MAX:
            return INVAL
        if offset is not None and entry.kind != REGULAR:
            return SPIPE
        start, _ = memory.span(pointer, 4)
        spans = memory.iovecs(vectors, count)
        position = entry.position if offset is None else offset
        transferred = 0
        for destination, length in spans:
            data = entry.data[position:position + length]
            memory.write(destination, data)
            position += len(data)
            transferred += len(data)
        memory.write(start, U32.pack(transferred))
        if offset is None:
            entry.position = position
        return 0

    def fd_read(self, memory, fd, vectors, count, pointer):
        return self.read_from(memory, fd, vectors, count, pointer, None)

    def fd_pread(self, memory, fd, vectors, count, offset, pointer):
        return self.read_from(memory, fd, vectors, count, pointer, offset)

    def fd_write(self, memory, fd, vectors, count, pointer):
        entry = self.fds.get(fd)
        if entry is None:
            return BADF
        if not entry.rights & FD_WRITE:
            return NOTCAPABLE
        start, _ = memory.span(pointer, 4)
        spans = memory.iovecs(vectors, count)
        size = sum(length for _, length in spans)
        if size > self.output_limit - len(self.stdout) - len(self.stderr):
            raise GuestFault("guest output limit")
        for span in spans:
            entry.data.extend(memory.read(span))
        memory.write(start, U32.pack(size))
        return 0
