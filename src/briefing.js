// Start here page for Aurel: live headline figures, a saved exploration checklist, section tracking and a glossary filter.
import { analyzePlan } from './engine.js';
import { rupees } from './dom.js';

/** Headline figures for the app's default client brief, computed by the real engine. */
export function snapshot() {
  const a = analyzePlan({ stepUp: 0.05 });
  const s = a.sim, by = new Date().getFullYear() + a.inputs.years;
  return [
    { value: `${Math.round(s.goalProbability * 100)}%`, label: `of 1,000 simulated futures reach ${rupees(a.inputs.goal)} by ${by}` },
    { value: rupees(s.median), label: 'the middle (median) outcome' },
    { value: rupees(s.p10), label: 'after a poor run of markets (10th percentile)' },
    { value: a.required === null ? 'Out of reach' : `${rupees(a.required, { short: false })}`, label: 'a month needed for 80% confidence' },
  ];
}

const KEY = 'aurel-wealth-advisory:checklist';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $$ = (sel) => [...document.querySelectorAll(sel)];

function renderLive() {
  const box = document.querySelector('[data-live]');
  if (!box) return;
  const figs = box.querySelector('.b-live-figs');
  try {
    figs.innerHTML = snapshot().map((f) => `<div class="b-fig"><span class="b-fig-v">${esc(f.value)}</span><span class="b-fig-l">${esc(f.label)}</span></div>`).join('');
    box.dataset.state = 'ready';
  } catch {
    figs.innerHTML = '<p class="b-live-err">The live figures could not be calculated in this browser. <a href="index.html">Open the app</a> to see them.</p>';
    box.dataset.state = 'error';
  }
}

function checklist() {
  const boxes = $$('[data-check]');
  if (!boxes.length) return;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* storage unavailable: start empty */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* ignore */ } };
  const update = () => {
    const done = boxes.filter((b) => b.checked).length;
    for (const el of $$('[data-done]')) el.textContent = done;
    for (const el of $$('[data-bar]')) el.style.width = `${(done / boxes.length) * 100}%`;
    for (const b of boxes) b.closest('tr')?.classList.toggle('is-done', b.checked);
    const msg = document.querySelector('[data-complete]');
    if (msg) msg.hidden = done !== boxes.length;
  };
  for (const b of boxes) {
    b.checked = saved[b.dataset.check] === true;
    b.addEventListener('change', () => { saved[b.dataset.check] = b.checked; persist(); update(); });
  }
  // Following a "Where" link counts as exploring that step.
  for (const a of $$('.b-check a[href^="index.html#"]')) {
    a.addEventListener('click', () => {
      const b = a.closest('tr')?.querySelector('[data-check]');
      if (b && !b.checked) { b.checked = true; saved[b.dataset.check] = true; persist(); update(); }
    });
  }
  document.querySelector('[data-reset]')?.addEventListener('click', () => {
    saved = {};
    for (const b of boxes) b.checked = false;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    update();
  });
  update();
}

function trackSections() {
  const links = new Map($$('.b-side a[href^="#"]').map((a) => [a.getAttribute('href').slice(1), a]));
  if (!('IntersectionObserver' in window) || !links.size) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const a of links.values()) a.removeAttribute('aria-current');
      links.get(e.target.id)?.setAttribute('aria-current', 'location');
    }
  }, { rootMargin: '-25% 0px -65% 0px' });
  for (const id of links.keys()) { const s = document.getElementById(id); if (s) io.observe(s); }
}

function glossaryFilter() {
  const input = document.querySelector('[data-filter]');
  if (!input) return;
  const terms = $$('.b-terms > div'), empty = document.querySelector('[data-empty]');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const t of terms) { const hit = !q || t.textContent.toLowerCase().includes(q); t.hidden = !hit; shown += hit ? 1 : 0; }
    empty.hidden = shown > 0;
    empty.querySelector('q').textContent = input.value.trim();
  });
}

function reveal() {
  let els = $$('.reveal');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { for (const e of els) e.classList.add('in'); return; }
  // Reveal anything that is on screen or already scrolled past, so anchor jumps never leave hidden content behind.
  let queued = false;
  const check = () => {
    queued = false;
    const limit = innerHeight * 0.94;
    els = els.filter((e) => { if (e.getBoundingClientRect().top < limit) { e.classList.add('in'); return false; } return true; });
    if (!els.length) { removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll); }
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(check); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  check();
}

if (typeof document !== 'undefined') {
  document.documentElement.classList.add('js');
  renderLive();
  checklist();
  trackSections();
  glossaryFilter();
  reveal();
}
