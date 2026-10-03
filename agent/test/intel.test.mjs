// Offline checks for the Market Intelligence Engine (engine/intel.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { intelligence, indicatorHistory, domHistory, INDICATORS, DOMAIN_SLUG, indSlug, regimeTimeline, similarConditions } from '../../engine/intel.js';
import { IND_DOCS, COMP_DOCS, DOMAIN_DOCS } from '../../engine/indicator_docs.js';
import { compact } from '../../engine/longhist.js';
import { reportModel } from '../../engine/reportmodel.js';

const day = (i, end = '2026-10-03') => new Date(Date.parse(end) - i * 864e5).toISOString().slice(0, 10);
// n daily points ending on `end`, value = fn(k) with k = 0 … n-1 (oldest first)
const series = (n, fn) => Array.from({ length: n }, (_, k) => [day(n - 1 - k), fn(k)]);
function world({ trend = 1, mvrv = 1.6, fng = 55, dxyTrend = 0, etf = 300 } = {}) {
  const close = series(1500, (k) => 30000 * Math.exp(trend * 0.0009 * k) * (1 + 0.02 * Math.sin(k / 9)));
  const rows = series(400, (k) => k).map(([d], k) => ({ date: d, price: close[1100 + k][1], mvrv: mvrv + trend * 0.0005 * (k - 400), dxy: 100 + dxyTrend * 0.02 * k, real10y: 1.8 + dxyTrend * 0.002 * k, us10y: 4.2, hy: 3, vix: 16, ndx: 20000 * (1 + 0.0004 * k), gold: 3000, netLiq: 6000 + 0.5 * k, stables: 2.6e11 * (1 + 0.0004 * k), dvol: 50, fundingAnn: 8, oiOkx: 3e9 * (1 + 0.0004 * k), corrNdx30: 0.3 }));
  const spot = close.at(-1)[1];
  const a = { dataThrough: '2026-10-03T12:00:00Z', metrics: { price: { spot }, etf: { series20: series(25, () => etf) } }, cycle: { charts: { mvrv: series(800, (k) => mvrv) } } };
  const dash = { fng: { series: series(400, () => fng) }, flows: { rows: series(120, (k) => [0, 1000, 1000 + 300 * trend, 2.7e6 - 300 * trend * k]).map(([d, v]) => [d, v[1], v[2], v[3]]) } };
  return { a, rows, pi: { rows: close.slice(0, -1).map(([d, v]) => [d, v]) }, dash, etf: null, nowIso: '2026-10-03T12:00:00Z' };
}

// 1. A rising market: technical supportive, trend force present, grade in range, no NaN anywhere
const up = intelligence(world({ trend: 1 }));
const tech = up.domains.find((d) => d.key === 'tech');
assert.ok(tech.score > 0.3, `technical should be supportive in an uptrend (${tech.score})`);
assert.ok(up.drivers.some((f) => f.id === 'trend'), 'uptrend force detected');
assert.ok(up.grade.value >= 0 && up.grade.value <= 100);
assert.equal(up.domains.length, 5);
assert.ok(!JSON.stringify({ g: up.grade, d: up.domains.map((d) => d.score), f: up.forces }).includes('NaN'));
assert.ok(up.narrative.length >= 3 && up.narrative.every((p) => typeof p === 'string' && p.length > 20));
assert.ok(['Early uptrend', 'Established uptrend', 'Overheated uptrend', 'Correction within an uptrend'].includes(up.cycle.phase), `uptrend regime description (${up.cycle.phase})`);
assert.equal(up.regime.label, 'Bullish', 'structural evidence in a rising market reads bullish');
assert.ok(!('halving' in up.cycle), 'no halving clock in the regime');
assert.ok(['Bullish', 'Neutral', 'Bearish'].includes(up.assessment.label) && up.assessment.why.length > 20);
assert.ok(up.valuation && ['Depressed', 'Attractive', 'Fair', 'Elevated', 'Extreme'].includes(up.valuation.state));
// persistence: the trend has held for the whole 30-day look-back
assert.equal(up.drivers.find((f) => f.id === 'trend').persistence, 30);
// like-for-like changes exist for 2/7/30 days and compare the same indicator set on both dates
for (const k of ['d2', 'd7', 'd30']) { assert.ok(up.changes[k].n >= 8, `${k} compared on ${up.changes[k].n}`); assert.ok(up.changes[k].n <= up.changes[k].of); }

