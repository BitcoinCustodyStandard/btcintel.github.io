// Views for the Market Intelligence Engine (engine/intel.js):
//   marketReadHtml  — the dashboard's ten-second Market read
//   intelligenceHtml — Intelligence tab: what matters now and why, valuation, market regime, risk
// All text comes from the engine's evidence; nothing here adds figures of its own.

import { DOMAIN_SLUG, DEF_BY_ID, indSlug } from '../engine/intel.js?v=20261003r';

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

// ---------------------------------------------------------------- dashboard
export function marketReadHtml(I, info = () => '') {
  if (!I) return `<div class="dc-h"><h2>Market read${info('i_read')}</h2></div><p class="muted small">Waiting for enough data.</p>`;
  const c2 = I.changes?.d2;
  const li = (f) => `<li><span class="fdot t-${dirTone(f.dir)}"></span><b>${esc(f.name)}</b><span class="fmeta">${esc(f.strengthWord)} · ${esc(f.horizon)}${f.persistence >= 3 ? ` · ${f.persistence >= 30 ? '30+' : f.persistence} days` : ''}</span></li>`;
  return `<div class="dc-h"><h2>Market read${info('i_read')}</h2><a class="ps-more" href="#overview">Full intelligence →</a></div>
    <div class="ir-top">
      <div class="ir-state t-${toneOf(I.state)}">${esc(I.state)}</div>
      <div class="ir-grade" title="Fair Grade: the engine’s score of today’s overall market configuration (not a forecast)"><span class="k">Fair Grade${info('i_grade')}</span><b class="num">${I.grade.value}</b><span class="of">/ 100</span><span class="gbar2"><i style="width:${I.grade.value}%"></i></span></div>
    </div>
    <p class="ir-sub"><b>${I.breadth.n} of ${I.breadth.of}</b> domains Constructive or better${I.breadth.neg ? ` · ${I.breadth.neg} Cautionary or worse` : ''} · ${conf(I.confidence.level)}</p>
    <div class="ir-doms">${I.domains.map((d) => `<a class="ir-dom t-${toneOf(d.state, d.score)}" href="${DLINK(d.key)}" title="${esc(d.question)}"><span class="n">${esc(d.name)}</span><span class="a">${d.arrow}</span><span class="s">${esc(d.state)}</span></a>`).join('')}</div>
    <div class="ir-cols">
      <div><h3>Key drivers${info('i_forces')}</h3>${I.drivers.length ? `<ul class="ir-f">${I.drivers.slice(0, 3).map(li).join('')}</ul>` : '<p class="muted small">No strong supportive force right now.</p>'}</div>
      <div><h3>Key offsets</h3>${I.offsets.length ? `<ul class="ir-f">${I.offsets.slice(0, 3).map(li).join('')}</ul>` : '<p class="muted small">No strong offsetting force right now.</p>'}</div>
    </div>
    ${c2 ? `<p class="ir-chg"><span class="k">What changed${info('i_changes')}</span><span class="ir-hz">${[['2d', I.changes.d2], ['7d', I.changes.d7], ['30d', I.changes.d30]].map(([l, c]) => (c?.domains ? `<span title="${esc(c.text)}"><i>${l}</i>${pill(c.label, c.label === 'Improving' ? 1 : c.label === 'Deteriorating' ? -0.5 : 0)}</span>` : '')).join('')}</span>${esc(c2.text)}</p>` : ''}
    <div class="ir-concl">
      ${I.valuation ? `<span><span class="k">Valuation${info('i_valuation')}</span><b>${esc(I.valuation.state)}</b></span>` : ''}
      ${I.regime ? `<span><span class="k">Market regime${info('i_cycle')}</span><b><a href="#analysis/regime">${esc(I.regime.label)}</a></b></span>` : ''}
      <span><span class="k">Risk regime${info('i_risk')}</span><b>${esc(I.risk.level)}</b></span>
    </div>
    <p class="tr-n">Rules-based synthesis of free public data across five domains — not investment advice and not a forecast.</p>`;
}

