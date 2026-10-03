// Condensed "brief" copy for the default page view and the short morning report.
// Pure presentation: every figure here is read from the analysis object; nothing
// is estimated, forecast or added. Full detail stays in forces / map / scenarios.

import { macroTransmission } from './analyze.js';
import { fmtUsd, fmtUsdSigned, fmtPct, fmtNum, fmtK } from './util.js';

const NOTABLE_Z = 1.5;          // |σ| for a change to be called out as meaningful
const LADDER_RANGE_PCT = 20;    // liquidity ladder: notable levels within ±20% of spot
const LADDER_MAX = 6;

const usdShort = (v) => fmtUsd(v, Math.abs(v) >= 1e9 ? 1 : 0);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const firstSentence = (s = '') => (String(s).match(/^.*?[.!?](\s|$)/)?.[0] || String(s)).trim();
const bp = (v) => `${v > 0 ? '+' : ''}${fmtNum(v * 100, 0)} bp`;
const kRange = (a, b) => (Math.abs(a - b) <= 1000 ? `$${Math.round(Math.min(a, b) / 1000)}–${Math.round(Math.max(a, b) / 1000)}K` : `${fmtK(a)} and ${fmtK(b)}`);
// near-dated gamma first (what matters into the next expiry), then total
const byGamma = (O) => [...(O?.topGamma || [])].sort((x, y) => (y.nearGammaUsd ?? y.gammaUsd) - (x.nearGammaUsd ?? x.gammaUsd));
const dayLabel = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// ---------- regime ----------
const REGIME_SHORT = {
  'Balanced / no dominant driver': ['Balanced', 'no single driver dominant. Price is being set by moderate, offsetting forces.'],
  'Spot-led': ['Spot-led', 'cash flows (ETF and spot buying/selling) are setting the marginal price.'],
  'Leverage-led': ['Leverage-led', 'changes in leveraged positioning are setting price; moves can overshoot and reverse.'],
  'Derivatives-led': ['Derivatives-led', 'price discovery is happening in futures and options rather than spot.'],
  'Macro-led': ['Macro-led', 'BTC is moving with equities, the dollar and real yields.'],
  'Liquidity-led': ['Liquidity-led', 'thin order books are amplifying moves; small flows have outsized impact.'],
};
function regimeShort(r) {
  const [label, text] = REGIME_SHORT[r.primary] || [r.primary, firstSentence(r.explanation)];
  return { label, desc: cap(text), text: `${label} — ${text}`, secondary: r.secondary ? (REGIME_SHORT[r.secondary]?.[0] || r.secondary) : null };
}

// ---------- source status ----------
function sourceStatus(quality) {
  const err = quality.filter((q) => q.status === 'error');
  const blocked = err.filter((q) => /\b(403|451)\b|restricted location|your country/i.test(q.error || ''));
  const inactive = err.filter((q) => /inactive/i.test(q.error || ''));
  const other = err.length - blocked.length - inactive.length;
  const stale = quality.filter((q) => q.status === 'stale' || q.status === 'server-only').length;
  const why = [blocked.length && `${blocked.length} region-blocked from US servers`, inactive.length && `${inactive.length} inactive`, other && `${other} failed`].filter(Boolean).join(', ');
  const parts = [];
  if (err.length) parts.push(`${err.length} source${err.length > 1 ? 's' : ''} unavailable (${why})`);
  if (stale) parts.push(`${stale} carried forward from the last run`);
  return { ok: quality.filter((q) => q.status === 'ok').length, total: quality.length, unavailable: err.length, stale, text: parts.join(' · ') || 'All sources live' };
}

