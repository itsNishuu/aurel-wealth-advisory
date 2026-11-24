import { ASSETS, PRESETS, analyzePlan, frontier, portfolioMoments, wealthRisk, planMemo, costOfDelay } from './engine.js';
import { lineChart, barChart, scatterChart, donutChart, mount, lineHover } from './charts.js';
import { $, $$, esc, rupees, pct, download, router, field } from './dom.js';

const YEAR = new Date().getFullYear();
const state = {
  weights: [...PRESETS.balanced.weights],
  draft: PRESETS.balanced.weights.map((w) => w * 100),
  current: [60, 20, 10, 10],
  plan: null,
};

/** ₹ in lakh/crore, compact enough for axis ticks. */
const compact = (v) => (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(Math.abs(v) % 1e7 ? 1 : 0)} cr` : `₹${Math.round(v / 1e5)} L`);

function readInputs() {
  const risk = $('input[name="risk"]:checked').value;
  const years = Math.round(field('years'));
  if (years < 1 || years > 40) throw Error('Horizon must be between 1 and 40 years.');
  return {
    risk, years,
    pv: field('pv'), monthly: field('monthly'), goal: field('goal'),
    stepUp: field('stepUp', { percent: true }), feePct: field('feePct'),
    inflation: field('inflation', { percent: true }), real: $('#real').checked,
    confidence: Number($('#confidence').value),
    weights: state.weights,
    currentWeights: state.current.map((x) => x / 100),
    band: field('band', { percent: true }), costBps: field('costBps'),
  };
}

function recalc() {
  try {
    const sum = state.current.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 0.01) throw Error(`Current holdings add up to ${sum}%. They need to total 100%.`);
    state.plan = analyzePlan(readInputs());
    $('#err').hidden = true;
    renderAll();
  } catch (e) {
    $('#err').hidden = false;
    $('#err').textContent = e.message;
  }
}
let timer;
const schedule = () => { clearTimeout(timer); timer = setTimeout(recalc, 140); };

/* ---------------- Plan ---------------- */
function renderPlan(a) {
  const i = a.inputs, s = a.sim, by = YEAR + i.years;
  const chance = Math.round(s.goalProbability * 100);
  $('#headline').innerHTML = `<strong>${chance}%</strong> of 1,000 simulated futures reach ${esc(rupees(i.goal))}${i.real ? " in today's money" : ''} by ${by}.`;
  $('#lede').textContent = `The middle outcome is ${rupees(s.median)}. In a poor run of markets (the 10th percentile) the pot ends near ${rupees(s.p10)}; in a strong one, ${rupees(s.p90)}. The fixed-return projection most calculators show would say ${rupees(a.deterministic)}.`;
  $('#basis').textContent = i.real ? `In today's rupees, after ${(i.inflation * 100).toFixed(1)}% inflation` : 'Nominal rupees, before inflation';

  const labels = s.bands.p50.map((_, k) => (k === 0 ? 'Today' : String(YEAR + k)));
  const el = $('#fanChart');
  mount(el, (width) => {
    const c = lineChart({
      width, height: width < 600 ? 260 : 340, labels, yFormat: compact, label: 'Range of simulated portfolio values by year',
      bands: [{ lo: s.bands.p10, hi: s.bands.p90 }, { lo: s.bands.p25, hi: s.bands.p75, cls: 'inner' }],
      series: [{ values: s.bands.p50 }],
      refs: [{ y: i.goal, label: `Goal ${compact(i.goal)}` }],
    });
    return { svg: c.svg, after: (node) => lineHover(node, { ...c, count: labels.length }, (k) => `<b>${labels[k]}</b><br>90th: ${rupees(s.bands.p90[k])}<br>Median: ${rupees(s.bands.p50[k])}<br>10th: ${rupees(s.bands.p10[k])}`) };
  });

  const conf = Math.round(i.confidence * 100);
  if (a.required === null) {
    $('#required').textContent = 'Out of reach';
    $('#requiredNote').textContent = `No contribution up to ₹10 L a month gets to ${conf}%. Extend the horizon or revisit the goal.`;
  } else {
    $('#required').textContent = `${rupees(a.required, { short: false })} a month`;
    const gap = a.required - i.monthly;
    $('#requiredNote').textContent = gap > 0 ? `${rupees(gap, { short: false })} more than today's ${rupees(i.monthly, { short: false })}, with the same step-up.` : `Today's ${rupees(i.monthly, { short: false })} already clears it.`;
  }
  $('#shortfall').textContent = s.goalProbability >= 0.999 ? 'Rarely missed' : rupees(s.averageShortfall);
  $('#shortfallNote').textContent = s.goalProbability >= 0.999 ? 'Fewer than 1 in 1,000 paths fall short.' : `Across the ${100 - chance}% of paths that fall short of the goal.`;
  $('#contributed').textContent = `${(s.median / s.totalContributed).toFixed(1)}× money in`;
  $('#contributedNote').textContent = `${rupees(s.totalContributed)} invested in total; median ending value ${rupees(s.median)}.`;
  renderDelay();
}

