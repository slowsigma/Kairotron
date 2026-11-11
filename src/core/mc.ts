import { fork, runPathRange } from "./fold.js";
import { pathSeed, Rng } from "./random.js";
import type { Horizon, Model, Snapshot } from "./types.js";
import { DEFAULT_DAY_COUNT } from "./units.js";

// Monte Carlo mode (milestone 8): deterministic by default — randomness only
// enters through stochastic constants when a run is given a seed. Every path
// is an independent fold of the same model, reproducible from (seed, path),
// which is what makes the web worker pool embarrassingly parallel.

export const DEFAULT_MC_SEED = 1;

export interface MonteCarloSpec {
  readonly paths: number;
  readonly seed?: number | undefined;
  readonly horizon?: Horizon | undefined;
}

export interface MonteCarloResult {
  readonly seed: number;
  readonly paths: number;
  readonly horizon: Horizon;
  readonly timelines: readonly (readonly Snapshot[])[];
}

function checkSpec(spec: MonteCarloSpec): number {
  if (!Number.isInteger(spec.paths) || spec.paths < 1) {
    throw new Error(`Monte Carlo paths must be a whole number >= 1 (got ${spec.paths})`);
  }
  const seed = spec.seed ?? DEFAULT_MC_SEED;
  if (!Number.isInteger(seed)) throw new Error(`Monte Carlo seed must be an integer (got ${seed})`);
  return seed;
}

export function runPaths(model: Model, spec: MonteCarloSpec): MonteCarloResult {
  const seed = checkSpec(spec);
  const horizon = spec.horizon ?? model.horizon;
  if (!horizon) throw new Error("model has no horizon and none was passed to runPaths()");
  return Object.freeze({
    seed,
    paths: spec.paths,
    horizon,
    timelines: runPathRange(model, { seed, from: 0, to: spec.paths, horizon }),
  });
}

// A what-if inside the Monte Carlo: each branch forks from its trunk *path*
// at the same world state, and (fold's replay) continues the same shock
// sequence the trunk would have seen — so a branch vs trunk percentile gap is
// the decision's effect, with the noise held fixed.
export function forkMonteCarlo(
  trunk: MonteCarloResult,
  atT: number,
  model: Model,
  spec: { readonly seed?: number | undefined; readonly horizon?: Horizon | undefined } = {},
): MonteCarloResult {
  if (trunk.timelines.length === 0) {
    throw new Error("forkMonteCarlo requires the trunk's Monte Carlo timelines");
  }
  if (spec.seed !== undefined) {
    if (!Number.isInteger(spec.seed)) {
      throw new Error(`Monte Carlo seed must be an integer (got ${spec.seed})`);
    }
    if (spec.seed !== trunk.seed) {
      throw new Error(
        `forkMonteCarlo continues the trunk's world — seed ${spec.seed} would splice a different ` +
          `shock sequence onto trunk paths drawn with seed ${trunk.seed}. Use the trunk's seed ` +
          `(omit the option) or start a fresh runPaths/fork for a new world.`,
      );
    }
  }
  const seed = trunk.seed;
  const branchHorizon = spec.horizon ?? model.horizon;
  if (!branchHorizon) throw new Error("forked model has no horizon and none was passed in the fork spec");
  const trunkConv = trunk.horizon.convention ?? DEFAULT_DAY_COUNT;
  const branchConv = branchHorizon.convention ?? DEFAULT_DAY_COUNT;
  // fork() inherits the trunk's basis when the branch doesn't declare one, so
  // compare the *effective* basis. Any grid difference makes one draw per
  // branch tick a different world: the remapped prefix is sparse and a tick
  // covers a different duration, so replaying a draw per prefix snapshot no
  // longer matches the trunk's stream.
  const branchBasis = branchHorizon.basis ?? trunk.horizon.basis;
  if (
    branchHorizon.unit !== trunk.horizon.unit ||
    branchConv !== trunkConv ||
    branchBasis !== trunk.horizon.basis
  ) {
    throw new Error(
      `forkMonteCarlo requires the branch to keep the trunk's tick grid for a same-world what-if ` +
        `(trunk: ${trunk.horizon.unit}/${trunkConv}; branch: ${branchHorizon.unit}/${branchConv}). ` +
        `A re-ticked branch is a new random world — use fork() and runPaths() instead.`,
    );
  }
  const branches = trunk.timelines.map(
    (hist, i) =>
      fork(hist, atT, model, {
        ...(spec.horizon === undefined ? {} : { horizon: branchHorizon }),
        rng: new Rng(pathSeed(seed, i)),
      }),
  );
  return Object.freeze({
    seed,
    paths: trunk.timelines.length,
    horizon: branches[0]!.horizon,
    timelines: branches.map((b) => b.snapshots),
  });
}
