// Deterministic morning report (Markdown). Always generated, so the system
// works without any LLM. If an Anthropic API key is configured, the agent adds
// an analyst narrative on top (agent/narrate.mjs) — it never replaces the data.

import { fmtUsd, fmtPrice, fmtPct, fmtNum, fmtK } from './util.js';
import { brief } from './brief.js';

export function morningReport(a, opts = {}) {
  const m = a.metrics;
  const P = m.price;
  const L = [];
  const date = (opts.localDate || a.dataThrough.slice(0, 10));
  const f = (id) => a.forces.find((x) => x.id === id);
  const sec = (n, title) => L.push('', `## ${n}. ${title}`, '');
  const bullet = (s) => s && L.push(`- ${s}`);
  const obs = (s) => s && L.push(`- **Observed:** ${s}`);
  const interp = (s) => s && L.push(`- **Interpretation:** ${s}`);

  L.push('# BITCOIN MARKET INTELLIGENCE', '');
  L.push(`**Date:** ${date}  `);
  L.push(`**BTC price:** ${fmtPrice(P.spot)}  `);
  L.push(`**24h change:** ${fmtPct(P.ch24h)}  `);
  L.push(`**7d change:** ${fmtPct(P.ch7d)}  `);
  L.push(`**30d change:** ${fmtPct(P.ch30d)}  `);
  L.push(`**Market regime:** ${a.regime.primary}${a.regime.secondary ? ` (secondary: ${a.regime.secondary})` : ''}  `);
  L.push(`**Data through:** ${a.dataThrough} · generated ${a.generatedAt} · engine ${a.engine}`);
  const stale = a.quality.filter((q) => q.status !== 'ok');
  if (stale.length) L.push('', `> Data caveat: ${stale.map((q) => `${q.name} (${q.status}${q.asOf ? ', last ' + q.asOf.slice(0, 16).replace('T', ' ') : ''})`).join('; ')}.`);

  sec(1, 'What changed overnight');
  const ch = a.changes.filter((c) => c.weight > 0).slice(0, 6);
  if (!ch.length) bullet(a.changes[0]?.text || 'No material changes detected.');
  ch.forEach((c) => bullet(c.text));
  bullet(`Move classification (24h): **${a.attribution.d1.label}** — ${a.attribution.d1.explanation} (${a.attribution.d1.confidence})`);
  bullet(`Move classification (7d): **${a.attribution.d7.label}** — ${a.attribution.d7.explanation} (${a.attribution.d7.confidence})`);

  sec(2, 'What is currently driving price');
  L.push(a.regime.explanation, '');
  L.push('| # | Force | Direction | Evidence | Current state |', '|---|---|---|---|---|');
  a.forces.filter((x) => !x.unavailable).slice(0, 8).forEach((x) => L.push(`| ${x.rank} | ${x.name} | ${x.direction} | ${x.confidence} | ${x.state.replace(/\|/g, '/')} |`));

  const forceSection = (n, title, id, extra) => {
    sec(n, title);
    const x = f(id);
    if (!x || x.unavailable) { bullet(x?.state || 'Data unavailable.'); return; }
    obs(x.state);
    x.evidence.slice(0, 4).forEach((e) => bullet(`${e.label}: ${e.value}${e.source ? ` _(${e.source}${e.asOf ? ', ' + String(e.asOf).slice(0, 16).replace('T', ' ') : ''})_` : ''}`));
    if (extra) extra();
    bullet(`**Mechanism:** ${x.mechanism}`);
    interp(x.interpretation);
    bullet(`**Change:** ${x.d1}. ${x.d7}.`);
    bullet(`**Would invalidate:** ${x.invalidation}`);
  };
  forceSection(3, 'Liquidity', 'depth', () => {
    const imp = m.depth?.impact;
    if (imp) bullet(`Estimated impact of aggressive selling (idealised cross-venue routing, displayed book): ${imp.sell.map((s) => `${fmtUsd(s.sizeUsd)} → ${s.exhausted ? 'beyond captured depth' : fmtPct(-s.slippagePct, 2)}`).join(' · ')}`);
  });
  forceSection(4, 'ETF flows', 'etf');
  forceSection(5, 'Futures / leverage', 'leverage', () => {
    const lq = m.liq;
    if (lq) bullet(`Liquidations (OKX sample, ${lq.from?.slice(11, 16)}–${lq.to?.slice(11, 16)} UTC): longs ${fmtUsd(lq.longUsd)}, shorts ${fmtUsd(lq.shortUsd)}. Aggregated liquidation data is not available free.`);
  });
  forceSection(6, 'Funding', 'funding');
  forceSection(7, 'Options', 'options');
  sec(8, 'Macro');
  const mac = f('macro'), dol = f('dollar'), risk = f('riskappetite');
  [mac, dol, risk].filter(Boolean).forEach((x) => { if (x.unavailable) return bullet(x.state); bullet(`**${x.name} — ${x.direction}.** ${x.state}`); bullet(`_Mechanism:_ ${x.mechanism}`); interp(x.interpretation); });
  forceSection(9, 'On-chain', 'onchain');

  sec(10, 'Current liquidation / positioning map');
  L.push('_Levels in $5K bands. Liquidation figures are a **model estimate**, not observed; options data is Deribit only; order-book depth is only observable within ~±3% of spot._', '');
  L.push('| Level | Distance | What matters there | Crossing it would… |', '|---|---|---|---|');
  (a.map?.levels || []).forEach((l) => L.push(`| ${fmtK(l.level)}${l.markers.includes('SPOT') ? ' ◀ spot' : ''} | ${fmtPct(l.distPct, 1)} | ${l.tags.join('; ')}${l.why.length ? ' — ' + l.why.join('; ') : ''} | ${l.crossing} |`));

  const scen = (n, s) => {
    sec(n, s.name === 'Upside acceleration' ? 'Upside acceleration conditions' : 'Downside acceleration conditions');
    L.push('**What has to happen first (current status):**');
    s.first.forEach((c) => bullet(`[${c.status.toUpperCase()}] ${c.text} — now: ${c.value}`));
    L.push('', `**Confirming indicators:** ${s.confirm.join('; ')}.`, '', `**Contradicting indicators:** ${s.contradict.join('; ')}.`, '');
    L.push(`**Potential acceleration levels:** ${s.levels.length ? s.levels.map((l) => `${fmtK(l.level)} (${l.tags.join(', ')})`).join('; ') : 'none identified on current data'}.`, '');
    L.push(`**Mechanism:** ${s.mechanism}`, '', `**What would make it fail:** ${s.failure}`);
  };
  scen(11, a.scenarios[0]);
  scen(12, a.scenarios[2]);
  L.push('', `_Base case (range):_ ${a.scenarios[1].first.map((c) => `[${c.status}] ${c.text}`).join('; ')}. No probabilities are assigned: there is no statistically defensible basis for them.`);

  sec(13, 'What to watch today');
  a.forces.filter((x) => !x.unavailable).slice(0, 5).forEach((x) => bullet(`**${x.name}:** ${x.watch}`));
  const exp = m.options?.nextBigExpiry;
  if (exp) bullet(`Deribit expiry ${exp.expiry} 08:00 UTC: ${fmtUsd(exp.notionalUsd)} notional, max pain ${fmtK(exp.maxPain)}.`);

  L.push('', '## THE THREE MOST IMPORTANT VARIABLES TODAY', '');
  a.top.forEach((t, i) => L.push(`${i + 1}. **${t.name}** (${t.direction}) — ${t.state} _Watch:_ ${t.watch}`));
  L.push('', '---', '_Observed data and interpretation are separated throughout. This is market-structure research, not investment advice; no price targets or probabilities are given._');
  return L.join('\n');
}

