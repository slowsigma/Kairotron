import { describe, expect, it } from "vitest";
import { runPathRange } from "../src/core/fold.js";
import { runPaths } from "../src/core/mc.js";
import type { Horizon, Model, Snapshot } from "../src/core/types.js";
import { compileModel } from "../web/src/repl.js";
import { runPathsPool } from "../web/src/mc-pool.js";

// The real Worker is absent under vitest's node environment, so the browser
// pool is exercised through a stub that mirrors web/src/mc-worker.ts's
// protocol (compile the code, fold the range, echo the id back). That covers
// the pool's own logic — range splitting, id routing, ordered merge, seeding
// parity with the single-threaded run, and both error channels.

interface Job {
  id: number;
  code: string;
  seed: number;
  from: number;
  to: number;
  horizon?: Horizon;
}

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  static failJobs = false;

  postMessage(job: Job): void {
    if (FakeWorker.failJobs) {
      queueMicrotask(() => this.onerror?.({ message: "kaboom" }));
      return;
    }
    void Promise.resolve().then(() => {
      try {
        const compiled = compileModel(job.code);
        const timelines = runPathRange(compiled.model, {
          seed: job.seed,
          from: job.from,
          to: job.to,
          ...(job.horizon === undefined ? {} : { horizon: job.horizon }),
        });
        this.onmessage?.({ data: { id: job.id, ok: true, timelines } });
      } catch (e) {
        this.onmessage?.({
          data: { id: job.id, ok: false, error: e instanceof Error ? e.message : String(e) },
        });
      }
    });
  }

  terminate(): void {}
}

const modelCode = `
model({
  horizon: { start: 0, end: 8, unit: "year" },
  constants: { growth: stochastic(pct(6, "year"), normal(pct(18, "year"))) },
  stocks: { fund: 1000 },
  rules: [flow("fund", (c) => c.stocks.fund * c.perTick("growth"), "growth")],
})
`;

const withWorker = async (fn: () => Promise<void>): Promise<void> => {
  const g = globalThis as Record<string, unknown>;
  g.Worker = FakeWorker;
  try {
    await fn();
  } finally {
    delete g.Worker;
    FakeWorker.failJobs = false;
  }
};

describe("web Monte Carlo worker pool", () => {
  it("matches the single-threaded run: same seed, same paths, in order", async () => {
    await withWorker(async () => {
      const model = compileModel(modelCode).model as Model;
      const horizon = model.horizon;
      const pooled = await runPathsPool(model, modelCode, horizon, 40, 9);
      const serial = runPaths(model, { paths: 40, seed: 9 });
      expect(pooled.paths).toBe(40);
      expect(pooled.seed).toBe(9);
      expect(pooled.timelines).toHaveLength(40);
      const last = (h: readonly Snapshot[]): number => h[h.length - 1]!.stocks.fund!;
      expect(pooled.timelines.map(last)).toEqual(serial.timelines.map(last));
    });
  });

  it("honors a horizon override through the worker boundary", async () => {
    await withWorker(async () => {
      const model = compileModel(modelCode).model as Model;
      const horizon: Horizon = { start: 0, end: 4, unit: "year" };
      const pooled = await runPathsPool(model, modelCode, horizon, 17, 3);
      expect(pooled.timelines[0]).toHaveLength(5);
      const serial = runPaths(model, { paths: 17, seed: 3, horizon });
      const last = (h: readonly Snapshot[]): number => h[h.length - 1]!.stocks.fund!;
      expect(pooled.timelines.map(last)).toEqual(serial.timelines.map(last));
    });
  });

  it("surfaces a model error from the worker as a rejection", async () => {
    await withWorker(async () => {
      const model = compileModel(modelCode).model;
      await expect(
        runPathsPool(model, "not a model(", model.horizon, 20, 1),
      ).rejects.toThrow(/model code failed|stochastic|Unexpected/);
    });
  });

  it("rejects pending jobs and drops the pool when a worker dies", async () => {
    FakeWorker.failJobs = true;
    await withWorker(async () => {
      const model = compileModel(modelCode).model;
      await expect(runPathsPool(model, modelCode, model.horizon, 32, 1)).rejects.toThrow(/kaboom/);
    });
    // and the pool heals: the next run (fresh workers) succeeds again
    await withWorker(async () => {
      const model = compileModel(modelCode).model;
      const pooled = await runPathsPool(model, modelCode, model.horizon, 24, 5);
      expect(pooled.timelines).toHaveLength(24);
    });
  });
});
