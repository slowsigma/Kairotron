# Contributing

## Repo layout

```text
src/
  core/     types, fold runner, units/day-counts, calendar overlay,
            seeded PRNG, Monte Carlo — pure, embeddable, no UI
  dsl/      model() builder + rule constructors + provenance capture (model.ts)
            and the sugar front end mini()/miniDerived() (mini.ts)
  outputs/  table / CSV / flows / diff / percentile renderers
  cli.ts    the CLI (flags, model loading, orchestration)
  index.ts  the package barrel (everything re-exported)
web/        browser REPL — Vite + vanilla TS, zero runtime deps
  src/repl.ts       model code via new Function + line-offset calibration
  src/chart.ts      stacked areas, bands, Δ-pane, calendar axes
  src/mc-pool.ts    Vite module-worker path pool (+ sequential fallback)
  src/share.ts      ?m= session codec (deflate-raw + base64url, j-prefixed fallback)
  src/scenarios.ts  scenario sets store (StorageLike injected → no DOM in tests)
bin/        compiled CLI (tsc -p tsconfig.bin.json; gitignored, built for publish)
examples/   exemplar models across four domains
test/       vitest suite (engine numerics, CLI outputs, REPL compile, jsdom UI)
docs/       this site (VitePress) + plan.md, Concept-Search.md, time-varying-values.md
```

## The purity boundary

`src/core/` and `src/dsl/` depend on nothing but the language: no DOM, no
Node APIs beyond pure computation, no `Date.now()`, no `Math.random()`, no
domain vocabulary ("stock"/"rule"/"tick" are the only nouns, and they're
user-facing ones). Consequences you must not break:

- The same modules run under Node (CLI), the browser tab, and the module
  worker — and produce bit-identical histories (enforced by the worker-pool
  and jsdom tests).
- All engine output is `Object.freeze`d (null-prototype where user names are
  keys); internals rely on it.
- Randomness enters only through the seeded `Rng` passed into a fold.

The UI lives in `web/`, the CLI in `src/cli.ts`; the engine never learns
either exists.

## Commands

```bash
npm run typecheck   # tsc for src+test and for web (two projects)
npm test            # vitest run (engine numerics → jsdom UI)
npm run dev         # browser REPL (Vite)
npm run build       # static REPL bundle
npm run build:bin   # compile the CLI to bin/
npm run docs:dev / docs:build / docs:preview   # this site
npm run docs:check  # docs build (dead-link check included) + runnable examples
```

## Test strategy

Plain vitest, no fixtures directory — models are built (or imported from
`examples/`) in the tests themselves.

- **Numerics against hand-rolled loops**: every exemplar model is refolded
  as a naive `for`-loop in `test/examples.test.ts` and compared tick-by-tick.
  New engine behavior needs the same style — a model + independent arithmetic,
  not snapshot-only assertions.
- **Unit areas**: fold/units/calendar/gating/derived/fork/renorm/mc, plus
  `table.test.ts` for every formatter shape.
- **UI smoke under jsdom**: `ui-smoke`, `ui-branches`, `ui-mc`, `ui-share`,
  `ui-scenarios` drive `web/src/main.ts` through the DOM ids in
  `web/index.html` (the share codec, pool protocol, and scenario store have
  their own pure-module tests with a stubbed `Worker`/`StorageLike`).
- Tests must stay deterministic: fixed seeds, no wall-clock, no network.

## Adding a DSL construct

The checklist a `flow`-shaped addition touches:

1. **Types** (`src/core/types.ts`) — a new `Rule` member or context field;
   keep the union closed and the contexts `Readonly`.
2. **Fold semantics** (`src/core/fold.ts`) — evaluate it in `applyRule` (or
   the context builders); write deltas through the same path so provenance
   flows automatically. Guard against non-finite amounts like the rest do.
3. **Constructor** (`src/dsl/model.ts`) — capture a `loc` with
   `captureLoc(1)` like `flow()` does; validate eagerly with an error that
   names the offending value.
4. **Sugar** (optional, `src/dsl/mini.ts`) — grammar tokens, parse in the
   right precedence tier, emit through the same constructor so
   `locAt()` maps block-relative lines to host lines.
5. **Validation** — extend `stockRefs()` so unknown-stock checks see the new
   rule's targets.
6. **Tests** — fold numerics vs a hand loop; add to an exemplar rather than
   inventing a toy, and extend `examples.test.ts`'s loop if you touch fold
   semantics.
7. **Docs** — the [DSL reference](/reference/dsl), the cookbook if it earns a
   recipe, and the troubleshooting catalog if it introduces an error string.

## Provenance and line mapping

`captureLoc()` parses `new Error().stack` — tolerant of V8
(`at name (/path:17:5)` behind a header line), Firefox
(`name@/path:17:5`), and WebKit (`name@file:17`) — and records
`{ file, line, column }` into the rule/derived node. The fold copies each
rule's `loc` onto every `Delta` it writes; snapshots are the carrier.

The browser mapping is the tricky half: model code runs inside
`new Function`, whose synthetic wrapper shifts reported line numbers by an
engine-dependent amount. `web/src/repl.ts` **calibrates at compile time** —
a probe error thrown on a known body line tells it the shift, so
`userLine()` can translate `Error.stack` lines back to editor lines — and
only locations from eval'd/`anonymous`/`VM\d+` files are translated.
`mini()` never relies on the probe: its statement locations are arithmetic
(`mini()` call line + block-relative line).

If you touch any of this, `test/repl.test.ts` (compile + line calibration)
and the jsdom UI tests are the tripwire.

## The browser REPL's moving parts

- **Model execution**: `compileModel` wraps the buffer in `new Function`
  with the DSL constructors injected — no import statements in model code;
  the expression's value must be a `Model`.
- **Horizon toolbar**: start/end/unit/convention compose into an override —
  unit change with start/end on auto is `retickHorizon` (duration-
  preserving); explicit bounds are raw ticks (opt-out); the basis survives
  both (`web/src/repl.ts::horizonOverride`).
- **MC pool**: `mc-pool.ts` splits `[0, paths)` across module workers running
  `mc-worker.ts` (`runPathRange` per range), falls back sequentially when
  `Worker` is absent; results merge per `(seed, path)`, so worker count never
  affects output.
- **Share codec** (`web/src/share.ts`): session JSON → deflate-raw →
  base64url under `?m=`, with a `j`-prefixed uncompressed fallback where
  `CompressionStream` is missing; branches replay as forks on load.
- **Scenarios** (`web/src/scenarios.ts`): pure store over an injected
  `StorageLike` (`kairotron.scenarios.v1`); the UI collects trunk code +
  raw control values and treats a load as a fresh trunk.

## Documentation toolchain

This site is VitePress in `docs/` (`npm run docs:dev`; config in
`docs/.vitepress/config.mts` — the design docs are `srcExclude`d).

- **Dead links fail the build** — VitePress checks internal links; keep
  sidebar/nav entries and cross-references current when renaming pages.
- **Runnable examples**: fenced blocks tagged ` ```ts run ` are extracted by
  `scripts/check-doc-examples.ts` (wired as `npm run docs:examples`) into
  temp modules that are **imported and executed** — a block is a program
  that must fold without throwing, and blocks assert their own numbers.
  They import from `"kairotron"`, which `tsconfig.json` paths-map to
  `src/index.ts`. Keep such blocks self-contained, side-effect-light, and
  deterministic (fixed seeds).
- **CI** (`.github/workflows/ci.yml`) runs typecheck, the vitest suite, and
  `docs:check` on every push/PR.