// ---------- per-force short copy ----------
// line: one row of the ranked table · summary: the "three variables" card · watch: short watch item
function forceCopy(f, a) {
  const m = a.metrics, O = m.options, E = m.etf, M = m.macro, D = m.derivs, C = m.onchain, dep = m.depth;
  const out = { line: firstSentence(f.state), summary: f.state, watch: f.watch, dirNote: cap(f.direction) };
  if (f.unavailable) return out;
  switch (f.id) {
    case 'options': {
      if (!O) break;
      const g = byGamma(O);
      const gTxt = g.length >= 2 ? kRange(g[0].strike, g[1].strike) : g[0] ? fmtK(g[0].strike) : null;
      const ivRv = O.ivRvSpread === null || O.ivRvSpread === undefined ? null : O.ivRvSpread < -3 ? 'IV cheap vs realised' : O.ivRvSpread > 3 ? 'IV rich vs realised' : 'IV in line with realised';
      const rv = O.atmIv30 !== null && O.ivRvSpread !== null ? O.atmIv30 - O.ivRvSpread : null;
      out.line = [gTxt && `Large gamma at ${gTxt}.`, ivRv && `${ivRv}.`].filter(Boolean).join(' ');
      out.summary = [`Deribit OI ${fmtNum(O.totalOiBtc / 1000, 0)}K BTC.`, O.atmIv30 !== null && `30d IV ${fmtNum(O.atmIv30, 1)}%${rv !== null ? ` (${O.ivRvSpread < 0 ? 'below' : 'above'} realised ${fmtNum(rv, 0)}%)` : ''}.`, gTxt && `Large gamma clustered at ${gTxt}.`].filter(Boolean).join(' ');
      const x = O.nextBigExpiry;
      out.watch = [x && `${dayLabel(x.expiry)} 08:00 UTC expiry (${fmtUsd(x.notionalUsd)} notional, max pain ${fmtK(x.maxPain)}).`, g[0] && `Behaviour around ${fmtK(g[0].strike)}.`].filter(Boolean).join(' ');
      break;
    }
    case 'onchain': {
      if (!C) break;
      const s30 = C.stables30d;
      out.line = [s30 !== null && s30 !== undefined && `Stablecoin supply ${s30 > 0 ? 'expanding' : 'contracting'}.`, C.mvrv !== null && `MVRV ${fmtNum(C.mvrv, 2)}.`].filter(Boolean).join(' ');
      out.summary = [C.stables && `Stablecoin supply ${fmtUsd(C.stables, 1)} (${fmtUsdSigned(s30, 1)} in 30d).`, C.mvrv !== null && `MVRV ${fmtNum(C.mvrv, 2)}${C.realizedPrice ? ` (realised price ~${fmtUsd(C.realizedPrice)})` : ''}.`].filter(Boolean).join(' ');
      out.watch = 'Stablecoin mint/burn pace. Realised price as deep support.';
      break;
    }
    case 'etf': {
      if (!E) break;
      const pers = E.persistence10 >= 0.7 ? 'Persistent' : E.persistence10 <= 0.3 ? 'Sporadic' : 'Mixed';
      const sign = E.s20 >= 0 ? 'inflows' : 'outflows';
      const pace = E.accel > 0 ? 'accelerating' : 'decelerating';
      out.line = `${pers} but ${pace} ${sign}.`.replace(/^Mixed but/, 'Mixed,');
      out.dirNote = `${cap(f.direction)} (${pace})`;
      out.summary = `${fmtUsdSigned(E.s5 * 1e6, 0)} net over 5 days · ${fmtUsdSigned(E.s20 * 1e6)} over 20 days. ${E.streak > 0 ? `${E.streak}-day inflow streak.` : E.streak < 0 ? `${-E.streak}-day outflow streak.` : 'No streak.'}`;
      out.watch = "Tonight's Farside print. Whether 5-day net stays above ~$750M.";
      break;
    }
    case 'macro': {
      if (!M) break;
      const tm = macroTransmission(m);
      const bits = [M.real10y20d !== null && M.real10y20d !== undefined && `Real yields ${bp(M.real10y20d)}`, M.dollar20d !== null && M.dollar20d !== undefined && `${M.dollarLabel} ${fmtPct(M.dollar20d)}`].filter(Boolean);
      out.line = [bits.length && `${bits.join(' / ')} in 4w.`, tm.link !== null && (tm.link < 0.2 ? 'Transmission currently weak.' : tm.link > 0.4 ? 'Transmission currently strong.' : 'Transmission moderate.')].filter(Boolean).join(' ');
      out.summary = out.line + (M.netLiq4w !== null ? ` Net liquidity ${fmtUsdSigned(M.netLiq4w * 1e9)} in 4w.` : '');
      out.watch = 'H.4.1 (Thursday), TGA, FOMC communications, quarter-end funding.';
      break;
    }
    case 'depth': {
      if (!dep) break;
      out.line = `±1% depth ${fmtUsd(dep.d1, 0)}. Bid/ask imbalance ${fmtPct(dep.imbalance1 * 100, 0)}.`;
      out.summary = out.line + (dep.ch7d !== null ? ` ${fmtPct(dep.ch7d)} vs a week ago.` : '');
      out.watch = 'Depth during US hours — does bid-side hold or withdraw on any dip?';
      break;
    }
    case 'spot': {
      if (!dep && !D) break;
      out.line = [dep?.coinbasePremiumPct !== null && dep?.coinbasePremiumPct !== undefined && `Coinbase premium ${fmtPct(dep.coinbasePremiumPct, 2)}.`, D?.takerSpot7d && `Spot taker buy/sell ${fmtNum(D.takerSpot7d)} (7d).`].filter(Boolean).join(' ') || out.line;
      out.watch = 'Coinbase premium during US hours.';
      break;
    }
    case 'riskappetite': {
      const b = m.corr?.behaviour?.label;
      if (!b) break;
      const eq = Math.max(...['NDX', 'SPX'].map((k) => Math.abs(m.corr?.[k]?.c30 ?? 0)));
      out.line = `${cap(b)}. 30d equity correlation ${eq < 0.3 ? 'low' : 'elevated'} (${fmtNum(eq, 2)}).`;
      break;
    }
    case 'leverage': {
      if (!D) break;
      out.line = `OI ${fmtUsd(D.totalOi, 1)}${D.oiCh7d !== null ? `, ${fmtPct(D.oiCh7d)} 7d` : ''}${D.oiCh30d !== null ? ` / ${fmtPct(D.oiCh30d, 0)} 30d` : ''}.`;
      break;
    }
    case 'funding': {
      if (!D) break;
      out.line = `Funding ${fmtNum(D.fundingAnn, 1)}% ann.${D.okxFundingPctile !== null && D.okxFundingPctile !== undefined ? ` (OKX 7d avg ${fmtNum(D.okxFunding7dAnn, 1)}%).` : ''}`;
      break;
    }
    case 'dollar': {
      if (!M) break;
      out.line = [M.dollar20d !== null && `${M.dollarLabel} ${fmtPct(M.dollar20d)} in 4w.`, M.us10y20d !== null && `10y yield ${bp(M.us10y20d)}.`].filter(Boolean).join(' ');
      break;
    }
  }
  return out;
}

