# Aurel — Wealth Advisory Studio

**Domain:** Wealth management analytics, investor goals, portfolio construction  
**Portfolio category:** Independent educational finance project, not a regulated investor advisory engagement  
**Dataset:** Hypothetical client choices and four asset classes with synthetic return, risk and correlation assumptions.

## The problem

Wealth professionals need to communicate the trade-off between investment objectives, allocation risk, cash contributions and investment time horizons. A portfolio report should also distinguish a projected future amount from the range of uncertain hypothetical scenarios.

## The demonstrator

- Three model portfolios: capital preservation, balanced growth, long-term growth.
- Client horizon, goal, monthly savings, portfolio balance and fee assumptions.
- Expected portfolio return and covariance-based volatility from predefined hypothetical market parameters.
- Deterministic wealth accumulation and reproducible 1,000-path scenario distribution with 10th, 50th and 90th percentiles.
- Basic risk-tier warning, editable current allocation, rebalancing trades and three manually selected stress scenarios.
- Exportable explanatory memo documenting assumptions and limitations.

## The reviewer should examine

1. Compare conservative versus growth portfolios with the same investing horizon.
2. Set risk tolerance to Low and choose Long-term growth; inspect the warning.
3. Change starting allocation and review the recommended buy/sell *worksheet*, which is not an executed recommendation.
4. Review the p10–p90 distribution and simulated goal attainment; confirm seed reproducibility in `tests/engines.test.mjs`.
5. Read the caveats on simulated outcomes, tax, risk suitability and portfolio rebalancing.

## What it proves

An ability to translate investment-planning concepts into a numerical, explainable and testable analytical workflow. Relevant to Wealth Management Associate, Investment Analyst and Portfolio Analytics Associate roles.

**Does not prove:** regulated financial advice, risk-adjusted investment performance, returns from historical backtesting, verified investment suitability, client acquisition, portfolio-management authority or a track record.
