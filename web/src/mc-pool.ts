// Worker pool for Monte Carlo path folds (milestone 8). Workers are created
// lazily, reused across runs, and fed contiguous path-range chunks — seeds
// are (master seed, path index) per core/mc.ts, so the split never changes
// a single path's draws. Environments without Worker (tests under jsdom,
// tiny path counts) fall back to a sequential fold on the main thread.

import { runPathRange } from "../../src/core/fold.js";
import type { MonteCarloResult } from "../../src/core/mc.js";
import type { Horizon, Model, Snapshot } from "../../src/core/types.js";

type McResult =
  | { readonly id: number; readonly ok: true; readonly timelines: readonly (readonly Snapshot[])[] }
  | { readonly id: number; readonly ok: false; readonly error: string };

const POOL_MAX = 8;
const POOL_MIN_PATHS = 16;

let nextJobId = 1;
let pool: Worker[] = [];
const pending = new Map<number, { resolve: (t: readonly (readonly Snapshot[])[]) => void; reject: (e: Error) => void }>();

function spawnWorker(): Worker {
  const worker = new Worker(new URL("./mc-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent) => {
    const result = event.data as McResult;
    const job = pending.get(result.id);
    if (!job) return;
    pending.delete(result.id);
    if (result.ok) job.resolve(result.timelines);
    else job.reject(new Error(result.error));
  };
  worker.onerror = (event: ErrorEvent) => {
    // A dead worker takes every job it owns down with it; drop the whole
    // pool so the next run spawns a clean one.
    pool = pool.filter((w) => w !== worker);
    worker.terminate();
    for (const [, job] of pending) job.reject(new Error(event.message || "Monte Carlo worker failed"));
    pending.clear();
  };
  return worker;
}

export function canPool(paths: number): boolean {
  return typeof Worker === "function" && paths >= POOL_MIN_PATHS;
}

export async function runPathsPool(
  model: Model,
  code: string,
  horizon: Horizon,
  paths: number,
  seed: number,
): Promise<MonteCarloResult> {
  if (!canPool(paths)) {
    return Object.freeze({
      seed,
      paths,
      horizon,
      timelines: runPathRange(model, { seed, from: 0, to: paths, horizon }),
    });
  }
  const cores = (typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency) ?? 4;
  const workerCount = Math.max(1, Math.min(cores, POOL_MAX, paths));
  while (pool.length < workerCount) pool.push(spawnWorker());

  const per = Math.ceil(paths / workerCount);
  const jobs: Promise<readonly (readonly Snapshot[])[]>[] = [];
  let slot = 0;
  for (let from = 0; from < paths; from += per) {
    const to = Math.min(paths, from + per);
    const id = nextJobId++;
    const worker = pool[slot++]!;
    jobs.push(
      new Promise<readonly (readonly Snapshot[])[]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, code, seed, from, to, horizon });
      }),
    );
  }
  const slices = await Promise.all(jobs);
  return Object.freeze({
    seed,
    paths,
    horizon,
    timelines: Object.freeze(slices.flat()),
  });
}