function renderDelay() {
  const a = state.plan; if (!a) return;
  const i = a.inputs, d = Math.min(Number($('#delay').value), i.years);
  $('#delay').max = String(Math.min(10, i.years));
  $('#delayOut').textContent = d === 0 ? 'now' : `${d} year${d === 1 ? '' : 's'}`;
  const later = costOfDelay({ pv: i.pv, monthly: i.monthly, years: i.years, rate: a.annualReturn, stepUp: i.stepUp, delay: d });
  $('#onTime').textContent = rupees(later.onTime);
  $('#delayed').textContent = rupees(later.delayed);
  $('#delayCost').textContent = rupees(later.cost);
  const labels = later.path.map((_, k) => String(YEAR + k + 1));
  mount($('#delayChart'), (width) => lineChart({
    width, height: 190, labels, yFormat: compact, label: 'Portfolio value starting now versus later',
    series: [{ values: later.onTimePath, cls: 'now' }, { values: later.path, cls: 'alt', dash: true }],
  }).svg);
}

/* ---------------- Allocation ---------------- */
function buildSliders() {
  const colors = ['var(--spruce)', '#6f9aa6', 'var(--brass)', '#c3ccd6'];
  $('#weights').innerHTML = ASSETS.map((x, k) => `
    <div class="slider">
      <i style="background:${colors[k]}"></i>
      <label for="w${k}">${esc(x.name)}</label>
      <input type="number" id="wn${k}" min="0" max="100" step="1" aria-label="${esc(x.name)} percent">
      <input type="range" id="w${k}" min="0" max="100" step="1" aria-describedby="wsum">
    </div>`).join('') + '<p class="sum" id="wsum"></p>';
  ASSETS.forEach((_, k) => {
    for (const id of [`w${k}`, `wn${k}`]) {
      $(`#${id}`).addEventListener('input', (e) => { state.draft[k] = Number(e.target.value) || 0; syncSliders(); applyDraft(); });
    }
  });
  $$('.presets button').forEach((b) => b.addEventListener('click', () => {
    state.draft = PRESETS[b.dataset.preset].weights.map((w) => w * 100);
    syncSliders(); applyDraft();
  }));
}

function syncSliders() {
  state.draft.forEach((v, k) => { $(`#w${k}`).value = v; $(`#wn${k}`).value = v; });
  const sum = state.draft.reduce((a, b) => a + b, 0);
  $('#wsum').innerHTML = Math.abs(sum - 100) < 0.01
    ? `<span>Total</span><strong>100%</strong>`
    : `<span>Total <strong class="bad">${sum}%</strong>. The mix must add up to 100%.</span><button type="button" id="normalise">Scale to 100%</button>`;
  $('#normalise')?.addEventListener('click', () => {
    const t = state.draft.reduce((a, b) => a + b, 0) || 1;
    state.draft = state.draft.map((v) => Math.round((v / t) * 100));
    state.draft[0] += 100 - state.draft.reduce((a, b) => a + b, 0);
    syncSliders(); applyDraft();
  });
  for (const b of $$('.presets button')) {
    const w = PRESETS[b.dataset.preset].weights;
    b.setAttribute('aria-pressed', String(w.every((x, k) => Math.abs(x * 100 - state.draft[k]) < 0.01)));
  }
}

