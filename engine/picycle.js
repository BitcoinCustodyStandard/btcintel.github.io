// Pi Cycle Top indicator (Philip Swift), computed from daily closes:
//   111DMA(d)    = mean of the 111 daily closes up to and including d
//   350DMA×2(d)  = 2 × mean of the 350 daily closes up to and including d
//   gap(d)       = (350DMA×2 − 111DMA) ÷ 350DMA×2
//   cross        = first day 111DMA ≥ 350DMA×2 after a day below it
// A line is only defined once its full window exists (no partial averages).

const r = (v) => (v === null ? null : Number(v.toPrecision(7)));

export function computePiCycle(closes) {
  const rows = [], crosses = [];
  let s111 = 0, s350 = 0, prevBelow = null;
  for (let i = 0; i < closes.length; i++) {
    const [d, c] = closes[i];
    s111 += c; s350 += c;
    if (i >= 111) s111 -= closes[i - 111][1];
    if (i >= 350) s350 -= closes[i - 350][1];
    const ma111 = i >= 110 ? s111 / 111 : null;
    const ma350x2 = i >= 349 ? (2 * s350) / 350 : null;
    if (ma111 !== null && ma350x2 !== null) {
      const below = ma111 < ma350x2;
      if (prevBelow === true && !below) crosses.push({ date: d, close: r(c), ma111: r(ma111), ma350x2: r(ma350x2) });
      prevBelow = below;
    }
    rows.push([d, r(c), r(ma111), r(ma350x2)]);
  }
  const last = rows.at(-1);
  const latest = last && last[2] !== null && last[3] !== null ? { date: last[0], close: last[1], ma111: last[2], ma350x2: last[3], gap: (last[3] - last[2]) / last[3] } : null;
  return { rows, crosses, latest };
}

// Presentation zones for the status line (published on the page; not part of the indicator's definition).
export function piZone(gap) {
  if (gap === null || gap === undefined) return null;
  if (gap <= 0) return { key: 'crossed', label: 'Crossed — historically near cycle tops' };
  if (gap < 0.05) return { key: 'close', label: 'Close to a cross' };
  if (gap < 0.2) return { key: 'approaching', label: 'Approaching' };
  return { key: 'far', label: 'Not in signal zone' };
}
