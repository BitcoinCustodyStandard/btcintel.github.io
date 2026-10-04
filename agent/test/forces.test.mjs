// Locks for the production force library. These fail on purpose if the library or any
// locked decision changes: exactly 12 forces, no volatility-squeeze force, high-yield
// spreads in Risk appetite, no inputs that are not live on the site, and one shared
// computation feeding Intelligence, Analysis and the Dashboard. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { intelligence, materialForces, FORCE_LIBRARY, SCALE } from '../../engine/intel.js';

const day = (i, end = '2026-10-03') => new Date(Date.parse(end) - i * 864e5).toISOString().slice(0, 10);
const series = (n, fn) => Array.from({ length: n }, (_, k) => [day(n - 1 - k), fn(k)]);
function world({ trend = 1, mvrv = 1.6, fng = 55, etf = 300, etfDays = 25, drop = [] } = {}) {
  const close = series(1500, (k) => 30000 * Math.exp(trend * 0.0009 * k) * (1 + 0.02 * Math.sin(k / 9)));
  const rows = series(400, (k) => k).map(([d], k) => {
    const r = { date: d, price: close[1100 + k][1], mvrv: mvrv + trend * 0.0005 * (k - 400), dxy: 100, real10y: 1.8, us10y: 4.2, hy: 3, vix: 16, ndx: 20000 * (1 + 0.0004 * k), gold: 3000, netLiq: 6000 + 0.5 * k, stables: 2.6e11 * (1 + 0.0004 * k), dvol: 50, skew: 2, fundingAnn: 8, oiOkx: 3e9 * (1 + 0.0004 * k), corrNdx30: 0.3, cbPremium: 0.02 };
    for (const k2 of drop) delete r[k2];
    return r;
  });
  const a = { dataThrough: '2026-10-03T12:00:00Z', metrics: { price: { spot: close.at(-1)[1] }, etf: { series20: series(etfDays, () => etf) } }, cycle: { charts: { mvrv: series(800, () => mvrv) } } };
  const dash = { fng: { series: series(400, () => fng) }, flows: { rows: series(120, (k) => [0, 1000, 1000 + 300 * trend, 2.7e6 - 300 * trend * k]).map(([d, v]) => [d, v[1], v[2], v[3]]) } };
  return intelligence({ a, rows, pi: { rows: close.slice(0, -1) }, dash, etf: null, nowIso: '2026-10-03T12:00:00Z' });
}
const F = (I, id) => I.forces.find((f) => f.id === id);
// price + stablecoins only: lets a test place one force just past its threshold, or stretch price
function bare({ trend = 1, stab = 0.0004, spike = 0 } = {}) {
  const close = series(1500, (k) => 30000 * Math.exp(trend * 0.0009 * k) * (1 + 0.02 * Math.sin(k / 9)) * (k > 1440 ? 1 + spike * (k - 1440) / 60 : 1));
  const rows = series(400, (k) => k).map(([d], k) => ({ date: d, price: close[1100 + k][1], stables: 2.6e11 * (1 + stab * k) }));
  return intelligence({ a: { dataThrough: '2026-10-03T12:00:00Z', metrics: { price: { spot: close.at(-1)[1] } } }, rows, pi: { rows: close.slice(0, -1) }, dash: null, etf: null, nowIso: '2026-10-03T12:00:00Z' });
}

// 1. The library: exactly these 12, in these domains
const LOCKED = [
  ['trend', 'Trend structure', 'tech'], ['momentum', 'Momentum & extension', 'tech'],
  ['exflows', 'Exchange flows', 'chain'], ['valuation', 'Valuation & holder profit', 'chain'], ['network', 'Network & miners', 'chain'],
  ['etf', 'Spot ETF flow impulse', 'mkt'], ['leverage', 'Leverage & derivatives', 'mkt'], ['spot', 'US spot premium', 'mkt'],
  ['sentiment', 'Risk sentiment', 'sent'],
  ['macro', 'Macro conditions', 'macro'], ['stables', 'Stablecoin liquidity', 'macro'], ['risk', 'Risk appetite', 'macro'],
];
assert.equal(FORCE_LIBRARY.length, 12, 'the force library has exactly 12 forces');
assert.deepEqual(FORCE_LIBRARY.map((x) => [x.id, x.name, x.domain]).sort(), LOCKED.slice().sort(), 'force ids, names and domains are locked');
assert.equal(new Set(FORCE_LIBRARY.map((x) => x.domain)).size, 5, 'forces span the five domains');
assert.deepEqual(SCALE, ['Adverse', 'Cautionary', 'Neutral', 'Constructive', 'Supportive'], 'posture scale unchanged');

// 2. Locked decisions
const allInputs = FORCE_LIBRARY.flatMap((x) => x.ev);
assert.ok(!FORCE_LIBRARY.some((x) => /squeeze|bollinger|bbw/i.test(`${x.id} ${x.name}`)) && !allInputs.includes('t_bbw'), 'volatility squeeze / Bollinger width is not a force or a force input');
assert.ok(FORCE_LIBRARY.find((x) => x.id === 'risk').ev.includes('x_hy'), 'high-yield spreads stay in Risk appetite');
for (const bad of ['x_m2', 'x_nfci', 'x_acwi', 'c_whales']) assert.ok(!allInputs.includes(bad), `${bad} is not a force input`);
for (const x of FORCE_LIBRARY) assert.ok(!/\b(buy|sell|target|should)\b/i.test(x.rule), `${x.id}: rule text is non-advisory`);