function applyDraft() {
  if (Math.abs(state.draft.reduce((a, b) => a + b, 0) - 100) > 0.01) return;
  state.weights = state.draft.map((v) => v / 100);
  schedule();
}

function renderAllocation(a) {
  const i = a.inputs;
  $('#mRet').textContent = pct(a.annualReturn, 2);
  $('#mVol').textContent = pct(a.volatility, 2);
  $('#mBand').textContent = a.riskBand;
  const over = /higher model risk/.test(a.suitability);
  $('#suitability').className = `note${over ? ' warn' : ''}`;
  $('#suitability').textContent = `${over ? `This mix sits in the ${a.riskBand.toLowerCase()} risk band, above the client's stated ${i.risk.toLowerCase()} tolerance.` : `This mix sits in the ${a.riskBand.toLowerCase()} risk band, within the client's stated ${i.risk.toLowerCase()} tolerance.`} For a ${i.years}-year horizon the starting model would be ${PRESETS[a.recommended].name.toLowerCase()}. This is a comparison of numbers, not a suitability assessment.`;
  mount($('#donut'), () => donutChart({ size: 170, center: pct(i.weights[0], 0), sub: 'in equities', label: 'Allocation', slices: ASSETS.map((x, k) => ({ label: `${x.name} ${pct(i.weights[k], 0)}`, value: i.weights[k], cls: `s${k}` })) }));
  mount($('#riskShare'), (width) => barChart({
    width, format: (v) => `${Math.round(v)}%`, label: 'Capital versus risk share by asset', rowHeight: 26,
    items: ASSETS.flatMap((x, k) => [
      { label: `${x.name}, capital`, value: i.weights[k] * 100, cls: 'cap' },
      { label: 'risk', value: a.contributions[k] * 100, cls: 'risk' },
    ]),
  }));
  const f = frontier({ fee: i.feePct / 100 });
  const isPreset = (w) => w.every((x, k) => Math.abs(x - i.weights[k]) < 1e-9);
  const presetPts = Object.entries(PRESETS).map(([key, p]) => {
    const m = portfolioMoments(p.weights, i.feePct / 100);
    const name = { conservative: 'Preservation', balanced: 'Balanced', growth: 'Growth' }[key];
    return { x: m.volatility * 100, y: m.annualReturn * 100, r: 6, cls: 'preset', tag: isPreset(p.weights) ? `${name} (this mix)` : name, label: p.name };
  });
  const custom = !Object.values(PRESETS).some((p) => isPreset(p.weights));
  mount($('#frontier'), (width) => scatterChart({
    width, height: 320, xLabel: 'Volatility (%)', yLabel: 'Expected return after costs (%)', xFormat: (v) => v.toFixed(0), yFormat: (v) => v.toFixed(1),
    label: 'Random portfolios by risk and return',
    points: [
      ...f.points.map((p) => ({ x: p.vol * 100, y: p.ret * 100, r: 2.6 })),
      { x: f.best.vol * 100, y: f.best.ret * 100, r: 10, cls: 'best', label: `Best return per unit of risk: ${ASSETS.map((x, k) => `${x.name} ${pct(f.best.weights[k], 0)}`).join(', ')}` },
      ...presetPts,
      { x: a.volatility * 100, y: a.annualReturn * 100, r: 7, cls: 'current', tag: custom ? 'This mix' : '', tagDy: 14, label: 'Current plan mix' },
    ],
  }));
}

/* ---------------- Risk ---------------- */
function renderStress(a) {
  mount($('#stressChart'), (width) => barChart({
    width, rowHeight: 40, format: (v) => rupees(v), label: 'Instant change in portfolio value by scenario',
    items: a.stresses.map((s) => ({ label: `${s.name} (${s.changePct > 0 ? '+' : ''}${s.changePct.toFixed(1)}%)`, value: s.changeAmount })),
  }));
}

