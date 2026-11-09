# Tools for modeling values that change over time

Research notes, 2026-11-02. Question: does any application focus on letting a person
define **variables**, **events with recurring effects** on those variables, and
**arbitrarily complex computations/gating**?

Search method note: mainstream engines (DuckDuckGo, Bing, Mojeek, SearX, Marginalia)
threw captchas or AI-slop at automated queries. Reliable channels were Wikipedia, the
GitHub search API, and direct product sites. "Confirmed" below means re-verified live
on 2026-11-02.

## The archetype has a name (or several)

- **System dynamics** — stocks/flows, feedback loops, rate equations. The classic field.
- **Discrete-event / cyber-physical modeling** — events with guarded conditions; the
  closest match to "computation + gating".
- **Trigger–condition–action rule engines** — the automation-engine reading.
- **Driver-based planning / FP&A** — the business reading: spreadsheet where one axis is
  time, formulas ("drivers") propagate along it.

## System dynamics software

Source: Wikipedia "Comparison of system dynamics software" (rev. 2025-07).

| Tool | License / notes |
|---|---|
| Vensim | Proprietary; free PLE for personal/edu use; some discrete-event functionality |
| AnyLogic | Proprietary; free PLE; recurrent events + statecharts + hybrid SD/ABM/DES; Java |
| Stella / iThink | Proprietary; business/policy games, classroom-oriented |
| Berkeley Madonna | Proprietary; ecology/physiology heritage (ODEs, difference eqs) |
| GoldSim | Proprietary; explicitly models "processes and events", probabilistic-first |
| OpenModelica | Free; Modelica `when` clauses (guarded discrete events), SD + Business Simulation libraries |
| Simantics System Dynamics | Free, EPL; stock-and-flow, array variables |
| StochSD | Free, AGPL; stochastic SD, InsightMaker engine |
| PathSim | Free, MIT; Python block-diagram framework with discrete-event handling |
| se-lib | Free, MIT; Python SD + DES |
| LunaSim | Free, web-based; education (2025) |
| NetLogo | GPLv2; ABM with SD as secondary |
| Analytica, Dymola, MapleSim, Simulink, Wolfram SystemModeler | Proprietary modeling suites |

## Rule / automation engines (general-purpose)

- **Node-RED** — cron-recurring inject nodes, JS function nodes, switch gating, persistent context vars.
- n8n / Make, Home Assistant (often used as a pure personal-state engine), Prometheus/Kibana/Kapacitor-style alert rule engines, enterprise CEP (Esper EPL, Drools Fusion).
- Complex-scheduling variant: constraint solvers — **MiniZinc, Timefold/OptaPlanner, Google OR-Tools** — where "gating statements" become constraints/objectives rather than formulas.

## Personal-analytics niche

