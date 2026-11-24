import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSETS, PRESETS, portfolioMoments, weightedMoments, riskContributions, futureValue, simulate, simulatePortfolio,
  requiredMonthly, costOfDelay, projectFixed, frontier, stressScenarios, rebalancePortfolio, assessSuitability, riskBand,
  recommendPreset, wealthRisk, analyzePlan, analyzeWealth, planMemo,
} from '../src/engine.js';

const approx = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

test('moments respect allocation and reject weights that do not total 100%', () => {
  const m = portfolioMoments(PRESETS.balanced.weights, 0.007);
  assert.ok(m.annualReturn > 0 && m.annualReturn < 0.2);
  assert.ok(m.volatility > 0);
  assert.equal(weightedMoments, portfolioMoments);
  assert.throws(() => portfolioMoments([0.6, 0.3, 0.1, 0.1]), /100%/);
  // 100% cash: return equals cash assumption, volatility equals cash vol.
  const cash = portfolioMoments([0, 0, 0, 1]);
  approx(cash.annualReturn, ASSETS[3].mu); approx(cash.volatility, ASSETS[3].vol);
});

test('risk contributions sum to one and equities dominate a growth mix', () => {
  const rc = riskContributions(PRESETS.growth.weights);
  approx(rc.reduce((a, b) => a + b, 0), 1, 1e-9);
  assert.ok(rc[0] > 0.8, `equity share ${rc[0]}`);
});

test('future value: zero-rate identity and positive growth', () => {
  approx(futureValue(1000, 100, 1, 0), 2200);
  assert.ok(futureValue(1000, 100, 1, 0.1) > 2200);
});

test('simulation is reproducible, bands are ordered and start at today\'s value', () => {
  const x = { pv: 100000, monthly: 1000, years: 5, goal: 150000, annualReturn: 0.06, volatility: 0.12, paths: 1000, seed: 10 };
  const a = simulate(x), b = simulate(x);
  assert.deepEqual(a, b);
  for (let y = 0; y <= 5; y++) {
    const { p10, p25, p50, p75, p90 } = a.bands;
    assert.ok(p10[y] <= p25[y] && p25[y] <= p50[y] && p50[y] <= p75[y] && p75[y] <= p90[y]);
  }
  approx(a.bands.p50[0], 100000);
  assert.ok(a.goalProbability >= 0 && a.goalProbability <= 1);
  const legacy = simulatePortfolio(x);
  assert.ok(legacy.p10 <= legacy.median && legacy.median <= legacy.p90);
});

test('real terms deflate outcomes; step-up raises total contributions', () => {
  const x = { pv: 1e6, monthly: 20000, years: 10, goal: 5e6, annualReturn: 0.08, volatility: 0.12, seed: 3 };
  const nominal = simulate(x), real = simulate({ ...x, real: true, inflation: 0.05 });
  approx(real.median, nominal.median / 1.05 ** 10, 1e-3);
  assert.ok(real.goalProbability <= nominal.goalProbability);
  assert.ok(simulate({ ...x, stepUp: 0.08 }).totalContributed > nominal.totalContributed);
});

test('required monthly contribution actually achieves the requested confidence', () => {
  const base = { pv: 500000, years: 10, goal: 6e6, annualReturn: 0.09, volatility: 0.14, seed: 11 };
  const m = requiredMonthly({ ...base, confidence: 0.8 });
  assert.ok(m > 0);
  assert.ok(simulate({ ...base, monthly: m, paths: 600 }).goalProbability >= 0.8);
  assert.ok(simulate({ ...base, monthly: Math.max(0, m - 1000), paths: 600 }).goalProbability < 0.8);
  assert.equal(requiredMonthly({ ...base, goal: 1000, confidence: 0.8 }), 0);
});

test('fixed projection: zero rate sums contributions, step-up and delay behave', () => {
  approx(projectFixed({ pv: 1000, monthly: 100, years: 2, rate: 0 }).at(-1), 3400);
  approx(projectFixed({ pv: 0, monthly: 100, years: 2, rate: 0, stepUp: 0.1 }).at(-1), 1200 + 1320);
  approx(projectFixed({ pv: 0, monthly: 100, years: 3, rate: 0, delay: 2 }).at(-1), 1200);
});

test('cost of delay is zero with no delay and grows with delay', () => {
  const x = { pv: 1.5e6, monthly: 30000, years: 12, rate: 0.08 };
  approx(costOfDelay({ ...x, delay: 0 }).cost, 0, 1e-6);
  assert.ok(costOfDelay({ ...x, delay: 5 }).cost > costOfDelay({ ...x, delay: 2 }).cost);
  assert.throws(() => costOfDelay({ ...x, delay: 1.5 }));
});

test('frontier samples are valid portfolios and best Sharpe is the maximum', () => {
  const f = frontier({ samples: 300, seed: 2 });
  assert.equal(f.points.length, 300);
  for (const p of f.points) approx(p.weights.reduce((a, b) => a + b, 0), 1, 1e-9);
  assert.equal(f.best.sharpe, Math.max(...f.points.map((p) => p.sharpe)));
});

test('rebalancing nets to zero, respects drift band and prices turnover', () => {
  const t = rebalancePortfolio(100000, [0.6, 0.2, 0.1, 0.1], [0.45, 0.35, 0.1, 0.1], { costBps: 25 });
  approx(t.reduce((s, x) => s + x.trade, 0), 0); approx(t[0].trade, -15000); approx(t[1].trade, 15000);
  approx(t.turnover, 15000); approx(t.cost, 75);
  const quiet = rebalancePortfolio(100000, [0.47, 0.33, 0.1, 0.1], [0.45, 0.35, 0.1, 0.1], { band: 0.05 });
  assert.equal(quiet.breached, false); assert.ok(quiet.every((x) => x.trade === 0));
});

test('stress scenarios, suitability and recommendations', () => {
  const s = stressScenarios([0.45, 0.35, 0.1, 0.1], 100000);
  assert.equal(s.length, 5); approx(s[0].changePct, (0.45 * -0.3 + 0.35 * -0.04 + 0.1 * 0.08) * 100);
  assert.match(assessSuitability('Low', 'growth'), /higher model risk/);
  assert.match(assessSuitability('High', 'conservative'), /does not exceed/);
  assert.equal(riskBand(PRESETS.conservative.weights), 'Low');
  assert.equal(riskBand(PRESETS.growth.weights), 'High');
  assert.equal(recommendPreset('High', 3), 'balanced');
  assert.equal(recommendPreset('High', 15), 'growth');
});

test('realised risk statistics: drawdown, purchasing power and undefined ratios', () => {
  const x = { returns: [0.1, -0.2, 0.1], benchmark: [0, 0, 0], annualRiskFree: 0, inflation: 0.05, nominal: 0.1, annualTax: 0.2 };
  const a = wealthRisk(x);
  approx(a.drawdown, 0.2); assert.equal(a.benchmarkReturn, 0); approx(a.realAfterTax, 1.08 / 1.05 - 1);
  assert.equal(a.growth.length, 4);
  assert.throws(() => wealthRisk({ ...x, benchmark: [0] }));
  assert.equal(wealthRisk({ ...x, returns: [0, 0, 0] }).sharpe, null);
});

test('analyzePlan wires everything together and the memo states its limits', () => {
  const a = analyzePlan();
  assert.equal(a.trades.length, 4); assert.equal(a.stresses.length, 5);
  assert.ok(a.required === null || a.required >= 0);
  assert.match(planMemo(a), /not a recommendation/);
  const legacy = analyzeWealth({});
  assert.equal(legacy.trades.length, 4);
});