function renderSeries() {
  try {
    const parse = (id) => $(id).value.split(/[\s,;]+/).filter(Boolean).map((x) => Number(x) / 100);
    const r = wealthRisk({ returns: parse('#rets'), benchmark: parse('#bench'), annualRiskFree: field('rf', { percent: true }), inflation: state.plan?.inputs.inflation ?? 0.05, nominal: 0.1, annualTax: field('tax', { percent: true }) });
    $('#seriesErr').hidden = true;
    const ratio = (v) => (v === null ? 'n/a' : v.toFixed(2));
    $('#seriesStats').innerHTML = [
      ['Annualised return', pct(r.annualizedReturn)], ['Benchmark', pct(r.benchmarkReturn)], ['Volatility', pct(r.volatility)],
      ['Sharpe ratio', ratio(r.sharpe)], ['Sortino ratio', ratio(r.sortino)], ['Worst drawdown', pct(-r.drawdown)],
      ['Tracking error', pct(r.trackingError)], ['Information ratio', ratio(r.informationRatio)],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const labels = r.growth.map((_, k) => (k === 0 ? 'Start' : `M${k}`));
    mount($('#growthChart'), (width) => lineChart({ width, height: 220, labels, yMin: Math.min(...r.growth, ...r.benchGrowth) * 0.98, yFormat: (v) => `₹${v.toFixed(2)}`, series: [{ values: r.growth }, { values: r.benchGrowth, cls: 'alt', dash: true }], label: 'Growth of one rupee, portfolio and benchmark' }).svg);
    mount($('#ddChart'), (width) => lineChart({ width, height: 220, labels, yFormat: (v) => `${(v * 100).toFixed(0)}%`, series: [{ values: r.drawdowns, cls: 'alt' }], label: 'Drawdown from previous peak' }).svg);
  } catch (e) {
    $('#seriesErr').hidden = false; $('#seriesErr').textContent = e.message;
  }
}

/* ---------------- Rebalance ---------------- */
function buildHoldings() {
  $('#holdings').innerHTML = ASSETS.map((x, k) => `<label class="f">${esc(x.name)} now (%)<input type="number" id="h${k}" min="0" max="100" step="1" value="${state.current[k]}"></label>`).join('');
  ASSETS.forEach((_, k) => $(`#h${k}`).addEventListener('input', (e) => { state.current[k] = Number(e.target.value) || 0; schedule(); }));
}

function renderRebalance(a) {
  const t = a.trades, band = a.inputs.band * 100;
  $('#rebSummary').className = `note${t.breached ? ' warn' : ''}`;
  $('#rebSummary').textContent = t.breached
    ? `At least one asset is more than ${band.toFixed(0)} points from target. Rebalancing moves ${rupees(t.turnover)} and costs about ${rupees(t.cost, { short: false })} at ${a.inputs.costBps} basis points.`
    : `Every asset is within ${band.toFixed(0)} points of target. No trades needed, which avoids ${rupees(0, { short: false })} of dealing costs and any tax on gains.`;
  const scale = 25; // ±25 points maps to the full bar
  $('#tradeRows').innerHTML = t.map((r) => {
    const d = r.drift * 100, w = Math.min(50, (Math.abs(d) / scale) * 50);
    const action = r.trade > 0 ? `<span class="buy">Buy ${rupees(r.trade)}</span>` : r.trade < 0 ? `<span class="sell">Sell ${rupees(-r.trade)}</span>` : '<span class="hold">Hold</span>';
    return `<tr><td>${esc(r.asset)}</td><td>${pct(r.currentWeight, 0)}</td><td>${pct(r.targetWeight, 0)}</td><td>${d > 0 ? '+' : ''}${d.toFixed(0)} pts</td>
      <td><div class="driftbar" style="--band:${Math.min(50, (band / scale) * 50)}%" role="img" aria-label="Drift ${d.toFixed(0)} points against a ${band.toFixed(0)} point band"><span class="${r.breach ? 'out' : ''}" style="left:${d >= 0 ? 50 : 50 - w}%;width:${w}%"></span></div></td><td>${action}</td></tr>`;
  }).join('');
}

/* ---------------- Report ---------------- */
function renderReport(a) {
  const i = a.inputs, s = a.sim, date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  $('#letter').innerHTML = `
    <h1>Plan review for the Rao household</h1>
    <p class="meta">Prepared ${date}. Fictional client and hypothetical assumptions, for illustration only.</p>
    <p>You asked whether ${rupees(i.pv)} invested today, plus ${rupees(i.monthly, { short: false })} a month${i.stepUp ? ` rising ${pct(i.stepUp)} each year` : ''}, can reach ${rupees(i.goal)} within ${i.years} years. Across 1,000 simulated market paths, it does so ${Math.round(s.goalProbability * 100)}% of the time${i.real ? `, measured in today's rupees` : ''}.</p>
    <h2>What the range of outcomes looks like</h2>
    <table><thead><tr><th>Outcome</th><th>Ending value</th></tr></thead><tbody>
      <tr><td>Poor markets (10th percentile)</td><td>${rupees(s.p10)}</td></tr>
      <tr><td>Middle outcome (median)</td><td>${rupees(s.median)}</td></tr>
      <tr><td>Strong markets (90th percentile)</td><td>${rupees(s.p90)}</td></tr></tbody></table>
    <p>${a.required === null ? 'The goal is not reachable at high confidence with contributions alone; a longer horizon or a revised target is the conversation to have.' : `To reach the goal in ${Math.round(i.confidence * 100)}% of paths, the monthly contribution would need to be ${rupees(a.required, { short: false })}.`} Waiting three years before contributing would give up about ${rupees(a.delay.cost)}.</p>
    <h2>The portfolio</h2>
    <table><thead><tr><th>Asset</th><th>Weight</th><th>Share of risk</th></tr></thead><tbody>
      ${ASSETS.map((x, k) => `<tr><td>${esc(x.name)}</td><td>${pct(i.weights[k], 0)}</td><td>${pct(a.contributions[k], 0)}</td></tr>`).join('')}</tbody></table>
    <p>Expected return after ${i.feePct}% annual costs is ${pct(a.annualReturn, 2)} with modelled volatility of ${pct(a.volatility, 2)}. ${a.suitability}</p>
    <h2>If markets turn</h2>
    <p>${a.stresses.filter((x) => x.changeAmount < 0).map((x) => `${x.name}: ${rupees(x.changeAmount)}`).join('. ')}.</p>
    <h2>Rebalancing</h2>
    <p>${a.trades.breached ? `Holdings have drifted outside the ${pct(i.band, 0)} band. Proposed turnover is ${rupees(a.trades.turnover)} at an estimated cost of ${rupees(a.trades.cost, { short: false })}.` : `Holdings are within the ${pct(i.band, 0)} tolerance band, so no trades are proposed.`}</p>
    <p class="sign">These figures come from simplified annual return assumptions, fixed correlations and no taxes. They are a teaching illustration, not a recommendation to buy or sell anything.</p>`;
}

function renderAll() {
  const a = state.plan;
  renderPlan(a); renderAllocation(a); renderStress(a); renderRebalance(a); renderReport(a);
}

/* ---------------- Wiring ---------------- */
buildSliders(); syncSliders(); buildHoldings();
$('#inputs').addEventListener('input', schedule);
$('#inputs').addEventListener('submit', (e) => e.preventDefault());
$('#confidence').addEventListener('change', schedule);
$('#band').addEventListener('input', schedule);
$('#costBps').addEventListener('input', schedule);
$('#delay').addEventListener('input', renderDelay);
$('#seriesForm').addEventListener('submit', (e) => { e.preventDefault(); renderSeries(); });
$('#print').addEventListener('click', () => print());
$('#export').addEventListener('click', () => state.plan && download('aurel-plan-review.txt', planMemo(state.plan)));
if (matchMedia('(max-width: 760px)').matches) $('#brief-toggle').open = false;

router($$('[data-view]'), (id) => {
  document.title = `Aurel — ${{ plan: 'wealth plan review', allocation: 'allocation', risk: 'risk', rebalance: 'rebalancing', report: 'client report' }[id]}`;
  // Charts in hidden sections measure 0 wide; redraw once visible.
  if (state.plan) requestAnimationFrame(() => { renderAll(); if (id === 'risk') renderSeries(); });
});
recalc();
renderSeries();
