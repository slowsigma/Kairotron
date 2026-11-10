#!/usr/bin/env node
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fork, run } from "./core/fold.js";
import { DAY_COUNTS, isDayCount, isTickUnit, retickHorizon } from "./core/units.js";
import type { Branch, DayCount, Horizon, Model, TickUnit } from "./core/types.js";
import { formatCsv, formatDiff, formatFlows, formatTable } from "./outputs/table.js";

function usage(code: number): never {
  console.error(
    [
      "usage: kairotron <model.ts> [options]",
      "",
      "options:",
      "  --csv            print CSV instead of the table",
      "  --flows          also print per-tick deltas with rule provenance",
      "  --unit <unit>    re-tick the horizon to a new unit (duration-preserving,",
      "                   rates re-normalized; --end overrides the converted end)",
      "  --convention <c> day-count convention for unit conversions",
      `                   (${DAY_COUNTS.join(", ")}; default abstract)`,
      "  --end <n>        override the horizon end tick",
      "  --fork-at <t>    fork a what-if branch at tick t (from <variant>)",
      "  --variant <file> model file the branch continues with",
      "  --diff           also print the branch's per-tick delta vs the trunk",
      "",
      `units: second, minute, hour, day, week, month, quarter, year`,
    ].join("\n"),
  );
  process.exit(code);
}

const args = process.argv.slice(2);
let csv = false;
let flows = false;
let diff = false;
let unitOverride: TickUnit | undefined;
let conventionOverride: DayCount | undefined;
let end: number | undefined;
let forkAt: number | undefined;
let variantFile: string | undefined;
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--csv") csv = true;
  else if (arg === "--flows") flows = true;
  else if (arg === "--diff") diff = true;
  else if (arg === "--unit") {
    const value = args[++i];
    if (!value) usage(1);
    if (!isTickUnit(value)) {
      console.error(`unknown tick unit: ${value}`);
      usage(1);
    }
    unitOverride = value;
  } else if (arg === "--convention") {
    const value = args[++i];
    if (!value || !isDayCount(value)) {
      console.error(`unknown day-count convention: ${value ?? "(missing)"} (expected ${DAY_COUNTS.join(", ")})`);
      usage(1);
    }
    conventionOverride = value;
  } else if (arg === "--end") {
    const raw = args[++i];
    end = raw === undefined ? Number.NaN : Number(raw);
    if (!Number.isInteger(end)) usage(1);
  } else if (arg === "--fork-at") {
    const raw = args[++i];
    forkAt = raw === undefined ? Number.NaN : Number(raw);
    if (!Number.isInteger(forkAt)) usage(1);
  } else if (arg === "--variant") {
    variantFile = args[++i];
    if (!variantFile) usage(1);
  } else if (arg === "-h" || arg === "--help") usage(0);
  else if (arg.startsWith("-")) {
    console.error(`unknown option: ${arg}`);
    usage(1);
  } else positional.push(arg);
}

const file = positional[0];
if (!file || positional.length > 1) usage(1);
if (forkAt !== undefined && !variantFile) {
  console.error("--fork-at requires --variant (the model the branch continues with)");
  usage(1);
}

// Load the user's model file. Models are TypeScript imports deep, so the
// loading process needs a TS loader. Under tsx (the dev flow) hooks are
// already active and register() is a no-op to be safe about duplication; the
// compiled bin runs under plain node, so we register tsx's ESM hook first
// (registering after a failed import doesn't work — the failure is cached).
async function importModel(file: string): Promise<{ default?: Model }> {
  const href = pathToFileURL(resolve(file)).href;
  let loaderAvailable = false;
  try {
    const { register } = await import("tsx/esm/api");
    register();
    loaderAvailable = true;
  } catch {
    // tsx is not installed; fall through to a plain import (works for JS models).
  }
  try {
    return await import(href);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const code = (err as NodeJS.ErrnoException).code;
    if (!loaderAvailable && (code === "ERR_MODULE_NOT_FOUND" || code === "ERR_UNKNOWN_FILE_EXTENSION")) {
      throw new Error(
        `cannot load '${file}': no TypeScript loader available (install tsx, or run via npx tsx src/cli.ts)`,
        { cause: err },
      );
    }
    throw err;
  }
}

async function loadModel(file: string): Promise<Model> {
  const mod = (await importModel(file)) as { default?: Model };
  const model = mod.default;
  if (!model || typeof model !== "object" || !Array.isArray(model.rules)) {
    console.error(`${file} must default-export a model (built with model({...}) from src/dsl/model.ts)`);
    process.exit(1);
  }
  return model;
}

const model = await loadModel(file);

// Re-ticking preserves the horizon's duration: 0..12 monthly ticks re-express
// as 0..1 yearly tick, and rates re-normalize. --end (in the new unit) opts
// out for the end bound; --convention overrides the model's day count.
let horizon: Horizon | undefined;
if (unitOverride !== undefined || end !== undefined || conventionOverride !== undefined) {
  try {
    horizon = retickHorizon(
      { ...model.horizon, convention: conventionOverride ?? model.horizon.convention },
      unitOverride ?? model.horizon.unit,
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  if (end !== undefined) horizon = { ...horizon, end };
}

const history = run(model, horizon);
console.log(csv ? formatCsv(history) : formatTable(history));
if (flows) {
  console.log("");
  console.log(formatFlows(history));
}

// Branches & what-if: the trunk is final; the variant model continues from
// the snapshot at --fork-at, sharing the prefix for free. The variant's own
// horizon sets the branch end, so a what-if can run longer than the trunk.
if (forkAt !== undefined) {
  const variant = await loadModel(variantFile!);
  let branch: Branch;
  try {
    branch = fork(history, forkAt, variant, { label: basename(variantFile!) });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  console.log("");
  const forkNote =
    branch.forkTBranch === forkAt
      ? `forked at t=${forkAt}`
      : `forked at t=${forkAt} (= t=${branch.forkTBranch} ${branch.horizon.unit})`;
  console.log(`branch '${basename(variantFile!)}' — ${forkNote}`);
  console.log(formatTable(branch.snapshots));
  if (flows) {
    console.log("");
    // The branch's own fork tick, not the trunk's, since a re-ticked branch
    // shares a sparse prefix whose earlier moments are trunk history.
    console.log(formatFlows(branch.snapshots.filter((s) => s.t >= branch.forkTBranch)));
  }
  if (diff) {
    console.log("");
    console.log(`Δ vs trunk (branch − trunk)`);
    console.log(formatDiff(history, branch));
  }
}
