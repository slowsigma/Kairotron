# Browser REPL guide

```bash
npm run dev        # Vite dev server (prints the local URL, default http://localhost:5173)
npm run build      # static bundle in dist/
npm run preview    # serve the built bundle
```

Zero runtime dependencies: the page imports the engine unchanged from
`src/`; the UI is vanilla TypeScript over SVG. Model code runs through
`new Function` with the DSL constructors in scope — the same
`model({...})`/`mini(...)` you write for the CLI, no import statements
needed.

## Layout

```text
┌ toolbar ── ▶ Run  ⑂ Fork  start end unit convention mc-paths mc-seed stocks … scenario 💾 ✕ Share CSV JSON ─┐
│ branchbar   [ main ] [ b1@6 × ] [ b2@12 × ]                                                                │
├───────────────┬─────────────────────────────────────────────────────────────┤
│ editor        │  stocks chart (stacked areas / lines) + legend              │
│ (highlights)  │  Δ pane (branch − trunk, branches only)                     │
│               │  derived chart (~ curves / percentile bands)                │
│               ├─────────────────────────────────────────────────────────────┤
│               │  inspector │ table          ← tabs                         │
├───────────────┴─────────────────────────────────────────────────────────────┤
│ playhead slider · t=42 · month · 2048-07-15 · preTax=… cash=…  · status    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Running and scrubbing

- **▶ Run** (or **Ctrl/Cmd+Enter** in the editor) compiles the buffer, folds
  it, and re-renders everything. The status bar reports
  `ok — N ticks · Xms` or the fold error in red — nothing else clears.
- **Scrub** with the slider, by dragging directly on either chart, or with
  **←**/**→** (one tick at a time, when focus isn't in a text field).
  The playhead never moves the fold — all views read the committed
  snapshot array.
- **Tab** in the editor inserts two spaces; the transparent textarea sits over
  a syntax-free mirror `<pre>` that carries the highlight backgrounds.
- **Resize** the panes by dragging the vertical handle between the editor and
  the results. **Double-click** it resets to the default split; with the handle
  focused, **←**/**→** nudge it and **Home** resets (its arrows never move the
  playhead). The width persists across reloads.

## Provenance highlighting

At the current tick, every editor line whose rule wrote a delta is
highlighted — the CLI's `--flows` provenance rendered live. Hovering a rule
row in the inspector adds that rule's lines too (the engine tags each delta
with rule + location at compile time, so a `mini()` block highlights the
individual statement line). Monte Carlo runs show **no** highlighting: deltas
are a single-path notion, and the inspector shows the tick's distribution
instead.

## Toolbar

| Field | Default | Behavior |
|---|---|---|
| **start / end** | auto | Empty = keep the model's own bound. Filled = raw ticks in the selected unit — this **opts out of duration preservation** |
| **unit** | auto | Changing it *with start/end on auto* re-ticks the model's horizon duration-preservingly (rates re-normalize); the run re-fires immediately |
| **convention** | auto | `abstract` / `actual/365` / `30/360` — relabels the conversion; re-runs immediately |
| **mc paths** | off | Whole number ≥ 1; empty leaves everything deterministic |
| **mc seed** | 1 | Integer; same seed ⇒ same paths, bit for bit |
| **stocks** | stacked | `stacked` areas or plain `lines` |
| **scenario / 💾 / ✕** | — | Saved scenario sets (below) |
| **Share / CSV / JSON** | — | Session URL and exports (below) |

## Charts, legends, and the table

- **Stocks pane** — stacked areas (or lines) over the horizon; in Monte Carlo
  mode, percentile bands instead (p10–p90 outer, p25–p75 inner, median line).
- **Derived pane** — `~` curves overlaid (hidden entirely when the model
  derives nothing); per-series bands in Monte Carlo mode.
- **Trunk ghost** — on a branch, the trunk's continuation draws behind as
  dashed lines; the **Δ pane** plots branch-minus-trunk per stock. Both only
  render when branch and trunk share the tick scale (unit, convention, basis);
  a re-ticked branch diffs in the CLI, where alignment is by moment.
- **Legend** — click any swatch to hide/show that series (hidden names
  persist across runs while the series exists anywhere in the timeline).
- **Inspector tab** — the current tick's full state: stocks, the deltas this
  tick with rule labels (hover to light up their editor lines), derived
  values. Monte Carlo mode replaces it with the tick's percentile rows
  (paths × seed in the header).
- **Table tab** — the raw `formatTable` output, exactly what the CLI prints.

## Branches

**⑂ Fork** branches at the playhead: the new branch gets its own editor
buffer seeded with the current code, shares the trunk's prefix snapshots, and
appears as a chip (`b1@6`). Switch timelines by clicking chips; **×** discards
a branch (the trunk `main` never). Edit the branch's rules, press Run, and the
Δ-pane answers the what-if per stock per tick.

- Re-running the **trunk** re-forks every branch at its original tick —
  branches ride out trunk edits for free. Forks whose tick fell outside the
  new horizon, or whose unit no longer matches the trunk's, are dropped (the
  status bar reports `reforked N` / `dropped …`).
- Forking **while on a re-ticked branch** maps the playhead to the trunk's
  moment in force (hold-last), so the what-if anchors to the right civil
  moment, not the same tick number.
- The variant's buffer may add new stocks — they enter on the branch's first
  folded tick (never retroactively at the fork point), and table/CSV show `—`
  / empty in the shared prefix.

## Monte Carlo mode

Set **mc paths** and the next run folds the deterministic expected-value
timeline *plus* N seeded paths — the deterministic fold stays the baseline
for scrubbing, forking, and re-forking. Path ranges run on a **worker pool**
(the fold is pure, so paths are embarrassingly parallel; sequential fallback
where Workers are unavailable) and the charts swap to percentile bands.
Branches with paths on are **same-world**: each branch path continues its
trunk path's own shock sequence (the branch inherits the trunk's seed —
it *is* the same world), so a band gap is the decision's effect with the
noise held fixed. A branch needs the trunk's paths first; the branch keeps
the trunk's tick grid or the engine rejects the mix
([Monte Carlo guide](/guide/monte-carlo)).

## Share URLs

**Share** encodes the session into one `?m=` query parameter and copies the
URL (falling back to the address bar where the clipboard is unavailable).
Contents: the trunk's *last-run* model code and horizon, the raw mc
paths/seed, the playhead (stored as a trunk tick), and each branch's fork
tick, buffer, and own horizon when re-ticked. The payload is JSON,
deflate-compressed and base64url-encoded, with an uncompressed
(`j`-prefixed) fallback where `CompressionStream` is unavailable. No server
ever sees it — opening the link folds the trunk, re-forks the branches, and
lands the playhead. A corrupted link says so in the status bar and falls
back to the sample.

::: warning A share link is a script
Opening a link runs the model code it carries — that is the whole point of a
shareable session, and the payload's *structure* is validated, but the code
string itself is arbitrary JavaScript by design (the REPL evaluates models
with `new Function`, like Strudel). Only open share links from people you'd
trust with pasted code, and post yours where you'd paste the model itself.
:::

## Scenario sets

**💾 Save** files the current model + horizon/MC controls (the *trunk's*
horizon — a branch's re-ticked toolbars never leak in) under a name in a
named set; **scenario** loads one (apply + immediate re-run); **✕** deletes
the selection. Sets and scenarios are plain JSON in `localStorage` under
`kairotron.scenarios.v1` — blocked storage just means an empty store.
Loading is a *fresh trunk*: existing branches are dropped rather than
re-forked onto an unrelated model. What-ifs inside a set are separate
scenarios; stacked-branch sessions are the share-URL notion.

## Sample model

The editor starts with a small deterministic retirement fold
(`web/src/sample.ts`) — Run it, then drag the playhead through the tick where
the annual top-up rule first fires, and watch the editor light up. From there:
fork before that tick, gate the rule differently, re-run, and read the Δ
pane.

## Related

- [CLI reference](/reference/cli) — the same horizon controls as flags
- [Outputs & exports](/reference/outputs) — the exact JSON/CSV shapes
