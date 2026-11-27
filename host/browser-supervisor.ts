/** Own the deadline, worker life and publication boundary for a browser call (RFC-0005, RFC-0007). */

import type { WorkerRequestV1 } from "./browser-worker-protocol.js";
import { BASELINE_LIMITS } from "./limits.js";
import type { FileSnapshot } from "./namespace.js";
import { readNodeReply } from "./node-worker-protocol.js";
import { refusal } from "./replay.js";
import type { Failure, GuestResult } from "./replay.js";

/** The part of a dedicated Worker the supervisor uses; tests substitute their own. */
export type WorkerLike = {
  postMessage(message: WorkerRequestV1, transfer: Transferable[]): void;
  terminate(): void;
  addEventListener(type: "message" | "error" | "messageerror", listener: (event: Event) => void): void;
};

export class BrowserSupervisor {
  readonly #start: () => WorkerLike;
  readonly #now: () => number;
  #requestId = 0;
  #busy = false;

  constructor(options: { start: () => WorkerLike; now?: () => number }) {
    this.#start = options.start;
    this.#now = options.now ?? (() => performance.now());
  }

  /** Run on files already copied by `captureCall`. Their buffers move to the worker and detach here. */
  run(module: WebAssembly.Module, snapshot: FileSnapshot, options: { deadlineMs?: number } = {}): Promise<GuestResult> {
    if (this.#busy) return Promise.resolve(refusal("busy"));
    const deadlineMs = options.deadlineMs ?? BASELINE_LIMITS.deadlineMs;
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > BASELINE_LIMITS.deadlineMs
      || !(module instanceof WebAssembly.Module) || snapshot.argv[0] !== "cp_verify") {
      return Promise.resolve(refusal("invalid-input"));
    }
    const deadline = this.#now() + deadlineMs;
    const request: WorkerRequestV1 = {
      schema: 1, requestId: ++this.#requestId, argv: snapshot.argv, files: snapshot.files, module,
    };
    let worker: WorkerLike;
    try {
      worker = this.#start();
    } catch {
      return Promise.resolve(refusal("worker"));
    }
    this.#busy = true;
    return new Promise(resolve => {
      let decided = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Settle once, stop the worker and discard anything it sends later.
      const settle = (result: GuestResult) => {
        if (decided) return;
        decided = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch { /* The decision is already made. */ }
        this.#busy = false;
        resolve(result);
      };
      const stop = (reason: Failure) => settle(refusal(this.#now() >= deadline ? "timeout" : reason));
      const onTimeout = () => {
        const left = deadline - this.#now();
        if (left <= 0) stop("timeout");
        else timer = setTimeout(onTimeout, Math.ceil(left));
      };
      worker.addEventListener("message", event => {
        if (decided) return;
        const result = readNodeReply((event as MessageEvent<unknown>).data, request);
        if (!result) stop("worker");
        else if (this.#now() >= deadline) stop("timeout");
        else settle(result);
      });
      worker.addEventListener("error", () => stop("worker"));
      worker.addEventListener("messageerror", () => stop("worker"));
      onTimeout();
      if (decided) return;
      try {
        worker.postMessage(request, snapshot.files.map(([, bytes]) => bytes.buffer));
      } catch {
        stop("worker");
      }
    });
  }
}