// 3. One computation feeds every surface: drivers/offsets are the active forces, and the capped views are prefixes
for (const I of [world({ trend: 1 }), world({ trend: -1, mvrv: 0.9, fng: 18, etf: -400 }), world({ trend: 1, fng: 92 })]) {
  assert.equal(I.forces.length, 12, 'Intelligence receives all 12 forces');
  assert.deepEqual(I.drivers.map((f) => f.id), I.forces.filter((f) => f.active && f.dir > 0).map((f) => f.id), 'drivers = active supportive forces, library order');
  assert.deepEqual(I.offsets.map((f) => f.id), I.forces.filter((f) => f.active && f.dir < 0).map((f) => f.id), 'offsets = active adverse forces, library order');
  for (const [nd, no] of [[5, 4], [3, 3]]) {
    const M = materialForces(I, nd, no);
    assert.ok([...M.drivers, ...M.offsets].every((f) => I.forces.includes(f)), 'views reuse the library objects (same name, label, domain)');
    assert.deepEqual(M.drivers, I.drivers.slice(0, nd)); assert.deepEqual(M.offsets, I.offsets.slice(0, no));
  }
  for (const f of I.forces) {
    assert.ok(f.domainName && f.inputs.length, `${f.id}: domain tag and inputs`);
    if (!f.active && f.score !== null) assert.match(f.label, /^Below threshold/, `${f.id}: inactive forces read "Below threshold"`);
  }
  assert.ok(SCALE.includes(I.state) && I.assessment.label === I.state, 'one overall posture on the five-step scale');
}

{ // the threshold is the only gate: a weak but active force (low materiality) is still a driver everywhere
  const I = bare({ stab: 0.00028 }), st = F(I, 'stables');
  assert.ok(st.active && st.materiality < 0.2, `fixture: stablecoins just past threshold (${st.score}, materiality ${st.materiality})`);
  assert.ok(st.material && I.drivers.includes(st) && materialForces(I, 5, 4).drivers.includes(st), 'weak active force is still a driver');
}

// 4. Preserved behaviour
{ // Momentum & extension: one reading per card
  const seen = new Set();
  for (const I of [world({ trend: 1 }), world({ trend: -1 }), bare({ spike: 0.3 }), bare({ spike: 0.6 }), bare({ spike: 1 })]) {
    const m = F(I, 'momentum'); if (!m.active) continue; seen.add(m.label);
    if (m.label === 'Price stretched') assert.match(m.text, /set aside/);
    else { assert.ok(['Momentum building', 'Momentum fading'].includes(m.label)); assert.match(m.text, /not stretched/); }
  }
}
{ // Valuation: the MVRV family counts once — three identical MVRV variants weigh the same as one
  const R = { c_mvrv: { s: 0.9 }, c_mvrvz: { s: 0.9 }, c_mvrvtr: { s: 0.9 }, c_puell: { s: -0.9 }, c_sth: { s: 0 } };
  const v = FORCE_LIBRARY.find((x) => x.id === 'valuation').score(R, []);
  assert.ok(Math.abs(v) < 1e-9, `MVRV family (avg 0.9) and Puell (−0.9) balance 50/50 inside the valuation leg (${v})`);
}
{ // Stablecoin labels
  const L = FORCE_LIBRARY.find((x) => x.id === 'stables').label;
  assert.equal(L(0.5), 'Expanding'); assert.equal(L(-0.5), 'Contracting');
}

// 5. Degraded inputs are flagged, never filled in
{
  const short = F(world({ etf: 900, etfDays: 12 }), 'etf');
  assert.match(short.note || '', /20-day leg pending/, 'ETF card states the 20-day leg is pending');
  assert.ok(short.inputs.some((i) => i.id === 'm_etf20' && !i.live), '20-day ETF input flagged missing');
  const full = F(world({ etf: 900, etfDays: 25 }), 'etf');
  assert.equal(full.note, null, 'ETF auto-switches to the 5d/20d blend once 20 days exist');
  assert.ok(full.inputs.find((i) => i.id === 'm_etf20').live);
  const lev = F(world({ drop: ['dvol', 'skew'] }), 'leverage');
  assert.ok(['m_dvol', 'm_skew'].every((id) => lev.inputs.some((i) => i.id === id && !i.live)), 'missing skew/DVOL flagged on the Leverage card');
  assert.ok(!/NaN|undefined/.test(lev.text + lev.rule), 'no invented values when derivatives inputs are missing');
}
// 6. The pages consume the shared output and keep the locked copy
{
  const src = (f) => fs.readFileSync(new URL(`../../assets/${f}`, import.meta.url), 'utf8');
  const ui = src('intelui.js'), ov = src('research.js');
  assert.match(ui, /materialForces\(I, 3, 3\)/, 'Dashboard Market Read uses the shared subset');
  assert.match(ov, /materialForces\(I, 5, 4\)/, 'Analysis Overview uses the shared subset');
  assert.match(ov, /Material forces from the Intelligence force library \(filtered\)\. Full set on/, 'Analysis helper text');
  assert.match(ui, /Full force library\. Drivers\/offsets on Analysis and Dashboard are the material subset\./, 'Intelligence helper text');
  assert.match(ui, /Volatility squeeze \(Bollinger width\) is not a force/, 'Intelligence footnote explains the squeeze');
  // driver/offset rows render the library object's own name and label, never a typed string
  assert.match(ui, /const li = \(f\) => .*esc\(f\.name\).*esc\(f\.label\)/, 'Dashboard rows use f.name / f.label');
  assert.match(ov, /const fItem = \(f, cls\) => .*esc\(f\.name\).*esc\(f\.label\)/, 'Analysis rows use f.name / f.label');
}
console.log('forces.test: ok — 12 locked forces, decisions and wiring verified');
