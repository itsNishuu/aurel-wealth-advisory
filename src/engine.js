/*
 * Aurel calculation engine — pure functions, no DOM.
 * Every capital-market number here is a hypothetical planning assumption, not a forecast,
 * a historical return series, or regulated advice. Amounts are INR.
 */

export const ASSETS = [
  { key: 'equity', name: 'Equities', mu: 0.105, vol: 0.2 },
  { key: 'bonds', name: 'Investment-grade bonds', mu: 0.06, vol: 0.065 },
  { key: 'gold', name: 'Gold', mu: 0.07, vol: 0.16 },
  { key: 'cash', name: 'Cash & liquid funds', mu: 0.035, vol: 0.01 },
];

// Illustrative cross-asset correlation matrix (symmetric, positive definite).
export const CORR = [
  [1, 0.1, 0.05, 0.04],
  [0.1, 1, 0.15, 0.25],
  [0.05, 0.15, 1, 0.03],
  [0.04, 0.25, 0.03, 1],
];

export const PRESETS = {
  conservative: { name: 'Capital preservation', weights: [0.15, 0.6, 0.15, 0.1], risk: 'Low' },
  balanced: { name: 'Balanced growth', weights: [0.45, 0.35, 0.1, 0.1], risk: 'Medium' },
  growth: { name: 'Long-term growth', weights: [0.7, 0.15, 0.1, 0.05], risk: 'High' },
};

const RANK = { Low: 1, Medium: 2, High: 3 };

export function validateWeights(w) {
  if (!Array.isArray(w) || w.length !== ASSETS.length || w.some((x) => !Number.isFinite(x) || x < 0) || Math.abs(w.reduce((a, b) => a + b, 0) - 1) > 1e-6) {
    throw Error('Allocation must be non-negative and total 100%.');
  }
  return w;
}

function covariance(i, j) { return ASSETS[i].vol * ASSETS[j].vol * CORR[i][j]; }

/** Expected net return and volatility of a weight vector. */
export function portfolioMoments(weights, fee = 0) {
  validateWeights(weights);
  if (!Number.isFinite(fee) || fee < 0 || fee > 0.1) throw Error('Annual cost must be between 0% and 10%.');
  const annualReturn = weights.reduce((s, w, i) => s + w * ASSETS[i].mu, 0) - fee;
  let variance = 0;
  for (let i = 0; i < weights.length; i++) for (let j = 0; j < weights.length; j++) variance += weights[i] * weights[j] * covariance(i, j);
  return { annualReturn, volatility: Math.sqrt(Math.max(0, variance)) };
}
// Backwards-compatible name used by the original project.
export const weightedMoments = portfolioMoments;

/** Share of total portfolio variance contributed by each asset (sums to 1). */
export function riskContributions(weights) {
  const { volatility } = portfolioMoments(weights);
  if (volatility === 0) return weights.map(() => 0);
  const variance = volatility ** 2;
  return weights.map((wi, i) => (wi * weights.reduce((s, wj, j) => s + wj * covariance(i, j), 0)) / variance);
}

/** Deterministic future value with monthly compounding of an annual rate. */
export function futureValue(pv, monthly, years, r) {
  if ([pv, monthly, years, r].some((x) => !Number.isFinite(x)) || pv < 0 || monthly < 0 || years < 1 || years > 50 || r <= -0.95 || r > 0.5) {
    throw Error('Check investment, monthly savings, horizon (1–50 years) and return assumptions.');
  }
  const mr = (1 + r) ** (1 / 12) - 1, n = years * 12;
  return pv * (1 + mr) ** n + monthly * (Math.abs(mr) < 1e-10 ? n : ((1 + mr) ** n - 1) / mr);
}

/** Seeded LCG so every simulation is reproducible (same seed → same paths). */
export function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (1664525 * x + 1013904223) >>> 0; return (x + 0.5) / 4294967296; };
}

