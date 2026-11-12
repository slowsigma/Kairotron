---
layout: home

hero:
  name: Kairotron
  text: Fold your system across time
  tagline: A text-first REPL for discrete-time dynamical systems — stock-and-flow models, finite horizons, and playhead-linked code highlighting. Tidal turns patterns into sound; Kairotron turns rules into a series.
  image:
    src: /banner.svg
    alt: Kairotron banner
  actions:
    - theme: brand
      text: Getting started
      link: /guide/getting-started
    - theme: alt
      text: DSL reference
      link: /reference/dsl
    - theme: alt
      text: Open the REPL
      link: /guide/browser-repl

features:
  - title: "The whole engine is a fold"
    details: >
      sₜ = step(sₜ₋₁, t, params) over a finite horizon. History is an append-only
      array of immutable snapshots — scrubbing, forking, and re-running cost nothing.
  - title: "Ticks are semantics, not tempo"
    details: >
      Every rate carries its per-unit (7%/year) and the engine normalizes it to the
      tick. Re-tick months → days and the model is re-expressed, duration-preserved —
      not re-scored.
  - title: "See which line moved each stock"
    details: >
      Every delta carries its source location (Strudel's withLoc trick, aimed at
      data). Scrub the playhead and the responsible rules light up in the editor.
  - title: "Domain-agnostic by construction"
    details: >
      Finance, hydrology, epidemiology, batteries, population, dosing, supply
      chains — no domain vocabulary is hardcoded in the core.
  - title: "What-if for free"
    details: >
      Fork the timeline at any snapshot and continue with different rules; the
      shared prefix is the same frozen snapshots. A branch may even change the
      tick unit.
  - title: "Deterministic by default, Monte Carlo on demand"
    details: >
      Mark a rate stochastic and sample seeded paths — same seed, same paths,
      bit for bit — with percentile bands over the timeline and same-world
      forks.
---

## Try it in one command

```bash
npm install
npx tsx src/cli.ts examples/retirement.ts --flows
```

A snapshot per tick, and with `--flows` the rule (and source line) behind every
delta. The [browser REPL](/guide/browser-repl) adds the editor, the stacked
timeline chart, the scrubber, and live code highlighting:

```bash
npm run dev
```

## Where to go next

- New here? Work through the [getting-started tutorial](/guide/getting-started)
  — a clean checkout to a run, a fork, a Monte Carlo, and an export.
- Building a mental model? Read [Concepts](/guide/concepts) — the fold, the
  value taxonomy, units, the calendar overlay, provenance, branches.
- Looking something up? The [DSL reference](/reference/dsl),
  [mini-notation reference](/reference/mini-notation),
  [CLI reference](/reference/cli), and [outputs reference](/reference/outputs)
  cover every construct, flag, and export shape.
- Hit an error? The [troubleshooting catalog](/guide/troubleshooting) maps
  engine error messages to causes and fixes.
