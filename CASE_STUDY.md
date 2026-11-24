# Aurel — case study

**Domain:** wealth management, goal-based planning, portfolio construction
**Category:** independent educational project, not a regulated advisory engagement
**Data:** one fictional household; four asset classes with hypothetical return, volatility and correlation assumptions

## The problem

Clients rarely ask for a volatility number. They ask whether they will reach a goal, how bad a bad outcome could be, and what they should change. A single fixed-return projection answers none of that honestly: it hides the range of outcomes and makes every plan look on track. A useful review shows the spread, puts a number on the trade-offs, and is written so a client can follow it.

## What I built

- A seeded Monte Carlo engine that returns percentile bands for every year, not just an ending number, and can report in today's rupees.
- A solver for the monthly contribution needed to hit the goal at a chosen confidence level.
- A cost-of-delay study that uses the same timing assumptions as the simulation.
- Risk contribution analysis showing that a 45% equity weight can carry close to 90% of portfolio risk.
- A random-portfolio frontier, suitability comparison, stress scenarios and a track-record checker (Sharpe, Sortino, drawdown, tracking error, information ratio).
- Drift-band rebalancing with turnover and cost, so the tool recommends doing nothing when doing nothing is right.
- A client letter generated from the live model.

## What to look at

1. On **Plan**, compare the fan chart's median with the fixed-return figure in the text. The median sits below it, as it should when returns are volatile.
2. Tick **Show values in today's rupees** and watch the goal probability fall.
3. Change the confidence selector from 80% to 90% and note how much the required contribution rises.
4. On **Allocation**, choose Long-term growth with a Low risk tolerance and read the suitability note.
5. On **Rebalance**, set holdings close to target and confirm that no trades are proposed inside the band.
6. Run `npm test` and read `tests/engine.test.mjs`.

## What it shows

The ability to turn planning concepts into a model that is numerical, explainable and tested, and to communicate its output to a non-specialist. Relevant to wealth management, investment analyst and portfolio analytics roles.

## What it does not show

Regulated advice, a suitability determination, historical backtesting, tax treatment, real client work or investment performance. Asset assumptions are illustrative and the return model is deliberately simple (annual steps, fixed correlations, no fat tails).