function quantile(sorted, p) {
  const idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Monte Carlo of annual log-normal returns with yearly contributions (mid-year timing approximation).
 * real=true deflates every value by cumulative inflation so results read in today's rupees.
 * stepUp grows the monthly contribution each year (e.g. salary-linked SIP step-up).
 */
export function simulate({ pv, monthly, years, goal, annualReturn, volatility, paths = 1000, seed = 2026, inflation = 0, real = false, stepUp = 0 }) {
  const bad = [pv, monthly, years, goal, annualReturn, volatility, paths, seed, inflation, stepUp].some((x) => !Number.isFinite(x));
  if (bad || pv < 0 || monthly < 0 || years < 1 || years > 50 || goal <= 0 || volatility < 0 || volatility > 0.8 || paths < 100 || paths > 5000 || inflation < -0.05 || inflation > 0.2 || stepUp < 0 || stepUp > 0.25) {
    throw Error('Projection inputs are outside the supported range.');
  }
  const rand = rng(seed);
  const byYear = Array.from({ length: years + 1 }, () => new Float64Array(paths));
  const finals = new Float64Array(paths);
  const drift = annualReturn - 0.5 * volatility ** 2;
  for (let p = 0; p < paths; p++) {
    let v = pv;
    byYear[0][p] = pv;
    for (let y = 1; y <= years; y++) {
      const u1 = Math.max(1e-12, rand()), u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const r = Math.exp(drift + volatility * z) - 1;
      const contribution = monthly * 12 * (1 + stepUp) ** (y - 1);
      v = Math.max(0, v * (1 + r) + contribution * (1 + r / 2));
      byYear[y][p] = real ? v / (1 + inflation) ** y : v;
    }
    finals[p] = byYear[years][p];
  }
  const sortedFinals = [...finals].sort((a, b) => a - b);
  const bands = { p10: [], p25: [], p50: [], p75: [], p90: [] };
  for (const col of byYear) {
    const s = [...col].sort((a, b) => a - b);
    bands.p10.push(quantile(s, 0.1)); bands.p25.push(quantile(s, 0.25)); bands.p50.push(quantile(s, 0.5));
    bands.p75.push(quantile(s, 0.75)); bands.p90.push(quantile(s, 0.9));
  }
  const misses = sortedFinals.filter((x) => x < goal);
  return {
    p10: quantile(sortedFinals, 0.1), median: quantile(sortedFinals, 0.5), p90: quantile(sortedFinals, 0.9),
    goalProbability: 1 - misses.length / paths,
    averageShortfall: misses.length ? misses.reduce((s, x) => s + (goal - x), 0) / misses.length : 0,
    bands,
    totalContributed: pv + Array.from({ length: years }, (_, y) => monthly * 12 * (1 + stepUp) ** y).reduce((a, b) => a + b, 0),
  };
}

/** Original name kept for compatibility: returns p10/median/p90, goal probability and mean-like path. */
export function simulatePortfolio(args) {
  const s = simulate(args);
  return { p10: s.p10, median: s.median, p90: s.p90, goalProbability: s.goalProbability, meanPath: s.bands.p50 };
}

/**
 * Smallest monthly contribution that reaches the goal in at least `confidence` of simulated paths.
 * Uses common random numbers (fixed seed), so probability is monotone in contribution and bisection is valid.
 */
export function requiredMonthly({ confidence = 0.8, maxMonthly = 1_000_000, ...base }) {
  if (!(confidence > 0 && confidence < 1)) throw Error('Confidence must be between 0% and 100%.');
  const hit = (m) => simulate({ ...base, monthly: m, paths: base.paths ?? 600 }).goalProbability >= confidence;
  if (hit(0)) return 0;
  if (!hit(maxMonthly)) return null;
  let lo = 0, hi = maxMonthly;
  for (let i = 0; i < 40 && hi - lo > 50; i++) { const mid = (lo + hi) / 2; if (hit(mid)) hi = mid; else lo = mid; }
  return Math.ceil(hi / 100) * 100;
}

/**
 * Fixed-return projection on the same yearly timing as the simulation (contributions mid-year,
 * stepping up each year). Contributions start after `delay` years. Returns year-end balances 1..years.
 */
export function projectFixed({ pv, monthly, years, rate, stepUp = 0, delay = 0 }) {
  if ([pv, monthly, years, rate, stepUp, delay].some((x) => !Number.isFinite(x)) || pv < 0 || monthly < 0 || years < 1 || years > 50 || rate <= -0.95) {
    throw Error('Check investment, monthly savings, horizon and return assumptions.');
  }
  const path = [];
  let v = pv;
  for (let y = 1; y <= years; y++) {
    const contribution = y > delay ? monthly * 12 * (1 + stepUp) ** (y - 1 - delay) : 0;
    v = v * (1 + rate) + contribution * (1 + rate / 2);
    path.push(v);
  }
  return path;
}

/** Ending wealth if contributions pause for `delay` years while the existing pot keeps compounding. */
export function costOfDelay({ pv, monthly, years, rate, delay, stepUp = 0 }) {
  if (!Number.isInteger(delay) || delay < 0 || delay > years) throw Error('Delay must be a whole number of years within the horizon.');
  const now = projectFixed({ pv, monthly, years, rate, stepUp });
  const path = projectFixed({ pv, monthly, years, rate, stepUp, delay });
  return { onTime: now.at(-1), delayed: path.at(-1), cost: Math.max(0, now.at(-1) - path.at(-1)), path, onTimePath: now };
}

/** Random long-only portfolios for an efficient-frontier style scatter, plus the best Sharpe sample. */
export function frontier({ samples = 700, seed = 7, riskFree = 0.035, fee = 0 } = {}) {
  const rand = rng(seed), points = [];
  for (let s = 0; s < samples; s++) {
    const raw = ASSETS.map(() => -Math.log(Math.max(1e-12, rand()))); // Dirichlet(1,…,1)
    const total = raw.reduce((a, b) => a + b, 0), weights = raw.map((x) => x / total);
    const m = portfolioMoments(weights, fee);
    points.push({ weights, ret: m.annualReturn, vol: m.volatility, sharpe: m.volatility > 0 ? (m.annualReturn - riskFree) / m.volatility : 0 });
  }
  const best = points.reduce((a, b) => (b.sharpe > a.sharpe ? b : a));
  return { points, best };
}

export const STRESS_CASES = [
  { name: 'Equity sell-off', shocks: [-0.3, -0.04, 0.08, 0] },
  { name: 'Rates and risk squeeze', shocks: [-0.12, -0.12, 0.04, 0] },
  { name: 'Stagflation year', shocks: [-0.18, -0.08, 0.15, 0.01] },
  { name: 'Gold correction', shocks: [0.04, 0.02, -0.22, 0] },
  { name: 'Broad market rebound', shocks: [0.2, 0.03, 0.05, 0] },
];

export function stressScenarios(weights, pv) {
  if (!Number.isFinite(pv) || pv < 0) throw Error('Portfolio value must be non-negative.');
  validateWeights(weights);
  return STRESS_CASES.map((s) => {
    const change = weights.reduce((a, w, i) => a + w * s.shocks[i], 0);
    return { name: s.name, shocks: s.shocks, changePct: change * 100, changeAmount: pv * change };
  });
}

/**
 * Drift-band rebalancing: if any asset drifts more than `band` from target, trade everything back to target.
 * costBps is an illustrative all-in dealing cost on traded value.
 */
export function rebalancePortfolio(pv, current, target, { band = 0, costBps = 0 } = {}) {
  if (!Number.isFinite(pv) || pv < 0) throw Error('Portfolio value must be non-negative.');
  validateWeights(current); validateWeights(target);
  const rows = ASSETS.map((a, i) => ({ asset: a.name, currentWeight: current[i], targetWeight: target[i], drift: current[i] - target[i], trade: (target[i] - current[i]) * pv }));
  const breached = rows.some((r) => Math.abs(r.drift) > band + 1e-12);
  const turnover = rows.reduce((s, r) => s + Math.abs(r.trade), 0) / 2;
  const out = rows.map((r) => ({ ...r, breach: Math.abs(r.drift) > band + 1e-12, trade: breached ? r.trade : 0 }));
  out.breached = breached;
  out.turnover = breached ? turnover : 0;
  out.cost = breached ? turnover * 2 * costBps / 10000 : 0;
  return out;
}

/** Suitability is a comparison of model risk against stated tolerance — never a regulatory determination. */
export function assessSuitability(risk, presetOrWeights) {
  if (!RANK[risk]) throw Error('Choose client risk tolerance.');
  const modelRisk = typeof presetOrWeights === 'string' ? PRESETS[presetOrWeights].risk : riskBand(presetOrWeights);
  return RANK[modelRisk] > RANK[risk]
    ? 'Selected portfolio has higher model risk than the stated client risk tolerance. Review suitability.'
    : 'Model risk does not exceed the stated tolerance band. This does not establish regulatory suitability.';
}

/** Classify any weight vector by its modelled volatility. */
export function riskBand(weights) {
  const { volatility } = portfolioMoments(weights);
  return volatility < 0.07 ? 'Low' : volatility < 0.12 ? 'Medium' : 'High';
}

/** Starting model by tolerance and horizon: short horizons step down one risk level. */
export function recommendPreset(risk, years) {
  const order = ['conservative', 'balanced', 'growth'];
  if (!RANK[risk]) throw Error('Choose client risk tolerance.');
  return order[Math.max(0, RANK[risk] - 1 - (years < 5 ? 1 : 0))];
}

/** Realised-series risk statistics on monthly returns (moved from the old advanced.js). */
export function wealthRisk({ returns, benchmark, annualRiskFree, inflation, nominal, annualTax }) {
  if (!Array.isArray(returns) || !Array.isArray(benchmark) || returns.length !== benchmark.length || returns.length < 2 || [...returns, ...benchmark].some((x) => !Number.isFinite(x) || x <= -1) || [annualRiskFree, inflation, nominal, annualTax].some((x) => !Number.isFinite(x)) || annualRiskFree <= -1 || inflation <= -1 || nominal <= -1 || annualTax < 0 || annualTax > 1) {
    throw Error('Return series must be the same length (at least 2 months) and every value above −100%.');
  }
  const n = returns.length, mean = returns.reduce((s, x) => s + x, 0) / n, rf = (1 + annualRiskFree) ** (1 / 12) - 1;
  const sd = Math.sqrt(returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  const down = Math.sqrt(returns.reduce((s, x) => s + Math.min(0, x - rf) ** 2, 0) / n);
  let value = 1, peak = 1, drawdown = 0, bmValue = 1;
  const growth = [1], benchGrowth = [1], drawdowns = [0];
  returns.forEach((r, i) => {
    value *= 1 + r; bmValue *= 1 + benchmark[i];
    peak = Math.max(peak, value); drawdown = Math.max(drawdown, 1 - value / peak);
    growth.push(value); benchGrowth.push(bmValue); drawdowns.push(-(1 - value / peak));
  });
  const active = returns.map((r, i) => r - benchmark[i]), am = active.reduce((s, x) => s + x, 0) / n;
  const te = Math.sqrt(active.reduce((s, x) => s + (x - am) ** 2, 0) / (n - 1));
  const afterTax = nominal - Math.max(0, nominal) * annualTax;
  return {
    annualizedReturn: value ** (12 / n) - 1, benchmarkReturn: bmValue ** (12 / n) - 1,
    volatility: sd * Math.sqrt(12), sharpe: sd > 0 ? ((mean - rf) / sd) * Math.sqrt(12) : null,
    sortino: down > 0 ? ((mean - rf) / down) * Math.sqrt(12) : null,
    trackingError: te * Math.sqrt(12), informationRatio: te > 0 ? (am / te) * Math.sqrt(12) : null,
    drawdown, realAfterTax: (1 + afterTax) / (1 + inflation) - 1, growth, benchGrowth, drawdowns,
  };
}

/** One call that powers the plan view. */
export function analyzePlan({ risk = 'Medium', weights = PRESETS.balanced.weights, pv = 1_500_000, monthly = 30_000, years = 12, goal = 10_000_000, feePct = 0.7, inflation = 0.05, real = false, stepUp = 0, currentWeights = [0.6, 0.2, 0.1, 0.1], band = 0.05, costBps = 25, confidence = 0.8, seed = 2026 } = {}) {
  const fee = feePct / 100;
  const { annualReturn, volatility } = portfolioMoments(weights, fee);
  const base = { pv, years, goal, annualReturn, volatility, seed, inflation, real, stepUp };
  const sim = simulate({ ...base, monthly });
  const deterministic = projectFixed({ pv, monthly, years, rate: annualReturn, stepUp }).at(-1);
  return {
    inputs: { risk, weights, pv, monthly, years, goal, feePct, inflation, real, stepUp, currentWeights, band, costBps, confidence },
    annualReturn, volatility, sim, riskBand: riskBand(weights),
    deterministic: real ? deterministic / (1 + inflation) ** years : deterministic,
    required: requiredMonthly({ ...base, confidence }),
    delay: costOfDelay({ pv, monthly, years, rate: annualReturn, stepUp, delay: Math.min(3, years) }),
    contributions: riskContributions(weights),
    stresses: stressScenarios(weights, pv),
    trades: rebalancePortfolio(pv, currentWeights, weights, { band, costBps }),
    suitability: assessSuitability(risk, weights),
    recommended: recommendPreset(risk, years),
  };
}

/** Kept for the original tests and for anyone using preset-based analysis. */
export function analyzeWealth({ preset = 'balanced', risk = 'Medium', pv = 1500000, monthly = 30000, years = 12, goal = 10000000, feePct = 0.7, currentWeights = [0.6, 0.2, 0.1, 0.1], seed = 2026 } = {}) {
  if (!(preset in PRESETS)) throw Error('Unknown portfolio style.');
  const weights = PRESETS[preset].weights, { annualReturn, volatility } = portfolioMoments(weights, feePct / 100);
  return {
    preset, risk, pv, monthly, years, goal, feePct, weights, currentWeights, annualReturn, volatility,
    projection: futureValue(pv, monthly, years, annualReturn),
    sim: simulatePortfolio({ pv, monthly, years, goal, annualReturn, volatility, seed }),
    stresses: stressScenarios(weights, pv), trades: rebalancePortfolio(pv, currentWeights, weights), suitability: assessSuitability(risk, preset),
  };
}

const L = (x) => `INR ${Math.round(x).toLocaleString('en-IN')}`;
export function planMemo(a) {
  const i = a.inputs, basis = i.real ? `today's rupees (deflated at ${(i.inflation * 100).toFixed(1)}% a year)` : 'nominal rupees';
  return [
    'AUREL | CLIENT PLAN REVIEW (HYPOTHETICAL)',
    'Fictional household. Every market assumption is illustrative. Not investment advice.',
    '',
    'CLIENT POSITION',
    `Stated risk tolerance: ${i.risk}. Model risk band of chosen mix: ${a.riskBand}.`,
    `Invested today: ${L(i.pv)}. Monthly contribution: ${L(i.monthly)}${i.stepUp ? `, stepping up ${(i.stepUp * 100).toFixed(1)}% a year` : ''}.`,
    `Horizon: ${i.years} years. Goal: ${L(i.goal)} in ${basis}.`,
    '',
    'ALLOCATION',
    ...ASSETS.map((x, k) => `${x.name.padEnd(26)} ${(i.weights[k] * 100).toFixed(0).padStart(3)}%   risk share ${(a.contributions[k] * 100).toFixed(0)}%`),
    `Expected net return ${(a.annualReturn * 100).toFixed(2)}% after ${i.feePct}% costs; modelled volatility ${(a.volatility * 100).toFixed(2)}%.`,
    '',
    'OUTCOMES (1,000 seeded paths)',
    `Chance of reaching goal: ${(a.sim.goalProbability * 100).toFixed(0)}%.`,
    `Ending value p10 / p50 / p90: ${L(a.sim.p10)} / ${L(a.sim.median)} / ${L(a.sim.p90)}.`,
    `Average shortfall when the goal is missed: ${L(a.sim.averageShortfall)}.`,
    a.required === null ? `No contribution up to INR 10 lakh a month reaches ${(i.confidence * 100).toFixed(0)}% confidence.` : `Monthly contribution for ${(i.confidence * 100).toFixed(0)}% confidence: ${L(a.required)}.`,
    `Waiting 3 years to start contributions costs about ${L(a.delay.cost)} of nominal ending wealth.`,
    '',
    'STRESS (instant shock to today\'s portfolio)',
    ...a.stresses.map((s) => `${s.name.padEnd(26)} ${s.changePct.toFixed(1).padStart(6)}%   ${L(s.changeAmount)}`),
    '',
    'REBALANCING',
    a.trades.breached ? `Drift exceeds the ${(i.band * 100).toFixed(0)}% band. Turnover ${L(a.trades.turnover)}, estimated cost ${L(a.trades.cost)}.` : `All holdings within the ${(i.band * 100).toFixed(0)}% drift band. No trades proposed.`,
    ...a.trades.map((t) => `${t.asset.padEnd(26)} ${t.trade >= 0 ? 'Buy ' : 'Sell'} ${L(Math.abs(t.trade))}`),
    '',
    `SUITABILITY NOTE: ${a.suitability}`,
    '',
    'LIMITATIONS',
    'Annual log-normal returns with fixed correlations; contributions approximated at mid-year. No taxes, exit loads or behavioural factors. Assumptions are hypothetical and the output is a teaching illustration, not a recommendation.',
  ].join('\n');
}

/** Original memo name, still used by the original tests. */
export function wealthMemo(a) {
  return `AUREL | HYPOTHETICAL CLIENT PORTFOLIO REVIEW\nRisk tolerance: ${a.risk} | Chosen model: ${PRESETS[a.preset].name}\nDeterministic projection: ${L(a.projection)}\nGoal-hit frequency: ${(a.sim.goalProbability * 100).toFixed(1)}%\nSuitability check: ${a.suitability}`;
}