// ---------- liquidity ladder ----------
const TAG_SHORT = [
  [/short-squeeze/, 'short-squeeze zone'],
  [/options strike/, 'options pin / acceleration'],
  [/put-strike/, 'put-strike hedging'],
  [/long-liquidation/, 'long-liquidation zone'],
  [/liquidity vacuum/, 'thin visible book'],
  [/prior congestion/, 'prior congestion'],
];
function levelShort(l, a) {
  if (l.isSpot) {
    const gammaHere = l.tags.some((t) => /options strike/.test(t));
    const g = byGamma(a.metrics.options).slice(0, 2).map((x) => x.strike);
    const gTxt = g.length === 2 ? ` (${kRange(g[0], g[1])})` : '';
    return { what: `Current band${gammaHere ? ` · largest near-dated gamma${gTxt}` : ''}`, detail: [], effect: gammaHere ? 'Pin or accelerate.' : 'Spot is inside this band.' };
  }
  const what = [];
  for (const t of l.tags) { const hit = TAG_SHORT.find(([re]) => re.test(t)); if (hit && !what.includes(hit[1])) what.push(hit[1]); }
  const detail = [];
  if (l.above && l.liqShort >= 1e8) detail.push(`modelled short liquidations ~${usdShort(l.liqShort)}`);
  if (!l.above && l.liqLong >= 1e8) detail.push(`modelled long liquidations ~${usdShort(l.liqLong)}`);
  for (const mk of l.markers.filter((x) => x !== 'SPOT')) detail.push(`${mk.replace(/\s*\$[\d,]+$/, '')} nearby`);
  const side = l.above ? 'an advance' : 'a decline';
  const c = l.crossing || '';
  const effect = /two-sided/.test(c) ? 'Two-sided: can slow first, then accelerate if broken.'
    : /accelerate/.test(c) ? `Likely to accelerate ${side} if reached.`
    : /slow/.test(c) ? `Likely to slow ${side}.`
    : cap(c) + '.';
  return { what: cap(what.join(' + ') || l.tags[0] || ''), detail, effect };
}
function ladder(a) {
  const levels = a.map?.levels || [];
  return levels
    .filter((l) => l.isSpot || (Math.abs(l.distPct) <= LADDER_RANGE_PCT && !l.tags.every((t) => /no notable/.test(t))))
    .sort((x, y) => Math.abs(x.distPct) - Math.abs(y.distPct))
    .slice(0, LADDER_MAX)
    .sort((x, y) => y.level - x.level)
    .map((l) => ({ level: l.level, label: fmtK(l.level), distPct: l.distPct, isSpot: !!l.isSpot, above: !!l.above, kind: l.isSpot ? 'spot' : /accelerate/.test(l.crossing) && !/slows first/.test(l.crossing) ? 'acc' : /two-sided/.test(l.crossing) ? 'two' : 'dec', ...levelShort(l, a) }));
}

