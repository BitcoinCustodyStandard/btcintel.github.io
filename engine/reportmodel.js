// The Daily BTCIntel Report, as data. Built only from the intelligence engine's output (and
// the daily analysis for the date), so the planned PDF and the website can never disagree.
// The PDF renderer is a later phase; the Reports page shows this outline today.

const pct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}` : '—');
export function reportModel(I, a = null) {
  const D = (k) => I.domains.find((x) => x.key === k);
  const dom = (k, title) => {
    const d = D(k); if (!d) return { title, lines: [] };
    const sc = d.comps.flatMap((c) => c.indicators).filter((r) => r.s !== null);
    const top = [...sc].sort((x, y) => y.s * y.w - x.s * x.w)[0], low = [...sc].sort((x, y) => x.s * x.w - y.s * y.w)[0];
    return { title, lines: [`${d.state} (${pct(d.score)} on −1…+1), ${d.confidence.level.toLowerCase()} confidence; components: ${d.comps.filter((c) => c.score !== null).map((c) => `${c.name.toLowerCase()} ${c.word.toLowerCase()}`).join(', ')}.`, top && top.s > 0.15 ? `Strongest support: ${top.name} — ${top.disp}.` : null, low && low.s < -0.15 ? `Main offset: ${low.name} — ${low.disp}.` : null].filter(Boolean) };
  };
  const ch = (c, l) => (c?.domains ? `${l}: ${c.label.toLowerCase()} (${c.stateThen} → ${c.stateNow}; grade ${c.gradeThen} → ${c.gradeNow}). ${c.text}` : `${l}: ${c?.text || 'not enough history'}`);
  return {
    date: I.asOf,
    sections: [
      { title: 'Executive market read', lines: [`${I.assessment?.label ? I.assessment.label + ' — ' : ''}${I.state}. Fair Grade ${I.grade.value}/100. ${I.breadth.n} of ${I.breadth.of} domains supportive; ${I.confidence.level.toLowerCase()} confidence.`, ...(I.narrative?.[0] ? [I.narrative[0].replace(/<\/?b>/g, '')] : [])] },
      { title: 'Key drivers', lines: I.drivers.slice(0, 5).map((f) => `${f.name} (${f.strengthWord.toLowerCase()}, ${f.horizon} term, ${f.persistence >= 30 ? '30+' : f.persistence} days): ${f.text}`) },
      { title: 'Key offsets', lines: I.offsets.slice(0, 5).map((f) => `${f.name} (${f.strengthWord.toLowerCase()}, ${f.horizon} term): ${f.text}`) },
      dom('tech', 'Technical'), dom('chain', 'On-Chain'), dom('mkt', 'Market Structure'), dom('sent', 'Sentiment'), dom('macro', 'Macro & Liquidity'),
      { title: 'Market regime', lines: I.regime ? [`${I.regime.label} (${I.regime.confidence.toLowerCase()} confidence). ${I.regime.why}`] : [] },
      { title: 'Valuation', lines: I.valuation ? [`${I.valuation.state}. ${I.valuation.context}`, I.valuation.evidence.map((e) => `${e.name} ${e.disp} (${e.zone})`).join(' · ')] : [] },
      { title: 'What changed', lines: [ch(I.changes.d2, '2 days'), ch(I.changes.d7, '7 days'), ch(I.changes.d30, '30 days')] },
      { title: 'Important charts', lines: [], note: 'Planned: price with trend envelope, domain reads over time, Fair Grade history and the key indicator charts from the Analysis pages.' },
      { title: 'Data & methodology notes', lines: [`Risk regime ${I.risk.level.toLowerCase()} (${I.risk.points} stress points). ${a?.quality ? `${a.quality.filter((q) => q.status === 'ok').length} of ${a.quality.length} daily sources fresh.` : ''}`, 'Free public data only; sources and dates on every Analysis page. Not investment advice; no price targets or probabilities.'] },
    ],
    notes: 'One source of truth: the same engine output feeds the Dashboard, Analysis, Intelligence and this report.',
  };
}
