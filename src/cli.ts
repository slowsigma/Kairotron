#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { run } from "./core/fold.js";
import { isTickUnit } from "./core/units.js";
import type { Horizon, Model, TickUnit } from "./core/types.js";
import { formatCsv, formatFlows, formatTable } from "./outputs/table.js";

function usage(code: number): never {
  console.error(
    [
      "usage: kairotron <model.ts> [options]",
      "",
      "options:",
      "  --csv            print CSV instead of the table",
      "  --flows          also print per-tick deltas with rule provenance",
      "  --unit <unit>    override the tick unit (re-normalizes rates)",
      "  --end <n>        override the horizon end tick",
      "",
      `units: second, minute, hour, day, week, month, quarter, year`,
    ].join("\n"),
  );
  process.exit(code);
}

const args = process.argv.slice(2);
let csv = false;
let flows = false;
let unitOverride: TickUnit | undefined;
let end: number | undefined;
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--csv") csv = true;
  else if (arg === "--flows") flows = true;
  else if (arg === "--unit") {
    const value = args[++i];
    if (!value) usage(1);
    if (!isTickUnit(value)) {
      console.error(`unknown tick unit: ${value}`);
      usage(1);
    }
    unitOverride = value;
  } else if (arg === "--end") {
    const raw = args[++i];
    end = raw === undefined ? Number.NaN : Number(raw);
    if (!Number.isInteger(end)) usage(1);
  } else if (arg === "-h" || arg === "--help") usage(0);
  else if (arg.startsWith("-")) {
    console.error(`unknown option: ${arg}`);
    usage(1);
  } else positional.push(arg);
}

const file = positional[0];
if (!file || positional.length > 1) usage(1);

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

const mod = (await importModel(file)) as { default?: Model };
const model = mod.default;
if (!model || typeof model !== "object" || !Array.isArray(model.rules)) {
  console.error(`${file} must default-export a model (built with model({...}) from src/dsl/model.ts)`);
  process.exit(1);
}

let horizon: Horizon | undefined;
if (unitOverride !== undefined || end !== undefined) {
  horizon = {
    start: model.horizon.start,
    end: end ?? model.horizon.end,
    unit: unitOverride ?? model.horizon.unit,
  };
}

const history = run(model, horizon);
console.log(csv ? formatCsv(history) : formatTable(history));
if (flows) {
  console.log("");
  console.log(formatFlows(history));
}
