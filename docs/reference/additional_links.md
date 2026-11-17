# Additional links

Kairotron's math is essentially **discrete-time dynamical systems** (iterated
maps / difference equations) dressed in **system-dynamics** stock-and-flow
semantics, plus **stochastic modeling** for Monte Carlo mode. This page is an
annotated reading list of Wikipedia articles that speak to each layer of the
engine.

## The core fold: iterating a pure step function

- [Dynamical system](https://en.wikipedia.org/wiki/Dynamical_system) — the
  umbrella concept; `sₜ = step(sₜ₋₁, t)` is a discrete dynamical system.
- [Recurrence relation](https://en.wikipedia.org/wiki/Recurrence_relation) —
  the formal name for a value defined by iterating a rule over its previous
  value; [difference equations](https://en.wikipedia.org/wiki/Difference_equation)
  is the linear-case section.
- [Map (mathematics)](https://en.wikipedia.org/wiki/Map_(mathematics)) and
  [Iteration](https://en.wikipedia.org/wiki/Iteration) — tick 0-to-N as
  function composition.
- [Logistic map](https://en.wikipedia.org/wiki/Logistic_map) — the canonical
  "simple iterated rule, wild behavior" example.
- [Fold (higher-order function)](https://en.wikipedia.org/wiki/Fold_(higher-order_function))
  and [Catamorphism](https://en.wikipedia.org/wiki/Catamorphism) — the
  CS/category view of the history fold `[S₀ … Sₙ]`.
- [Pure function](https://en.wikipedia.org/wiki/Pure_function),
  [Immutable object](https://en.wikipedia.org/wiki/Immutable_object), and
  [Finite-state machine](https://en.wikipedia.org/wiki/Finite-state_machine) —
  why snapshots are safe and forks are free.

## Stock-and-flow semantics (the domain math)

- [System dynamics](https://en.wikipedia.org/wiki/System_dynamics) and
  [Stock and flow](https://en.wikipedia.org/wiki/Stock_and_flow) — reservoirs,
  buckets, inflows/outflows.
- [Feedback](https://en.wikipedia.org/wiki/Feedback) and
  [Exponential growth](https://en.wikipedia.org/wiki/Exponential_growth) —
  compounding loops.
- [Stock-flow consistent model](https://en.wikipedia.org/wiki/Stock-flow_consistent_model) —
  macroeconomics done as exactly this accounting identity.
- [Multi-compartment model](https://en.wikipedia.org/wiki/Compartmental_model) —
  the general "several stocks exchanging flows" math behind every exemplar
  domain.
- Domain exemplars: [Water balance](https://en.wikipedia.org/wiki/Water_balance)
  (hydrology), [Carbon budget](https://en.wikipedia.org/wiki/Carbon_budget)
  (climate), [State of charge](https://en.wikipedia.org/wiki/State_of_charge)
  (batteries), [Pharmacokinetics](https://en.wikipedia.org/wiki/Pharmacokinetics)
  (dosing),
  [Compartmental models in epidemiology](https://en.wikipedia.org/wiki/Compartmental_models_(epidemiology))
  (SIR),
  [Beer distribution game](https://en.wikipedia.org/wiki/Beer_distribution_game)
  (supply-chain delays).
- The finance exemplars:
  [Compound interest](https://en.wikipedia.org/wiki/Compound_interest),
  [Retirement spend-down](https://en.wikipedia.org/wiki/Retirement_spend-down)
  (safe withdrawal rates),
  [Sequence of returns](https://en.wikipedia.org/wiki/Sequence_of_returns)
  risk, [Perpetuity](https://en.wikipedia.org/wiki/Perpetuity),
  [Drawdown](https://en.wikipedia.org/wiki/Drawdown).

## Discretization and time (ticks vs. the continuous world)

- [Discretization](https://en.wikipedia.org/wiki/Discretization) and
  [Euler method](https://en.wikipedia.org/wiki/Euler_method) — turning
  continuous inflow "rates" into tick-stepped applications.
- [Time-scale calculus](https://en.wikipedia.org/wiki/Time_scale_calculus) —
  the formal math of "same dynamics on any time grid"; basically the tick-unit
  abstraction.
- [Rate of change](https://en.wikipedia.org/wiki/Rate_of_change) and
  [Numerical integration](https://en.wikipedia.org/wiki/Numerical_integration) —
  flows accumulating into stocks.
- [Delay differential equation](https://en.wikipedia.org/wiki/Delay_differential_equation) —
  the math of lagged rules.

## Monte Carlo mode

- [Monte Carlo method](https://en.wikipedia.org/wiki/Monte_Carlo_method) and
  [Stochastic process](https://en.wikipedia.org/wiki/Stochastic_process).
- [Random walk](https://en.wikipedia.org/wiki/Random_walk) — where the
  √-time volatility scaling comes from: variance grows linearly with ticks, so
  σ scales with √Δt and tick granularity doesn't change the spread.
- [Geometric Brownian motion](https://en.wikipedia.org/wiki/Geometric_Brownian_motion) —
  the continuous-time limit that compounding-with-noise models approximate.
- [Normal distribution](https://en.wikipedia.org/wiki/Normal_distribution) and
  [Continuous uniform distribution](https://en.wikipedia.org/wiki/Continuous_uniform_distribution) —
  the two `stochastic()` samplers.
- [Pseudorandom number generator](https://en.wikipedia.org/wiki/Pseudorandom_number_generator) —
  seeded, reproducible paths.
- [Percentile](https://en.wikipedia.org/wiki/Percentile),
  [Law of large numbers](https://en.wikipedia.org/wiki/Law_of_large_numbers),
  and [Central limit theorem](https://en.wikipedia.org/wiki/Central_limit_theorem) —
  why `·pXX` bands tighten as you add paths.
- [Volatility (finance)](https://en.wikipedia.org/wiki/Volatility_(finance)),
  [Uncertainty quantification](https://en.wikipedia.org/wiki/Uncertainty_quantification),
  and [Sensitivity analysis](https://en.wikipedia.org/wiki/Sensitivity_analysis).

## Re-ticking, units, and the calendar overlay

- [Upsampling](https://en.wikipedia.org/wiki/Upsampling),
  [Downsampling](https://en.wikipedia.org/wiki/Downsampling_(signal_processing)),
  and [Resampling (statistics)](https://en.wikipedia.org/wiki/Resampling_(statistics)) —
  `retickHorizon` is resampling;
  [Zero-order hold](https://en.wikipedia.org/wiki/Zero-order_hold) is exactly
  "hold-last" and
  [Linear interpolation](https://en.wikipedia.org/wiki/Linear_interpolation)
  is the alternative.
- [Conversion of units](https://en.wikipedia.org/wiki/Conversion_of_units) and
  [Dimensional analysis](https://en.wikipedia.org/wiki/Dimensional_analysis) —
  rates carrying `(value, perUnit)`.
- [Day count convention](https://en.wikipedia.org/wiki/Day_count_convention) —
  `actual/365` vs `30/360`.
- [Leap year](https://en.wikipedia.org/wiki/Leap_year),
  [Unix time](https://en.wikipedia.org/wiki/Unix_time) (the epoch-ms basis),
  and [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) — civil-calendar
  stepping.
- [Time series](https://en.wikipedia.org/wiki/Time_series) — what the output
  table and chart actually are.