// ---------- scenarios ----------
const COND_SHORT = [
  [/^ETF 5-day net flows above (\S+) and rising/, 'ETF 5-day net > $1 and rising'],
  [/^Funding still below (\S+ ann\.)/, 'Funding still < $1'],
  [/^Price closes above the nearest resistance band (\$[\d.,]+K)/, 'Close above $1 resistance'],
  [/^ETF flows mixed \(\|5-day net\| below (\S+)\)/, 'ETF flows mixed (|5d net| < $1)'],
  [/^Open interest stable \(\|7d change\| below (\S+)\)/, 'OI stable (|7d| < $1)'],
  [/^Large option open interest near spot/, 'Large option OI near spot'],
  [/^ETF flows turn to persistent outflows/, 'Persistent ETF outflows'],
  [/^±1% depth deteriorating \(>(\S+) lower than a week ago\)/, 'Depth deteriorating >$1 vs 1w'],
  [/^Long leverage rebuilt/, 'Long leverage rebuilt'],
  [/^Macro tightening impulse/, 'Macro tightening impulse'],
];
const shortCond = (t) => { for (const [re, rep] of COND_SHORT) if (re.test(t)) return t.match(re)[0].replace(re, rep); return t.replace(/\s*\([^)]*\)/g, ''); };

function scenarioShort(s, a) {
  const kind = /^Upside/.test(s.name) ? 'up' : /^Downside/.test(s.name) ? 'down' : 'base';
  const lv = (s.levels || []).map((l) => fmtK(l.level));
  const met = s.first.filter((c) => c.status === 'met').length;
  const res = s.first.find((c) => /resistance band/.test(c.text))?.text.match(/\$[\d.,]+K/)?.[0];
  const copy = {
    up: { title: 'Upside acceleration', mech: `Persistent ETF buying + short covering + short-gamma dealers chasing${res ? ` through ${res}` : ''}.`, fail: 'Inflows stall or the move is leverage-driven only.' },
    base: { title: 'Base case: range', mech: 'Offsetting flows + dealer hedging absorb directional pressure.', fail: 'A macro or flow shock hits thin books at a range edge.' },
    down: { title: 'Downside acceleration', mech: `Spot selling into thin books → ${lv.length ? `long liquidations at ${lv.slice(0, 2).join('/')}` : 'forced long selling'} → cascade.`, fail: 'Leverage too small or dip-buying absorbs the flow.' },
  }[kind];
  return { kind, ...copy, met, total: s.first.length, conds: s.first.map((c) => ({ text: shortCond(c.text), status: c.status, value: c.value })) };
}