// ---------------------------------------------------------------- intelligence
function forceCard(f) {
  return `<article class="iforce t-${dirTone(f.dir)}">
    <header><b>${esc(f.name)}</b><span class="xs dim">${esc(f.domains.join(' · '))}</span></header>
    <p>${esc(f.text)}</p>
    <div class="ifm">
      <span><span class="k">Strength</span>${esc(f.strengthWord)}<span class="mtr"><i style="width:${Math.round(f.strength * 100)}%"></i></span></span>
      <span><span class="k">Confidence</span>${esc(f.confidence)}</span>
      <span><span class="k">Horizon</span>${esc(f.horizonText)}</span>
      <span><span class="k">Persistence</span>${f.persistence >= 30 ? '30+ days' : f.persistence ? `${f.persistence} day${f.persistence > 1 ? 's' : ''}` : 'new today'}</span>
      <span><span class="k">Trend</span>${esc(f.trend)}</span>
    </div>
    <details><summary>Evidence</summary><ul class="iev">${f.evidence.map((e) => `<li>${pill(e.state, null)} <a href="${ILINK(e.id)}"><b>${esc(e.name)}</b></a> ${esc(e.disp)} <span class="xs dim">${esc(e.src)} · ${esc(ago(e.asOf))}</span></li>`).join('')}</ul></details>
  </article>`;
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
export function intelligenceHtml(I, info = () => '') {
  if (!I) return '<div class="empty-state"><p>The intelligence read needs the published data files; it will appear once they load.</p></div>';
  const V = I.valuation, C = I.cycle, K = I.risk, X = I.confirmation;
  const gp = I.grade.parts;
  const mx = Math.max(...gp.map((p) => Math.abs(p.pts)), 6);
  return `<section class="ihero">
      <div class="ihero-l">
        <span class="k">Market intelligence · current read${info('i_read')}</span>
        <div class="ir-state big t-${toneOf(I.state)}">${esc(I.state)}</div>
        <p class="ir-sub">Fair Grade <b class="num">${I.grade.value}</b> / 100 (${gradeWord(I.grade.value)}) · ${I.breadth.n} of ${I.breadth.of} domains Constructive or better · ${conf(I.confidence.level)}</p>
        <div class="ir-concl">${V ? `<span><span class="k">Valuation</span><b>${esc(V.state)}</b></span>` : ''}${I.regime ? `<span><span class="k">Market regime</span><b>${esc(I.regime.label)}</b></span>` : ''}<span><span class="k">Risk regime</span><b>${esc(K.level)}</b></span></div>
      </div>
      <div class="ihero-r"><p class="xs dim" style="margin:0 0 6px">The five analytical domains — open one for its research page:</p><div class="imatrix sm">${I.domains.map((d) => `<a href="${DLINK(d.key)}" class="imx t-${toneOf(d.state, d.score)}"><span class="n">${esc(d.name)}</span><b>${d.arrow} ${esc(d.state)}</b></a>`).join('')}</div></div>
    </section>

    <section class="block"><div class="bh"><h2>Why</h2><p class="aside">Data as of ${esc(I.asOf)} · plain-English synthesis of the evidence below</p></div>
      <div class="inarr">${I.narrative.map((p) => `<p>${rich(p)}</p>`).join('')}</div></section>

    <section class="block"><div class="bh"><h2>What is driving Bitcoin${info('i_forces')}</h2><p class="aside">Forces detected across domains, ranked by strength × confidence × horizon</p></div>
      ${I.drivers.length ? `<div class="iforces">${I.drivers.slice(0, 5).map(forceCard).join('')}</div>` : '<p class="muted">No strong supportive force is active.</p>'}</section>

    <section class="block"><div class="bh"><h2>What is holding it back</h2><p class="aside">The offsets, ranked the same way</p></div>
      ${I.offsets.length ? `<div class="iforces">${I.offsets.slice(0, 5).map(forceCard).join('')}</div>` : '<p class="muted">No strong offsetting force is active.</p>'}
      ${I.watch.length ? `<div class="iwatch"><span class="k">Two-way watch</span>${I.watch.map((w) => `<p><b>${esc(w.name)}.</b> ${esc(w.text)}</p>`).join('')}</div>` : ''}</section>

    <section class="block"><div class="bh"><h2>By time horizon</h2><p class="aside">The same signals grouped by the horizon they work on</p></div>
      <div class="ihz">${(I.horizons || []).map((x) => `<div class="ihz-c t-${toneOf(x.state, x.score)}"><span class="k">${esc(x.label)}</span><b>${esc(x.state)}</b>${sbar(x.score)}<span class="xs dim">${x.sup} supportive · ${x.cau} cautionary of ${x.n}</span></div>`).join('')}</div>
      <p class="xs dim">Signals on different horizons can disagree without contradicting each other — stretched short-term momentum can coexist with an intact long-term trend. Force ranking weighs horizon so short-term signals cannot outweigh structural ones on their own.</p></section>

    <section class="block"><div class="bh"><h2>Cross-market confirmation${info('i_confirm')}</h2><p class="aside">Where independent domains agree, and where they do not</p></div>
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

    <section class="block"><div class="bh"><h2>What changed${info('i_changes')}</h2><p class="aside">Current state versus 2, 7 and 30 days ago, on a like-for-like basis</p></div>
      <div class="ichgs">${changeCard(I.changes.d2, '2 days')}${changeCard(I.changes.d7, '7 days')}${changeCard(I.changes.d30, '30 days')}</div></section>

    <section class="block"><div class="bh"><h2>Valuation${info('i_valuation')}</h2><p class="aside">A conclusion from the whole framework — never one metric</p></div>
      ${V ? `<div class="iconc"><div class="iconc-h"><div class="ir-state t-${V.state === 'Fair' ? 'neu' : ['Depressed', 'Attractive'].includes(V.state) ? 'up' : 'warn'}">${esc(V.state)}</div>${conf(V.confidence)}<span class="vscale">${['Depressed', 'Attractive', 'Fair', 'Elevated', 'Extreme'].map((s) => `<i class="${s === V.state ? 'on' : ''}">${s}</i>`).join('')}</span></div>
        <p>${esc(V.context)}</p>
        <div class="tbl-wrap"><table class="itbl"><thead><tr><th>Evidence</th><th>Reading</th><th>Reads as</th><th>Weight</th></tr></thead><tbody>${V.evidence.map((e) => `<tr><td data-k="Evidence"><b>${esc(e.name)}</b><div class="xs dim">${esc(e.src)} · ${esc(ago(e.asOf))}</div></td><td data-k="Reading" class="num">${esc(e.disp)}</td><td data-k="Reads as">${pill(e.zone, e.score / 2)}</td><td data-k="Weight" class="num">${e.w}</td></tr>`).join('')}</tbody></table></div>
        <p class="xs dim">Each input is placed on a cheap-to-rich scale against its own historical zones; the weighted reading sets the state (MVRV carries the most weight; NUPL and realised price repeat MVRV and are not counted twice). MVRV Z-Score is shown on the Analysis pages; NVT is not available from free sources.</p></div>` : '<p class="muted">Valuation inputs unavailable.</p>'}</section>

    <section class="block"><div class="bh"><h2>Market regime${info('i_cycle')}</h2><p class="aside">What regime current conditions are consistent with · <a href="#analysis/regime">evidence and historical context on Analysis →</a></p></div>
      ${I.regime ? `<div class="iconc"><div class="iconc-h"><div class="ir-state t-${toneOf(I.regime.label)}">${esc(I.regime.label)}</div>${conf(I.regime.confidence)}${C ? `<span class="small muted">Most consistent with ${esc(C.phase.toLowerCase())}${C.transitional && C.runnerUp ? `, bordering on ${esc(C.runnerUp.phase.toLowerCase())}` : ''}</span>` : ''}</div>
        <p>${esc(I.regime.why)}</p>
        <p class="xs dim">Classified from structural evidence across all five domains (trend, price structure, holder positioning, on-chain flows, institutional demand, liquidity, leverage, valuation room) — not from a cycle clock or time since the halving.</p></div>` : '<p class="muted">Not enough data.</p>'}</section>

    <section class="block"><div class="bh"><h2>Risk regime${info('i_risk')}</h2><p class="aside">How fragile current conditions are, in either direction</p></div>
      <div class="iconc"><div class="iconc-h"><div class="ir-state t-${{ Low: 'up', Moderate: 'neu', Elevated: 'warn', High: 'down' }[K.level]}">${esc(K.level)}</div><span class="small muted">${K.points} stress point${K.points === 1 ? '' : 's'}</span></div>
        <p>${esc(K.desc)}</p>${K.evidence.length ? `<ul class="ichk">${K.evidence.map((e) => `<li class="n">${esc(e.why)} <span class="xs dim">+${e.n}</span></li>`).join('')}</ul>` : '<p class="small muted">No stress signals active.</p>'}</div></section>

    <section class="block"><div class="bh"><h2>Inside the Fair Grade${info('i_grade')}</h2><p class="aside">${I.grade.value} = 50 + the contributions below</p></div>
      <div class="igrade">${gp.map((p) => `<div class="igr"><span class="gl">${esc(p.label)}</span><span class="gb"><i class="${p.pts >= 0 ? 'p' : 'n'}" style="${p.pts >= 0 ? 'left:50%' : `left:${50 + (p.pts / mx) * 50}%`};width:${(Math.abs(p.pts) / mx) * 50}%"></i></span><span class="gv num">${p.pts > 0 ? '+' : p.pts < 0 ? '−' : ''}${Math.abs(p.pts).toFixed(1)}</span><span class="gn xs dim">${esc(p.note)}</span></div>`).join('')}</div>
      <p class="xs dim">The grade weighs breadth, strength, conflicts, risk and valuation; each contribution is scaled by the confidence of the data behind it. It describes today’s configuration and is not a probability or a price forecast.</p></section>`;
}

// domain chips are plain links to the Analysis routes; kept for callers
export function wireIntel() {}
