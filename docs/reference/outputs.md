# Outputs & exports

Every view — CLI table, CSV, flows, diff, percentile table, the REPL's JSON
download — is a pure formatter over the same immutable snapshot array.
Nothing re-runs to print.

## Timeline table (`formatTable`)

One row per snapshot. Columns: `t`, an optional `date` (only when any
snapshot carries a calendar basis), one column per stock (union across the
history, in first-seen order), then derived columns prefixed `~`:

```text
  t      preTax       cash   ~netWorth  ~preTaxShare
--  ----------  ---------  ----------  ------------
  0  120,000.00  25,000.00  145,000.00          0.83
  1  123,466.04  25,031.25  148,497.29          0.83
```

- Numbers are en-US formatted, 2 decimals, right-aligned.
- **`—` means "no value here"**, never zero: a fork variant that introduces a
  stock genuinely has none through the shared prefix.
- The dated table interleaves civil dates (basis-aware civil stepping):

```text
  t        date            ira       cash   ~age      ~netWorth
---  ----------  -------------  ---------  -----  -------------
  0  1975-06-15      50,000.00       0.00   0.00      50,000.00
877  2048-07-15  11,741,913.27   1,500.00  73.00  11,743,413.27
```

Date cells show `YYYY-MM-DD`, gaining ` HH:MM` / ` HH:MM:SS` only when the
basis carries a time of day. A snapshot without a basis inside a dated
history prints `—`.

## CSV (`formatCsv`)

Same columns, machine-shaped: raw full-precision numbers (no thousands
separators), `date` column when dated, and an **empty field** (not `0`)
where the table shows `—`. RFC 4180 quoting applies — user-chosen stock
names may contain commas, quotes, or newlines.

## Flows (`formatFlows`) — provenance

```text
t=1
       +2,750.00  preTax       monthly contribution  @examples/retirement.ts:17:5
         +716.04  preTax       growth @ 7%/year      @examples/retirement.ts:18:5
          +31.25  cash         interest @ 1.5%/year  @examples/retirement.ts:19:5
```

Signed, aligned amount; stock; rule **label**; and `@file:line:column` when
the rule carried a captured source location. `transfer` writes two lines
(negative on `from`, positive on `to`, same label). Tick 0 (no deltas) prints
nothing. Fork-override writes appear as `fork @t=…` deltas. CLI: `--flows`,
also for the branch after its fork tick.

## Diff (`formatDiff`) — branch vs trunk

```text
Δ vs trunk (branch − trunk)
 t    ΔpreTax  Δcash
--  ---------  -----
  7    +754.38  +0.00
```

Only ticks **after** the fork point (the shared prefix is diff-zero by
construction). Stocks/ticks with nothing to subtract — a variant-introduced
stock, or a branch tick past the trunk's end — print `—`. Across a
cross-unit fork the trunk is matched by **duration** (hold-last), or by
**civil moment** when both timelines carry a basis, since branch and trunk
tick numbers no longer share a scale.

## Monte Carlo percentile output

`summarizeMonteCarlo(mc, percentiles?)` collapses N paths sharing one tick
grid into a percentile timeline (defaults p10/p50/p90; interpolation is the
R-7/NumPy default — deterministic and stable on ties). Each stock and
derived value expands to one column per percentile, separated by `·`:

```text
  t   preTax·p5    preTax·p50    preTax·p95    cash·p5   cash·p50   cash·p95
---  ----------  ------------  ------------  ---------  ---------  ---------
  0  120,000.00    120,000.00    120,000.00  25,000.00  25,000.00  25,000.00
```

`--percentiles 5,50,95` (or the `percentiles` argument) sets the levels;
CSV mirrors the table with raw numbers. A value present in only some paths
at a tick (possible across fork variants) percentiles over the paths that
have it; a name absent from every path gets no column.

### What Monte Carlo exports do and don't contain

Raw path sets are big and reproducible from `(seed, paths)`, so exports carry
the **summary**, never N timelines: CSV is the percentile table; the browser
JSON ships `{ mode: "mc", branch, seed, paths, percentiles, horizon, rows }`
where `rows` are `PercentileRow`s (`t`, `unit`, `convention?`, `basis?`,
`count`, and `stocks`/`derived` maps of `pXX → value`). Per-tick provenance
(deltas) is a single-path notion and appears in **no** Monte Carlo export —
rerun a path deterministically if you need its flows.

## JSON export (browser)

The REPL's **JSON** button, for a deterministic timeline:

```jsonc
{
  "branch": "b1",           // current chip; "main" for the trunk
  "forkT": 6,               // fork tick, null on the trunk
  "horizon": { "start": 0, "end": 12, "unit": "month" },
  "history": [              // the full append-only snapshot array
    {
      "t": 1,
      "unit": "month",
      "convention": "abstract",
      "stocks": { "preTax": 123466.04, "cash": 25031.25 },
      "derived": { "netWorth": 148497.29 },
      "deltas": [
        { "stock": "preTax", "amount": 2750, "rule": "monthly contribution",
          "loc": { "file": "…", "line": 17, "column": 5 } }
      ]
    }
  ]
}
```

(`basis` rides along on every snapshot when the horizon carries one. This is
the same `Snapshot` shape the engine produces and the embedding API returns —
see [Embedding](/guide/embedding).) In Monte Carlo mode the button emits the
percentile summary described above instead.

## Related

- [CLI reference](/reference/cli) — flags selecting each shape
- [Embedding guide](/guide/embedding) — calling the formatters directly
- [Browser REPL guide](/guide/browser-repl)