// 2. A falling market with a rising dollar: technical and macro turn against it
const dn = intelligence(world({ trend: -1, mvrv: 0.9, fng: 18, dxyTrend: 1, etf: -400 }));
const t2 = dn.domains.find((d) => d.key === 'tech'), m2 = dn.domains.find((d) => d.key === 'macro');
assert.ok(t2.score < -0.15, `technical should be cautionary in a downtrend (${t2.score})`);
assert.ok(m2.score < 0, `macro should lean negative with a rising dollar and real yields (${m2.score})`);
assert.ok(dn.grade.value < up.grade.value, 'grade lower in the weak world');
assert.ok(dn.offsets.some((f) => f.id === 'trend'), 'downtrend force detected');
assert.equal(dn.regime.label, 'Bearish', 'structural evidence in a falling market reads bearish');
assert.ok(dn.drivers.some((f) => f.id === 'heat'), 'extreme fear read as contrarian support');
assert.ok(['Depressed', 'Attractive'].includes(dn.valuation.state), `MVRV 0.9 reads cheap (${dn.valuation.state})`);

// 3. Extreme greed is read as crowding, not strength
const hot = intelligence(world({ trend: 1, fng: 92 }));
assert.ok(hot.domains.find((d) => d.key === 'sent').score <= -0.15, 'extreme greed caps sentiment');
assert.ok(hot.offsets.some((f) => f.id === 'heat'), 'sentiment overheating force');

// 4. Price only: everything else is "No data", nothing is invented, the engine still answers
const bare = world();
const only = intelligence({ a: { dataThrough: bare.a.dataThrough, metrics: { price: { spot: bare.a.metrics.price.spot } } }, rows: [], pi: bare.pi, dash: null, nowIso: bare.nowIso });
assert.equal(only.domains.find((d) => d.key === 'macro').state, 'No data');
assert.equal(only.domains.find((d) => d.key === 'chain').state, 'No data');
assert.ok(only.domains.find((d) => d.key === 'tech').score !== null);
assert.ok(only.confidence.level);

// 5. The published data files, if present
const D = new URL('../../data/', import.meta.url);
const J = (f) => { try { return JSON.parse(fs.readFileSync(new URL(f, D), 'utf8')); } catch { return null; } };
const latest = J('latest.json');
if (latest?.metrics) {
  const t0 = Date.now();
  const I = intelligence({ a: latest, rows: J('timeseries.json')?.rows || [], pi: J('pi_cycle.json'), dash: J('dash.json'), etf: J('etf_flows.json'), nowIso: latest.dataThrough });
  assert.ok(I.grade.value >= 0 && I.grade.value <= 100);
  assert.ok(Object.keys(I.readings).length > 40, 'most indicators available from the published files');
  assert.ok(Date.now() - t0 < 5000, 'fast enough for the browser');
  console.log(`  live data: ${I.headline} · ${I.valuation?.state} valuation · ${I.cycle?.phase} · risk ${I.risk.level} (${Date.now() - t0} ms)`);
}
// 6. History: same calculation as today, sane baselines, weekly thinning of old points
{
  const X = up.inputs;
  const h = indicatorHistory(X, 't_ma200');
  assert.ok(h.pts.length > 300, 'long technical history');
  assert.ok(Math.abs(h.pts.at(-1)[1] - up.readings.t_ma200.value) < 1e-9, 'history ends on today’s engine value');
  const b = h.base;
  assert.ok(b.enough && b.p2 <= b.p10 && b.p10 <= b.p50 && b.p50 <= b.p90 && b.p90 <= b.p97 && b.pct >= 0 && b.pct <= 100);
  assert.ok(domHistory(X, 'tech').pts.length > 50, 'domain read history');
  const c = compact([...Array(1500)].map((_, i) => [new Date(Date.parse('2022-10-03') + i * 864e5).toISOString().slice(0, 10), i]), 730, Date.parse('2026-10-03'));
  assert.ok(c.length < 900 && c.length > 800, `thinned to weekly before two years (${c.length})`);
  // every indicator has research notes, a slug and a domain route
  for (const i of INDICATORS) { assert.ok(IND_DOCS[i.id]?.what && IND_DOCS[i.id]?.caveat, `docs for ${i.id}`); assert.ok(COMP_DOCS[i.comp], `component ${i.comp}`); assert.ok(DOMAIN_SLUG[i.domain] && indSlug(i.id)); }
  assert.equal(Object.keys(DOMAIN_DOCS).length, 5);
  const T = regimeTimeline(X);
  assert.ok(T.episodes.length >= 1 && T.episodes.every((e) => ['Bullish', 'Neutral', 'Bearish'].includes(e.label) && e.weeks >= 1), 'long-run regime timeline');
  assert.ok(similarConditions(X, up) !== null, 'similar-conditions search runs');
  const M = reportModel(up);
  assert.ok(M.sections.length >= 10 && M.sections.find((x) => x.title === 'Key drivers').lines.length >= 1, 'report model from the same engine output');
}
console.log('intel.test: ok');