- **Quantified Awesome** — confirmed: [github.com/sachac/quantified](https://github.com/sachac/quantified), source of QuantifiedAwesome.com. Ruby/Rails, MIT, active (pushed 2025-07). Event-based metrics with quality ratings, half-life weighting, projections. Closest personal match to the spec.
- **awesome-quantified-self** — confirmed: [github.com/woop/awesome-quantified-self](https://github.com/woop/awesome-quantified-self), 2.8k stars, updated 2026-07. The discovery hub for this niche.
- ~~Self-Track~~ — server + app; **appears dead**: repo not findable via GitHub search, site unreachable (2026-11).
- Beeminder, Habitica — same skeleton (recurring dailies mutating stats) with preset formulas.

## Spreadsheet paradigm (time as an axis)

- **Anaplan** — confirmed live. The enterprise end-point: multidimensional deterministic calc engine, time as one dimension, driver formulas, IF/allocate gating. Now marketed as "decision infrastructure for the Agentic Enterprise" (deterministic engine + LLM agents; 48% of Fortune 50).
- **Lucanet xP&A** — confirmed: [causal.app](https://causal.app) redirects here. Causal (the friendly causal-loop/forecasting modeler) was absorbed into Lucanet's enterprise FP&A line.
- **Grist** — confirmed live; [github.com/gristlabs/grist-core](https://github.com/gristlabs/grist-core). Open-source relational spreadsheet, Excel functions + full Python in cells, self-hostable. Best OSS substrate for building such a model.
- **Numeric** (YC "AI-native finance spreadsheet") — getnumeric.com now serves a placeholder page; appears **dead** or abandoned (2026-11).
- Excel-native Monte Carlo add-ins (@RISK, Oracle Crystal Ball) — same "columns are years" paradigm with distributions; long-standing category, not re-verified.

## Domain-locked incarnations (the spec, reinvented per vertical)

- **cFIREsim** — confirmed alive and thriving: 37M+ simulations, market data through 2026-08. Retirement Monte Carlo: recurring adjustments (start/end year, inflation-adjusted), gated spending plans (VPW, Hebeler, Guyton-Klinger guardrails, spending floors/ceilings, CAPE).
- **FIREproof** (fireproofme.com) — confirmed live; same author (Lauren Boland) as cFIREsim. Year-by-year variables per account, recurring events, gated logic (RMDs, 72(t) SEPP, IRMAA, bracket-fill targets, ACA subsidies, bucket strategies that suspend equity sales in drawdowns), tax-return-level detail across 150 years of histories. The purest existing implementation of variables + recurring events + complex gating — for exactly one domain.
- **Clinical CDS** (Amplicle/Ginger "programs", Epic order sets) — timed recurring events + computed doses + protocol gating; medical vertical.
- **PBPK/PD modeling** (PK-Sim, Berkeley Madonna, nlmixr) — dosing schedules as recurring events, concentrations as variables, Emax/threshold models as gating.
- **Orion** (orion-adviser.com) — portfolio simulator with scheduled actions and formula-driven withdrawals; site unreachable on first try, not confirmed.

## Science vs. business ancestry

The rigorous implementations came from two streams:

1. **Science/engineering**: Berkeley Madonna, OpenModelica/Dymola, GoldSim, Simulink — stayed general-purpose, academic UX.
2. **Business/policy**: Forrester's industrial dynamics, *Limits to Growth*, the beer game; Stella/iThink (games/classrooms); Causal→Lucanet, Anaplan (enterprise FP&A).
3. **Consumer/personal**: science tooling diluted into habit trackers with preset formulas — the gap.

## Conclusion

Nobody sells a polished consumer app whose pitch is "arbitrary statements for
computation and gating". The archetype survives split across SD simulators, rule
engines, enterprise planning grids, and domain-locked simulators (finance, medicine).
The unclaimed middle — a friendly general-purpose personal modeler — has never been
built. Grist (Python-in-cells) or a state-store + scheduler + rule-DSL loop are the
practical build-it-yourself substrates; cFIREsim/FIREproof are the existence proof that
a domain-specific version earns and sustains a real user base.




## can the interest formula be considered the sum of a series

Yes, interest formulas can be directly connected to and derived from mathematical sequences and series.

Simple Interest as an Arithmetic Sequence

• Simple interest accumulation (\(A = P(1 + rt)\)) mirrors an arithmetic sequence where the initial principal (\(P\)) is the first term and the annual interest earned (\(P \times r\)) is the constant common difference (\(d\)).
• While a single lump-sum simple interest formula calculates the total directly (\(P + Prt\)), viewing year-by-year totals (\(P, P + Pr, P + 2Pr, \dots\)) represents the terms of an arithmetic progression.

Compound Interest and Annuities as Geometric Series

• Compound interest problems are mathematically identical to geometric sequences, where each period's balance is multiplied by a common ratio (\(1 + r\)).
• When dealing with recurring investments, loans, or annuities (where multiple cash flows are added or paid over time), the total future or present value is literally the sum of a geometric series. For example, summing a series of periodic payments or remaining debt balances uses the partial sum formula of a geometric


## would it be true to say that the interest rate geometric formula is abstracted away from actual units of time?

Yes, it is entirely true to say that the geometric formula for compound interest is abstracted away from actual, absolute units of time.
The standard geometric compound interest formula is:
\(A=P(1+r)^{n}\)
Where:
• \(A\) is the final amount.
• \(P\) is the principal (starting amount).
• \(r\) is the interest rate per period.
• \(n\) is the number of compounding periods.
In pure mathematics, the formula does not care whether a single unit of \(n\) represents a second, a month, a year, or a decade. It operates entirely on the concept of discrete, sequential periods.
Here is a breakdown of why and how this abstraction works, along with the real-world tradeoffs when we map it back to actual time.

The Nature of the Abstraction

The formula is geometric because it represents a geometric progression. Each step forward multiplies the current value by a constant factor, \((1 + r)\).
• Mathematical Neutrality: To the math engine, \(n\) is simply a non-negative integer counting the number of iterations.
• Rate and Period Lockstep: The only rule the formula enforces is that \(r\) and \(n\) must use the same unit baseline. If \(n\) counts months, \(r\) must be the monthly interest rate. If \(n\) counts days, \(r\) must be the daily interest rate.
Because of this abstraction, the exact same mathematical curve describes both a high-frequency crypto protocol compounding every minute and a generational trust fund compounding once every century.

Real-World Mapping vs. Mathematical Reality

While the pure formula is timeless, the real world forces us to anchor it to the calendar. This is where human conventions introduce friction into the clean geometric math.
To see how the abstract formula adapts, consider the standard financial equation used to adjust for annual calendar terms:
\(A=P\left(1+\frac{r_{annual}}{m}\right)^{m\cdot t}\)
Here is how the abstract variables (\(r\) and \(n\)) map to real-world time components (\(r_{annual}\), \(m\), and \(t\)):

Abstract Variable	Real-World Component	Description
\(r\) (Rate per period)	\(\frac{r_{annual}}{m}\)	The annual rate divided by the compounding frequency per year.
\(n\) (Total periods)	\(m \cdot t\)	The compounding frequency multiplied by the total number of years.


The Tradeoffs of Real-World Time

When we plug actual time into this abstract geometric framework, we run into two main real-world friction points:
• The Inexact Calendar: The geometric formula assumes every period \(n\) is identical. In reality, calendar months have varying days (28, 30, 31), and leap years add an extra day. Finance professionals must use artificial day-count conventions (like 30/360 or Actual/360) to force the messy real world into the neat, equal periods the formula requires.
• The Continuous Limit: If you shorten the unit of time toward zero—compounding every millisecond, microsecond, and so on (\(m \to \infty\))—the discrete geometric formula transitions into calculus. It becomes the continuous compounding formula (\(A = Pe^{rt}\)), shifting the abstraction from a geometric sequence to an exponential function based on Euler's number (\(e\)).
If you want to explore this further, let me know:
• Would you like to see how continuous compounding (\(e^{rt}\)) mathematically emerges from this discrete formula?
• Are you looking to solve a specific financial calculation using these time adjustments?
• Do you want to see how day-count conventions (like Actual/360) mathematically alter the results?
Let me know what you'd like to look at next to help deepen your understanding.