// ---------- watch next 24h ----------
// Three things to watch: dated events first (options expiry, tonight's ETF print), then any
// on-chain zone change or zone-boundary proximity, then stablecoin flow and the rest by force rank.
const WATCH_N = 3;
function watch24(a) {
  const m = a.metrics, out = [];
  const x = m.options?.nextBigExpiry;
  const g = byGamma(m.options)[0];
  if (x && x.days <= 1.5) out.push({ what: `${dayLabel(x.expiry)} 08:00 UTC Deribit expiry`, why: `${fmtUsd(x.notionalUsd)} notional, max pain ${fmtK(x.maxPain)}.${g ? ` Watch for pin or break around ${fmtK(g.strike)}.` : ''}`, link: '#liquidity', key: 'w:expiry' });
  if (m.etf) out.push({ what: "Tonight's Farside ETF print", why: `Does the 5-day net stay ${m.etf.s5 >= 0 ? 'constructive or roll over' : 'negative or turn'}?`, link: '#force-etf', key: 'w:etf' });
  for (const w of a.cycle?.watch || []) out.push({ what: w.what, why: w.why, link: '#cycle', key: 'w:cycle' });
  const rank = (id) => a.forces.find((f) => f.id === id)?.rank ?? 99;
  const rest = [];
  if (m.onchain?.stables30d !== null && m.onchain?.stables30d !== undefined) rest.push({ id: 'onchain', what: 'Stablecoin flow', why: m.onchain.stables30d > 0 ? `Supply ${fmtUsdSigned(m.onchain.stables7d, 1)} this week — continued expansion or pause?` : 'Continued contraction or stabilisation?', link: '#cycle' });
  if (m.depth) rest.push({ id: 'depth', what: 'Depth during US hours', why: 'Does bid-side hold or withdraw on any dip?', link: '#analysis/market-structure/liquidity' });
  if (m.derivs) rest.push({ id: 'leverage', what: 'Open interest and funding', why: 'Is leverage being rebuilt into the move?', link: '#force-leverage' });
  rest.sort((p, q) => (p.id === 'onchain' ? -1 : q.id === 'onchain' ? 1 : rank(p.id) - rank(q.id)));
  for (const r of rest) out.push({ what: r.what, why: r.why, link: r.link, key: { onchain: 'w:stables', depth: 'w:depth', leverage: 'w:leverage' }[r.id] });
  return out.slice(0, WATCH_N);
}

// ---------- notable moves ----------
const CHANGE_FORCE = { mvrv: 'onchain', depth1: 'depth', etf5d: 'etf', oiTotal: 'leverage', fundingAnn: 'funding', iv30: 'options', skew: 'options', dxy: 'dollar', real10y: 'macro', vix: 'riskappetite', corrNdx30: 'riskappetite', stables: 'onchain' };
function notable(a) {
  const pick = (list, horizon) => (list || []).filter((c) => c.z !== null && c.z !== undefined && Math.abs(c.z) >= NOTABLE_Z).map((c) => ({ key: c.key, label: c.label, from: c.from, to: c.to, z: c.z, horizon }));
  return [...pick(a.changes, '24h'), ...pick(a.changes7, '7d')].sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
}
// Small cycle badge for the overview header.
function cycleBadge(a) {
  const c = a.cycle;
  if (!c || c.error || (!c.valuation?.zone && !c.phase)) return null;
  return { phase: c.phase?.label ?? null, zone: c.valuation.zone?.label ?? 'inputs incomplete', tone: c.valuation.zone?.tone ?? 'neu', momentum: c.momentum?.label ?? null, stretched: !!c.stretched };
}

export function brief(a) {
  const P = a.metrics.price;
  const forces = a.forces.map((f) => ({ id: f.id, rank: f.rank, unavailable: !!f.unavailable, ...forceCopy(f, a) }));
  const byId = Object.fromEntries(forces.map((f) => [f.id, f]));
  const moves = notable(a);
  for (const n of moves) { const f = byId[CHANGE_FORCE[n.key]]; if (f && (!f.moved || Math.abs(n.z) > Math.abs(f.moved.z))) f.moved = n; }
  return {
    price: { spot: P.spot, ch24h: P.ch24h, ch7d: P.ch7d, ch30d: P.ch30d },
    priceLine: `${fmtUsd(P.spot) === 'n/a' ? 'n/a' : '$' + Math.round(P.spot).toLocaleString('en-US')} · ${fmtPct(P.ch24h, 1)} 24h · ${fmtPct(P.ch7d, 1)} 7d · ${fmtPct(P.ch30d, 1)} 30d`,
    regime: regimeShort(a.regime),
    sources: sourceStatus(a.quality),
    dataThrough: a.dataThrough,
    notable: moves,
    cycle: cycleBadge(a),
    top: a.top.map((t) => { const id = t.id || a.forces.find((f) => f.name === t.name)?.id; return { id, name: t.name, direction: t.direction, dirNote: byId[id]?.dirNote || cap(t.direction), summary: byId[id]?.summary || t.state, watch: byId[id]?.watch || t.watch }; }),
    forces,
    ladder: ladder(a),
    scenarios: a.scenarios.map((s) => scenarioShort(s, a)),
    watch: watch24(a),
    footer: 'Observed data and interpretation are separated. Liquidation figures are modelled estimates. This is market-structure research, not investment advice. No price targets or probabilities are assigned.',
  };
}
