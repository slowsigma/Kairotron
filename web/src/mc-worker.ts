// Monte Carlo worker (milestone 8): runs a contiguous path range off the main
// thread. Model code arrives as source and is compiled inside the worker —
// rule closures cannot cross the postMessage boundary — and per-path seeds
// derive from (master seed, path index) in the core, so splitting the range
// never renumbers a stream and results match a single-threaded run exactly.

import { runPathRange } from "../../src/core/fold.js";
import type { Horizon, Snapshot } from "../../src/core/types.js";
import { compileModel } from "./repl.js";

interface McJob {
  readonly id: number;
  readonly code: string;
  readonly seed: number;
  readonly from: number;
  readonly to: number;
  readonly horizon: Horizon;
}

type McResult =
  | { readonly id: number; readonly ok: true; readonly timelines: readonly (readonly Snapshot[])[] }
  | { readonly id: number; readonly ok: false; readonly error: string };

// The worker global: typed narrowly instead of pulling the WebWorker lib in
// alongside DOM (the two declare a conflicting `self`).
const ctx = globalThis as unknown as {
  postMessage: (message: McResult) => void;
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
};

ctx.addEventListener("message", (event: MessageEvent) => {
  const job = event.data as McJob;
  try {
    const compiled = compileModel(job.code);
    const timelines = runPathRange(compiled.model, {
      seed: job.seed,
      from: job.from,
      to: job.to,
      horizon: job.horizon,
    });
    ctx.postMessage({ id: job.id, ok: true, timelines });
  } catch (e) {
    ctx.postMessage({ id: job.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
