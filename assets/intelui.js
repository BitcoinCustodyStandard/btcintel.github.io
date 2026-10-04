// Views for the Market Intelligence Engine (engine/intel.js):
//   marketReadHtml  — the dashboard's ten-second Market read
//   intelligenceHtml — Intelligence tab: what matters now and why, valuation, market regime, risk
// All text comes from the engine's evidence; nothing here adds figures of its own.

import { DOMAIN_SLUG, DEF_BY_ID, indSlug, materialForces } from '../engine/intel.js?v=20261004a';

const DLINK = (k) => `#analysis/${DOMAIN_SLUG[k]}`;
const ILINK = (id) => (DEF_BY_ID[id] ? `${DLINK(DEF_BY_ID[id].domain)}/${indSlug(id)}` : '#analysis');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// narrative paragraphs carry <b> emphasis from the engine; everything else is escaped
const rich = (s) => esc(s).replace(/&lt;(\/?)b&gt;/g, '<$1b>');
const TONE = { Strong: 'up', Supportive: 'up', Constructive: 'up', Positive: 'up', Neutral: 'neu', Mixed: 'neu', Context: 'ctx', Cautious: 'warn', Cautionary: 'warn', Negative: 'warn', Deteriorating: 'down', Weak: 'down', Adverse: 'down', 'No data': 'ctx' };
const toneOf = (label, s) => TONE[label] || (s === null || s === undefined ? 'ctx' : s >= 0.15 ? 'up' : s <= -0.4 ? 'down' : s <= -0.15 ? 'warn' : 'neu');
const pill = (label, s, extra = '') => `<span class="ipill t-${toneOf(label, s)}${extra}">${esc(label)}</span>`;
const dirTone = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : 'neu');
const CONF = { High: 'c-hi', Moderate: 'c-mid', Low: 'c-lo' };
const conf = (l) => `<span class="iconf ${CONF[l] || 'c-lo'}" title="Confidence: data coverage, freshness and agreement">${esc(l)} confidence</span>`;
const sbar = (s) => (s === null || s === undefined ? '<span class="sbar off"></span>' : `<span class="sbar" title="${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(2)} on a −1 to +1 scale"><i class="${s >= 0 ? 'p' : 'n'}" style="${s >= 0 ? 'left:50%' : `left:${50 + s * 50}%`};width:${Math.abs(s) * 50}%"></i></span>`);
const ago = (d) => { if (!d) return ''; const t = Date.parse(d.length === 10 ? d + 'T00:00:00Z' : d); const h = (Date.now() - t) / 36e5; return h < 36 ? (d.length === 10 ? d : new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC') : d.slice(0, 10); };
const gradeWord = (g) => (g >= 70 ? 'strong' : g >= 58 ? 'constructive' : g >= 45 ? 'balanced' : g >= 33 ? 'fragile' : 'weak');

// ---------------------------------------------------------------- force library (shared bits)
// Every force row on the site comes from I.forces (the engine's FORCE_LIBRARY); drivers/offsets are
// its material subset. A force chip always carries its domain tag and links to its library entry.
export const forceTag = (f) => `<span class="dtag">${esc(f.domainName)}</span>`;
export const forceHref = (f) => `#force-${f.id}`;
const STR = { Strong: 'high strength', Moderate: 'moderate strength', Weak: 'low strength' };

// ---------------------------------------------------------------- dashboard
export function marketReadHtml(I, info = () => '') {
  if (!I) return `<div class="dc-h"><h2>Market read${info('i_read')}</h2></div><p class="muted small">Waiting for enough data.</p>`;
  const c2 = I.changes?.d2;
  const M = materialForces(I, 3, 3);
  const more = (n) => (n > 0 ? `<p class="xs dim ir-more"><a href="#analysis/drivers">+${n} more on Analysis</a></p>` : '');
  const li = (f) => `<li><span class="fdot t-${dirTone(f.dir)}"></span><span class="fn"><a href="${forceHref(f)}"><b>${esc(f.name)}</b></a> ${forceTag(f)}</span><span class="fmeta">${esc(f.label)} · ${esc(STR[f.strengthWord])} · ${esc(f.horizon)}${f.persistence >= 3 ? ` · ${f.persistence >= 30 ? '30+' : f.persistence} days` : ''}</span></li>`;
  return `<div class="dc-h"><h2>Market read${info('i_read')}</h2><a class="ps-more" href="#overview">Full intelligence →</a></div>
    <div class="ir-top">
      <div class="ir-state t-${toneOf(I.state)}">${esc(I.state)}</div>
      <div class="ir-grade" title="Fair Grade: the engine’s score of today’s overall market configuration (not a forecast)"><span class="k">Fair Grade${info('i_grade')}</span><b class="num">${I.grade.value}</b><span class="of">/ 100</span><span class="gbar2"><i style="width:${I.grade.value}%"></i></span></div>
    </div>
    <p class="ir-sub"><b>${I.breadth.n} of ${I.breadth.of}</b> domains Constructive or better${I.breadth.neg ? ` · ${I.breadth.neg} Cautionary or worse` : ''} · ${conf(I.confidence.level)}</p>
    ${I.cycle ? `<p class="ir-struct">Structure: ${esc(I.cycle.phase.toLowerCase())}${I.cycle.transitional && I.cycle.runnerUp ? `, bordering on ${esc(I.cycle.runnerUp.phase.toLowerCase())}` : ''}${info('i_cycle')}</p>` : ''}
    <div class="ir-doms">${I.domains.map((d) => `<a class="ir-dom t-${toneOf(d.state, d.score)}" href="${DLINK(d.key)}" title="${esc(d.question)}"><span class="n">${esc(d.name)}</span><span class="a">${d.arrow}</span><span class="s">${esc(d.state)}</span></a>`).join('')}</div>
    <div class="ir-cols ovf">
      <div><h3>Key drivers${info('i_forces')}</h3>${M.drivers.length ? `<ul class="ir-f">${M.drivers.map(li).join('')}</ul>` : '<p class="muted small">No material supportive force right now.</p>'}${more(I.drivers.length - M.drivers.length)}</div>
      <div><h3>Key offsets</h3>${M.offsets.length ? `<ul class="ir-f">${M.offsets.map(li).join('')}</ul>` : '<p class="muted small">No material offsetting force right now.</p>'}${more(I.offsets.length - M.offsets.length)}</div>
    </div>
    ${c2 ? `<p class="ir-chg"><span class="k">What changed${info('i_changes')}</span><span class="ir-hz">${[['2d', I.changes.d2], ['7d', I.changes.d7], ['30d', I.changes.d30]].map(([l, c]) => (c?.domains ? `<span title="${esc(c.text)}"><i>${l}</i>${pill(c.label, c.label === 'Improving' ? 1 : c.label === 'Deteriorating' ? -0.5 : 0)}</span>` : '')).join('')}</span>${esc(c2.text)}</p>` : ''}
    <p class="tr-n">Rules-based synthesis of free public data across five domains — not investment advice and not a forecast.</p>`;
}

// ---------------------------------------------------------------- intelligence
function forceCard(f, detail = () => '') {
  const st = f.active ? (f.dir > 0 ? 'Supportive' : 'Adverse') : 'Inactive';
  return `<details class="iforce lib t-${f.active ? dirTone(f.dir) : 'ctx'}${f.active ? '' : ' off'}" id="force-${f.id}"${f.material ? ' open' : ''}>
    <summary><span class="lf-n"><b>${esc(f.name)}</b> ${forceTag(f)}</span><span class="lf-s">${pill(st, f.active ? f.dir : null)}${f.score !== null ? `<span class="small muted">${esc(f.label)}</span>` : '<span class="small muted">no data</span>'}</span>${sbar(f.score)}</summary>
    <p>${esc(f.text)}</p>
    <div class="ifm">
      <span><span class="k">Score</span>${f.score === null ? '—' : `${f.score >= 0 ? '+' : '−'}${Math.abs(f.score).toFixed(2)}`} <span class="xs dim">active at ±${f.threshold.toFixed(2)}</span></span>
      <span><span class="k">Strength</span>${esc(STR[f.strengthWord])}<span class="mtr"><i style="width:${Math.round(f.strength * 100)}%"></i></span></span>
      <span><span class="k">Confidence</span>${esc(f.confidence)}</span>
      <span><span class="k">Horizon</span>${esc(f.horizonText)}</span>
      <span><span class="k">Persistence</span>${!f.active ? '—' : f.persistence >= 30 ? '30+ days' : f.persistence ? `${f.persistence} day${f.persistence > 1 ? 's' : ''}` : 'new today'}</span>
      <span><span class="k">Trend</span>${esc(f.trend || '—')}</span>
      <span><span class="k">Materiality</span>${f.materiality.toFixed(2)}${f.material ? ` · ${f.dir > 0 ? 'driver' : 'offset'}` : ''}</span>
    </div>
    <p class="xs dim"><b>Rule.</b> ${esc(f.rule)}</p>
    <p class="xs dim fin"><b>Inputs.</b> ${f.inputs.filter((i) => i.live).map((i) => `${esc(i.name)}${i.context ? ' (context)' : ''}`).join(' · ') || 'none available'}${f.inputs.some((i) => !i.live) ? ` <span class="fmiss">Missing this run: ${f.inputs.filter((i) => !i.live).map((i) => esc(i.name)).join(' · ')}</span>` : ''}</p>
    ${f.note ? `<p class="xs fnote">${esc(f.note)}</p>` : ''}
    <details><summary>Evidence</summary><ul class="iev">${f.evidence.map((e) => `<li>${pill(e.state, null)} <a href="${ILINK(e.id)}"><b>${esc(e.name)}</b></a> ${esc(e.disp)} <span class="xs dim">${esc(e.src)} · ${esc(ago(e.asOf))}</span></li>`).join('')}</ul></details>
    ${detail(f)}
  </details>`;
}
function changeCard(c, title) {
  if (!c) return '';
  if (!c.domains) return `<article class="ichg"><h3>${title}</h3>${pill(c.label, 0)}<p class="small muted">${esc(c.text)}</p></article>`;
  const d = (x) => (x === null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`);
  return `<article class="ichg"><h3>${title}</h3>
    <div class="ichg-h">${pill(c.label, c.label === 'Improving' ? 1 : c.label === 'Deteriorating' ? -0.5 : 0)}<span class="small muted">${esc(c.stateThen)} → <b>${esc(c.stateNow)}</b> · grade ${c.gradeThen} → <b>${c.gradeNow}</b></span></div>
    <p class="small">${esc(c.text)}</p>
    <ul class="ichg-d">${c.domains.map((x) => `<li><span>${esc(x.name)}</span><span class="num ${x.delta >= 0.1 ? 'up' : x.delta <= -0.1 ? 'down' : ''}">${d(x.delta)}</span></li>`).join('')}</ul>
    ${c.movers.up.length || c.movers.down.length ? `<details><summary>Biggest indicator moves</summary><ul class="iev">${[...c.movers.up, ...c.movers.down].map((m) => `<li><span class="${m.ds > 0 ? 'up' : 'down'}">${m.ds > 0 ? '▲' : '▼'}</span> <b>${esc(m.name)}</b> ${esc(m.from)} → ${esc(m.to)} <span class="xs dim">${esc(m.dom)}</span></li>`).join('')}</ul></details>` : ''}
    <p class="xs dim">Like-for-like: compared on the ${c.n} of ${c.of} indicators that have readings on both dates.</p>
  </article>`;
}
// Intelligence → Current read: one posture (with Fair Grade and confidence), a structure subtitle,
// valuation and risk as small metadata (not peer conclusions), the five domains, the active
// drivers/offsets, the full force library and what changed. Deeper panels live on the
// Intelligence sub-pages (Liquidity map, Cross-market, Risk context).
export function intelligenceHtml(I, info = () => '', opts = {}) {
  if (!I) return '<div class="empty-state"><p>The intelligence read needs the published data files; it will appear once they load.</p></div>';
  const V = I.valuation, C = I.cycle, K = I.risk, X = I.confirmation;
  const gp = I.grade.parts;
  const mx = Math.max(...gp.map((p) => Math.abs(p.pts)), 6);
  const M = materialForces(I, 5, 4);
  const li = (f) => `<li><span class="fdot t-${dirTone(f.dir)}"></span><span class="fn"><a href="${forceHref(f)}"><b>${esc(f.name)}</b></a> ${forceTag(f)}</span><span class="fmeta">${esc(f.label)} · ${esc(STR[f.strengthWord])} · ${esc(f.horizon)}${f.persistence >= 3 ? ` · ${f.persistence >= 30 ? '30+' : f.persistence} days` : ''}</span></li>`;
  // the valuation evidence table lives inside the Valuation & holder profit force entry
  const valuationDetail = () => `<details class="fdet"><summary>Valuation read across the framework · ${V ? esc(V.state) : 'unavailable'}${info('i_valuation')}</summary>
      ${V ? `<div class="iconc"><div class="iconc-h"><div class="ipill t-${V.state === 'Fair' ? 'neu' : ['Depressed', 'Attractive'].includes(V.state) ? 'up' : 'warn'}">${esc(V.state)}</div>${conf(V.confidence)}<span class="vscale">${['Depressed', 'Attractive', 'Fair', 'Elevated', 'Extreme'].map((s) => `<i class="${s === V.state ? 'on' : ''}">${s}</i>`).join('')}</span></div>
        <p>${esc(V.context)}</p>
        <div class="tbl-wrap"><table class="itbl"><thead><tr><th>Evidence</th><th>Reading</th><th>Reads as</th><th>Weight</th></tr></thead><tbody>${V.evidence.map((e) => `<tr><td data-k="Evidence"><b>${esc(e.name)}</b><div class="xs dim">${esc(e.src)} · ${esc(ago(e.asOf))}</div></td><td data-k="Reading" class="num">${esc(e.disp)}</td><td data-k="Reads as">${pill(e.zone, e.score / 2)}</td><td data-k="Weight" class="num">${e.w}</td></tr>`).join('')}</tbody></table></div>
        <p class="xs dim">Each input is placed on a cheap-to-rich scale against its own historical zones; the weighted reading sets the state (MVRV carries the most weight; NUPL and realised price repeat MVRV and are not counted twice). MVRV Z-Score is shown on the Analysis pages; NVT is not available from free sources.</p></div>` : '<p class="muted">Valuation inputs unavailable.</p>'}</details>`;
  const detail = (f) => (f.id === 'valuation' ? valuationDetail() : '') + (opts.forceDetail ? opts.forceDetail(f) : '');
  return `<section class="ihero">
      <div class="ihero-l">
        <span class="k">Market intelligence · current read${info('i_read')}</span>
        <div class="ir-state big t-${toneOf(I.state)}">${esc(I.state)}</div>
        <div class="ir-gtile" title="Fair Grade: how strong today’s read is, 0–100 — the quantitative strength of the same posture, not a forecast">
          <div class="ir-grade lg"><span class="k">Fair Grade${info('i_grade')}</span><b class="num">${I.grade.value}</b><span class="of">/ 100 · ${gradeWord(I.grade.value)}</span><span class="gbar2"><i style="width:${I.grade.value}%"></i></span></div>
          <a class="xs ir-gcalc-l" href="#overview" data-jump="fair-grade">How it is calculated ↓</a>
        </div>
        <p class="ir-sub">${I.breadth.n} of ${I.breadth.of} domains Constructive or better · ${conf(I.confidence.level)}</p>
        ${C ? `<p class="ir-struct">Structure: ${esc(C.phase.toLowerCase())}${C.transitional && C.runnerUp ? `, bordering on ${esc(C.runnerUp.phase.toLowerCase())}` : ''}${info('i_cycle')}</p>` : ''}
      </div>
      <div class="ihero-r"><p class="xs dim" style="margin:0 0 6px">The five analytical domains — open one for its research page:</p><div class="imatrix sm">${I.domains.map((d) => `<a href="${DLINK(d.key)}" class="imx t-${toneOf(d.state, d.score)}"><span class="n">${esc(d.name)}</span><b>${d.arrow} ${esc(d.state)}</b></a>`).join('')}</div></div>
    </section>

    <section class="block ir-gcalc" id="fair-grade"><div class="bh"><h2>Inside the Fair Grade${info('i_grade')}</h2><p class="aside">50 + the contributions below = ${Number.isFinite(I.grade.raw) ? `${I.grade.raw.toFixed(1)} → <b>${I.grade.value}</b> (rounded)` : `<b>${I.grade.value}</b>`}</p></div>
      <div class="ir-gcols"><div><div class="igrade">${gp.map((p) => `<div class="igr"><span class="gl">${esc(p.label)}</span><span class="gb"><i class="${p.pts >= 0 ? 'p' : 'n'}" style="${p.pts >= 0 ? 'left:50%' : `left:${50 + (p.pts / mx) * 50}%`};width:${(Math.abs(p.pts) / mx) * 50}%"></i></span><span class="gv num">${p.pts > 0 ? '+' : p.pts < 0 ? '−' : ''}${Math.abs(p.pts).toFixed(1)}</span><span class="gn xs dim">${esc(p.note)}</span></div>`).join('')}</div>
      <p class="xs dim">The grade weighs breadth, strength, conflicts, risk and valuation; each contribution is scaled by the confidence of the data behind it. It describes today’s configuration and is not a probability or a price forecast.</p></div>
      <div><h3 class="rh3">Fair Grade over time</h3><div data-gradechart><p class="small muted">Computing…</p></div></div></div></section>

    <section class="block" id="ir-forces"><div class="bh"><h2>Drivers and offsets${info('i_forces')}</h2><p class="aside">Active forces from the library below · same names on Analysis and the Dashboard</p></div>
      <div class="ir-cols ovf">
        <div><h3>Drivers</h3>${M.drivers.length ? `<ul class="ir-f">${M.drivers.map(li).join('')}</ul>` : '<p class="muted small">No active supportive force.</p>'}</div>
        <div><h3>Offsets</h3>${M.offsets.length ? `<ul class="ir-f">${M.offsets.map(li).join('')}</ul>` : '<p class="muted small">No active offsetting force.</p>'}</div>
      </div>
      <details class="more ir-why"><summary>Explain in plain English <span class="dim">— the reasoning behind the posture, as of ${esc(I.asOf)}</span></summary><div class="more-body">
        <div class="inarr">${I.narrative.map((p) => `<p>${rich(p)}</p>`).join('')}</div>
        ${I.regime ? `<h3 class="rh3">What the structure description rests on</h3><div class="ir-sev">${I.regime.evidence.map((e) => `<span class="lchip t-${toneOf(e.word, e.score)}">${esc(e.name)} · ${esc(e.word)}</span>`).join('')}</div>${C ? `<p class="xs dim">Consistent: ${esc(C.met.join('; ') || '—')}. Not consistent: ${esc(C.unmet.join('; ') || '—')}. Classified from structural evidence across the five domains — not from a cycle clock or time since the halving. <a href="#analysis/regime">Historical context on Analysis →</a></p>` : ''}` : ''}

      </div></details></section>

    <section class="block" id="forces"><div class="bh"><h2>What is moving Bitcoin: the force library${info('i_forces')}</h2><p class="aside">Full force library. Drivers/offsets on Analysis and Dashboard are the material subset.</p></div>
      <div class="lib-sum">${['tech', 'chain', 'mkt', 'sent', 'macro'].map((k) => { const fs = I.forces.filter((f) => f.domain === k); return `<span><b>${esc(fs[0]?.domainName || k)}</b> ${fs.map((f) => `<a href="${forceHref(f)}" class="lchip t-${f.active ? dirTone(f.dir) : 'ctx'}" title="${esc(f.label || f.name)}">${esc(f.name)}</a>`).join('')}</span>`; }).join('')}</div>
      <h3 class="rh3">Active forces · ranked by materiality (strength × confidence × horizon)</h3>
      ${I.forces.filter((f) => f.active).length ? `<div class="iforces lib">${I.forces.filter((f) => f.active).map((f) => forceCard(f, detail)).join('')}</div>` : '<p class="muted">No force is above its activation threshold.</p>'}
      <h3 class="rh3">Inactive forces · below their activation threshold</h3>
      <div class="iforces lib">${I.forces.filter((f) => !f.active).map((f) => forceCard(f, detail)).join('')}</div>
      <p class="xs dim">${I.forces.length} forces, each in one domain, each built from indicators already on the site. A force is active when its score crosses its threshold: active supportive forces are the drivers, active adverse forces the offsets, ranked by materiality (strength × confidence × horizon). The Dashboard shows up to 3 of each, Analysis up to 5 drivers and 4 offsets — always the same forces, names and order as here. Inputs missing on a given run are listed on the force, never filled in. Volatility squeeze (Bollinger width) is not a force — it has no direction — and stays an indicator under Technical.</p></section>

    <section class="block"><div class="bh"><h2>What changed${info('i_changes')}</h2><p class="aside">Current state versus 2, 7 and 30 days ago, on a like-for-like basis</p></div>
      <div class="ichgs">${changeCard(I.changes.d2, '2 days')}${changeCard(I.changes.d7, '7 days')}${changeCard(I.changes.d30, '30 days')}</div></section>

    <section class="block ir-next"><div class="bh"><h2>Go deeper</h2><p class="aside">The same engine, in more detail</p></div>
      ${X.diverge.length ? `<p class="small"><span class="k">Divergence</span> ${esc(X.diverge[0].text)}${X.diverge.length > 1 ? ` <span class="dim">(+${X.diverge.length - 1} more)</span>` : ''}</p>` : ''}
      <div class="ir-links">
        <a href="#overview/liquidity"><b>Liquidity map</b><span>Key levels, the full band table and the acceleration conditions around them</span></a>
        <a href="#overview/cross"><b>Cross-market</b><span>Where the domains agree or diverge, signals by time horizon, the market dashboard</span></a>
        <a href="#overview/risk"><b>Risk context</b><span>Risk regime (${esc(K.level.toLowerCase())}), stress signals, leverage and derivatives, what to watch</span></a>
      </div></section>`;
}

// Intelligence → Cross-market: the full confirmation panel and the time-horizon view.
export function crossMarketHtml(I, info = () => '') {
  if (!I) return '';
  const X = I.confirmation;
  return `<section class="block"><div class="bh"><h2>Cross-market confirmation${info('i_confirm')}</h2><p class="aside">Where independent domains agree, and where they do not</p></div>
      <div class="icross">
        <div class="icm">${I.domains.map((d) => `<div class="icr"><span>${esc(d.name)}</span><b class="t-${toneOf(d.state, d.score)}">${d.arrow}</b><span class="xs dim">${esc(d.state)}</span></div>`).join('')}
          ${X.lens.map((l) => `<div class="icr lens"><span>${esc(l.name)}</span><b class="t-${toneOf(null, l.s)}">${l.arrow}</b><span class="xs dim">${esc(l.note)}</span></div>`).join('')}
          <p class="xs dim">Lens rows show the direction of the quantity itself (more leverage, hotter sentiment ↑); colour shows whether that helps (green) or hurts (amber/red).</p></div>
        <div>
          <h3>Confirmation</h3>${X.agree.length ? X.agree.map((a) => `<p>${esc(a.text)}</p>`).join('') : '<p class="muted small">Fewer than three domains point the same way: no broad confirmation.</p>'}
          <h3>Breadth</h3><p class="small">${X.breadth ? `Supportive: ${esc(X.breadth.supportive.join(', ') || 'none')}. Neutral: ${esc(X.breadth.neutral.join(', ') || 'none')}. Cautionary: ${esc(X.breadth.cautionary.join(', ') || 'none')}.` : ''}</p>
          <h3>Concentration</h3><p class="small">${X.concentration ? esc(X.concentration.text) : 'The domains roughly cancel out; there is no net direction to concentrate.'}</p>
          <h3>Divergence</h3>${X.diverge.length ? `<ul class="idiv">${X.diverge.map((x) => `<li class="${x.constructive ? 'up' : ''}">${esc(x.text)}</li>`).join('')}</ul>` : '<p class="muted small">No notable divergences.</p>'}
          <p class="xs dim">Divergence is information too: it marks where the current read is most likely to be tested.</p>
        </div>
      </div></section>

    <section class="block"><div class="bh"><h2>By time horizon</h2><p class="aside">The same signals grouped by the horizon they work on</p></div>
      <div class="ihz">${(I.horizons || []).map((x) => `<div class="ihz-c t-${toneOf(x.state, x.score)}"><span class="k">${esc(x.label)}</span><b>${esc(x.state)}</b>${sbar(x.score)}<span class="xs dim">${x.sup} supportive · ${x.cau} cautionary of ${x.n}</span></div>`).join('')}</div>
      <p class="xs dim">Signals on different horizons can disagree without contradicting each other — stretched short-term momentum can coexist with an intact long-term trend. Force ranking weighs horizon so short-term signals cannot outweigh structural ones on their own.</p></section>`;
}

// Intelligence → Risk context: the risk regime in full, plus the leverage & derivatives stress inputs.
export function riskContextHtml(I, info = () => '') {
  if (!I) return '';
  const K = I.risk, L = I.forces.find((f) => f.id === 'leverage');
  return `<section class="block"><div class="bh"><h2>Risk regime${info('i_risk')}</h2><p class="aside">How fragile current conditions are, in either direction</p></div>
      <div class="iconc"><div class="iconc-h"><div class="ir-state t-${{ Low: 'up', Moderate: 'neu', Elevated: 'warn', High: 'down' }[K.level]}">${esc(K.level)}</div><span class="small muted">${K.points} stress point${K.points === 1 ? '' : 's'}</span></div>
        <p>${esc(K.desc)}</p>${K.evidence.length ? `<ul class="ichk">${K.evidence.map((e) => `<li class="n">${esc(e.why)} <span class="xs dim">+${e.n}</span></li>`).join('')}</ul>` : '<p class="small muted">No stress signals active.</p>'}</div></section>

    ${L ? `<section class="block"><div class="bh"><h2>Leverage and derivatives stress</h2><p class="aside">Inputs of the <a href="#force-leverage">Leverage &amp; derivatives</a> force · ${esc(L.active ? L.label : 'below threshold')}</p></div>
      <div class="tbl-wrap"><table class="itbl"><thead><tr><th>Input</th><th>Reading</th><th>Reads as</th></tr></thead><tbody>${L.evidence.map((e) => `<tr><td data-k="Input"><a href="${ILINK(e.id)}"><b>${esc(e.name)}</b></a><div class="xs dim">${esc(e.src)} · ${esc(ago(e.asOf))}</div></td><td data-k="Reading" class="num">${esc(e.disp)}</td><td data-k="Reads as">${pill(e.state, null)}</td></tr>`).join('')}</tbody></table></div>
      ${L.inputs.some((i) => !i.live) ? `<p class="xs fnote">Missing this run: ${L.inputs.filter((i) => !i.live).map((i) => esc(i.name)).join(' · ')}</p>` : ''}
      <p class="xs dim">${esc(L.rule)}</p></section>` : ''}`;
}

// domain chips are plain links to the Analysis routes; kept for callers
export function wireIntel() {}
