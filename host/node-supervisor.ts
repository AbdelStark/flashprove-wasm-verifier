/** Own the deadline, worker life and publication boundary for a Node call. */

import { cwd } from "node:process";
import { Worker } from "node:worker_threads";
import { buildDiagnostic, elapsedNs, readInstanceDiagnostics } from "./diagnostics.js";
import type { DiagnosticsSink, DiagnosticsV1 } from "./diagnostics.js";
import { BASELINE_LIMITS } from "./limits.js";
import { captureArguments, InputError } from "./namespace.js";
import { readNodeReply } from "./node-worker-protocol.js";
import type { NodeWorkerReply, NodeWorkerRequest } from "./node-worker-protocol.js";
import { refusal } from "./replay.js";
import type { Failure, GuestResult } from "./replay.js";

type WorkerConnection = Pick<Worker, "on" | "once" | "postMessage" | "terminate" | "unref">;

function startWorker(): WorkerConnection {
  const worker = new Worker(new URL("./node-worker.js", import.meta.url), {
    execArgv: [], env: {}, stdout: true, stderr: true,
  });
  worker.stdout.resume();
  worker.stderr.resume();
  return worker;
}

export class NodeSupervisor {
  readonly #start: () => WorkerConnection;
  readonly #now: () => number;
  #requestId = 0;
  #busy = false;

  constructor(options: { start?: () => WorkerConnection; now?: () => number } = {}) {
    this.#start = options.start ?? startWorker;
    this.#now = options.now ?? (() => performance.now());
  }

  async run(module: WebAssembly.Module, args: readonly string[],
            options: { deadlineMs?: number; workingDirectory?: string; diagnostics?: DiagnosticsSink } = {}): Promise<GuestResult> {
    const sink = options.diagnostics;
    const began = sink ? performance.now() : undefined;
    const report = (result: GuestResult, workerDiagnostics?: unknown): GuestResult => {
      if (!sink || began === undefined) return result;
      const elapsed = elapsedNs(began);
      const failure = result.failure;
      queueMicrotask(() => {
        const events: DiagnosticsV1[] = [];
        const provenance = buildDiagnostic(module);
        if (provenance) events.push(provenance);
        events.push(...readInstanceDiagnostics(workerDiagnostics),
          { schema: 1, phase: "call", code: "elapsed", elapsedNs: elapsed });
        if (failure) {
          const admission = failure === "busy" || failure === "invalid-input" || failure === "input-limit";
          events.push({ schema: 1, phase: admission ? "admission" : "call", code: failure });
        }
        for (const event of events) {
          try { void Promise.resolve(sink(event)).catch(() => {}); } catch { /* The result is already decided. */ }
        }
      });
      return result;
    };
    if (this.#busy) return report(refusal("busy"));
    this.#busy = true;
    let worker: WorkerConnection;
    let request: NodeWorkerRequest;
    let deadline: number;
    try {
      const start = this.#now();
      const deadlineMs = options.deadlineMs ?? BASELINE_LIMITS.deadlineMs;
      if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > BASELINE_LIMITS.deadlineMs) {
        throw new InputError("invalid-input");
      }
      deadline = start + deadlineMs;
      if (!(module instanceof WebAssembly.Module)) throw new InputError("invalid-input");
      request = {
        schema: 1, requestId: ++this.#requestId, module,
        argv: captureArguments(args, "cp_verify"), workingDirectory: options.workingDirectory ?? cwd(),
        ...(sink ? { diagnostics: true } : {}),
      };
      if (this.#now() >= deadline) {
        this.#busy = false;
        return report(refusal("timeout"));
      }
      worker = this.#start();
    } catch (error) {
      this.#busy = false;
      return report(refusal(error instanceof InputError ? error.code : "worker"));
    }
    return new Promise(resolve => {
      let result: GuestResult | undefined;
      let workerDiagnostics: unknown;
      let decided = false;
      let timer: ReturnType<typeof setTimeout>;

      const settle = (terminal: GuestResult) => {
        if (decided) return;
        decided = true;
        clearTimeout(timer);
        resolve(terminal);
        report(terminal, terminal === result ? workerDiagnostics : undefined);
      };
      const stop = (reason: Failure) => {
        if (decided) return;
        result = undefined;
        settle(refusal(reason));
        try {
          void worker.terminate().catch(() => {
            // The slot remains held until the worker actually stops.
          });
          worker.unref();
        } catch {
          // An unconfirmed teardown keeps admission closed.
        }
      };
      const expired = () => this.#now() >= deadline;
      const onTimeout = () => {
        const left = deadline - this.#now();
        if (left <= 0) stop("timeout");
        else timer = setTimeout(onTimeout, Math.ceil(left));
      };
      const deliveryFailure = () => stop(expired() ? "timeout" : "worker");

      worker.on("message", (value: unknown) => {
        if (decided) return;
        if (expired()) {
          stop("timeout");
          return;
        }
        if (result) {
          stop("worker");
          return;
        }
        result = readNodeReply(value, request);
        if (!result) {
          stop("worker");
        } else if (sink) {
          workerDiagnostics = (value as NodeWorkerReply).diagnostics;
        }
      });
      worker.once("messageerror", deliveryFailure);
      worker.once("error", deliveryFailure);
      worker.once("exit", code => {
        this.#busy = false;
        if (!decided) settle(expired() ? refusal("timeout") : code === 0 && result ? result : refusal("worker"));
      });

      onTimeout();
      if (!decided) {
        try {
          worker.postMessage(request);
        } catch {
          deliveryFailure();
        }
      }
    });
  }
}
