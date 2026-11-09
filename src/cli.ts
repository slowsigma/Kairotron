#!/usr/bin/env tsx
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
let unit: string | undefined;
let end: number | undefined;
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--csv") csv = true;
  else if (arg === "--flows") flows = true;
  else if (arg === "--unit") {
    unit = args[++i];
    if (!unit) usage(1);
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

if (unit !== undefined && !isTickUnit(unit)) {
  console.error(`unknown tick unit: ${unit}`);
  usage(1);
}

const file = positional[0];
if (!file || positional.length > 1) usage(1);

const mod = (await import(pathToFileURL(resolve(file)).href)) as {
  default?: Model;
};
const model = mod.default;
if (!model || typeof model !== "object" || !Array.isArray(model.rules)) {
  console.error(`${file} must default-export a model (built with model({...}) from src/dsl/model.ts)`);
  process.exit(1);
}

let horizon: Horizon | undefined;
if (unit !== undefined || end !== undefined) {
  horizon = {
    start: model.horizon.start,
    end: end ?? model.horizon.end,
    unit: (unit ?? model.horizon.unit) as TickUnit,
  };
}

const history = run(model, horizon);
console.log(csv ? formatCsv(history) : formatTable(history));
if (flows) {
  console.log("");
  console.log(formatFlows(history));
}