// Condensed morning report: same structure as the page's default view. The full
// report (morningReport) is archived alongside it and shown on demand.
export function briefReport(a, opts = {}) {
  const b = brief(a);
  const L = [];
  const date = opts.localDate || a.localDate || a.dataThrough.slice(0, 10);
  const st = (s) => (s === 'met' ? 'Met' : s === 'not met' ? 'Not met' : 'Unknown');
  L.push(`# BTC Market Intelligence — ${date}`, '');
  L.push(`**${b.priceLine}**  `);
  L.push(`**Regime:** ${b.regime.text}  `);
  L.push(`_Data through ${a.dataThrough.slice(0, 16).replace('T', ' ')} UTC · ${b.sources.text}_`);
  if (b.cycle) L.push(`**On-chain valuation:** ${b.cycle.phase ? b.cycle.phase + ' · ' : ''}${b.cycle.zone}${b.cycle.momentum ? ` · momentum ${b.cycle.momentum.toLowerCase()}` : ''}  `);
  if (b.notable.length) L.push('', `**What changed (≥1.5σ):** ${b.notable.map((n) => `${n.label} ${n.from} → ${n.to} (${fmtNum(n.z, 1)}σ, ${n.horizon})`).join('; ')}.`);
  L.push('', '## Today’s three most important variables', '');
  b.top.forEach((t, i) => L.push(`${i + 1}. **${t.name} — ${t.dirNote}.** ${t.summary} _Watch:_ ${t.watch}`));
  L.push('', '## Ranked forces (top 5)', '', '| # | Force | Direction | Evidence | Summary |', '|---|---|---|---|---|');
  a.forces.filter((f) => !f.unavailable).slice(0, 5).forEach((f) => { const x = b.forces.find((y) => y.id === f.id); L.push(`| ${f.rank} | ${f.name} | ${x.dirNote} | ${f.confidence} | ${x.line.replace(/\|/g, '/')} |`); });
  L.push('', '## Liquidity map (key levels)', '');
  b.ladder.forEach((l) => L.push(`- **${l.label}**${l.isSpot ? ' (current band)' : ` (${fmtPct(l.distPct, 1)})`}: ${l.what}${l.detail.length ? '; ' + l.detail.join('; ') : ''} → ${l.effect}`));
  L.push('', '_Liquidation figures are modelled estimates, not observed._');
  L.push('', '## Acceleration conditions', '');
  b.scenarios.forEach((s) => {
    L.push(`**${s.title} — ${s.met} of ${s.total} met.** ${s.mech}${s.kind !== 'base' ? ` _Fails if:_ ${s.fail}` : ''}`, '');
    s.conds.forEach((c) => L.push(`- [${st(c.status)}] ${c.text} — now ${c.value}`));
    L.push('');
  });
  const cy = a.cycle;
  if (cy && !cy.error) {
    L.push('## On-chain valuation & momentum', '', `**${cy.headline}.** ${cy.valuation.leaning || ''}`, '');
    cy.bullets.forEach((x) => L.push(`- ${x}`));
    L.push('', '_Historical zones only — not predictive. On-chain evidence, zone thresholds and historical context are on the Analysis page (btcintel.org/#analysis/onchain)._', '');
  }
  L.push('## Three things to watch', '');
  b.watch.forEach((w) => L.push(`- **${w.what}** — ${w.why}`));
  L.push('', '---', `_${b.footer}_`);
  return L.join('\n');
}
