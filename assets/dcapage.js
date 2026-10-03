// DCA backtest page (#dca). Backtests a regular purchase plan on real daily closes
// (Coin Metrics, data/pi_cycle.json), values it at the live price, compares it with a
// lump sum and a hindsight-best day, shows how every past window of the same length
// turned out, and offers a clearly labelled constant-price illustration going forward.
import { backtest, rollingWindows, forwardAtConstantPrice } from '../engine/dca.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = (v) => v !== null && v !== undefined && Number.isFinite(+v);
const num = (v, d = 0) => (ok(v) ? (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const usd = (v, d) => (ok(v) ? `${v < 0 ? '−' : ''}$${num(Math.abs(v), d ?? (Math.abs(v) >= 100 || Number.isInteger(+v) ? 0 : 2))}` : '—');
const usdK = (v) => (v >= 1e9 ? `$${+(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${+(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${+(v / 1e3).toFixed(0)}K` : v >= 1000 ? `$${+(v / 1e3).toFixed(1)}K` : `$${Math.round(v)}`);
const pct = (v, d = 1) => (ok(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%` : '—');
const cls = (v) => (!ok(v) || v === 0 ? '' : v > 0 ? 'up' : 'down');
const btcS = (b) => `${b.toFixed(b >= 1 ? 4 : 6)} BTC`;
const sats = (b) => `${num(Math.round(b * 1e8))} sats`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dL = (d) => (d ? `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}` : '—');
const DAY = 864e5;

const AMOUNTS = [10, 25, 50, 100, 500];
const FREQS = [['week', 'Weekly'], ['2weeks', 'Every 2 weeks'], ['month', 'Monthly'], ['day', 'Daily']];
const RANGES = [[1, '1Y'], [2, '2Y'], [3, '3Y'], [4, '4Y'], [5, '5Y'], [10, '10Y'], [0, 'All']];
const FEES = [0, 0.1, 0.5, 1, 1.5];
const STORE = 'btcintel-dca';
const D = { amount: 100, every: 'week', years: 4, start: null, end: null, fee: 0, fwd: 5, showAll: false };
try { Object.assign(D, JSON.parse(localStorage.getItem(STORE) || '{}'), { showAll: false }); } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ amount: D.amount, every: D.every, years: D.years, start: D.start, end: D.end, fee: D.fee, fwd: D.fwd })); } catch {} };

let ctx = { pi: null, live: () => null, info: () => '' }, last = null, rollCache = new Map();
const closes = () => (ctx.pi?.rows || []).map((r) => [r[0], r[1]]);
function range(cl) {
  const end = D.end && D.end <= cl.at(-1)[0] ? D.end : cl.at(-1)[0];
  if (D.start) return { start: D.start < cl[0][0] ? cl[0][0] : D.start, end, custom: true };
  if (!D.years) return { start: cl[0][0], end };
  return { start: new Date(Date.parse(end) - Math.round(D.years * 365.25) * DAY).toISOString().slice(0, 10), end };
}

export function dcaPageHtml({ pi, info }) {
  ctx.pi = pi; ctx.info = (k) => info(k).s;
  const chip = (attr, v, label, on) => `<button type="button" ${attr}="${v}" aria-pressed="${on}">${label}</button>`;
  return `<section class="dcap">
    <div class="dcap-head"><div><h1>DCA backtest${ctx.info('d_dca')}</h1><p>What a regular Bitcoin purchase plan would have done, bought at real daily closing prices and valued at today’s live price. History, not a forecast.</p></div><p class="dcap-live" id="dcp-live"></p></div>
    <div class="dcard dcap-ctl">
      <div class="dcap-row"><span class="k">Amount</span><div class="seg">${AMOUNTS.map((a) => chip('data-damt', a, `$${a}`, D.amount === a)).join('')}</div><label class="dcap-in">$<input type="text" inputmode="decimal" id="dcp-amt" value="${D.amount}" aria-label="Custom amount in USD"></label></div>
      <div class="dcap-row"><span class="k">Every</span><div class="seg">${FREQS.map(([v, l]) => chip('data-dfreq', v, l, D.every === v)).join('')}</div></div>
      <div class="dcap-row"><span class="k">Period</span><div class="seg">${RANGES.map(([v, l]) => chip('data-dyears', v, l, !D.start && D.years === v)).join('')}</div>
        <label class="dcap-in date"><span>from</span><input type="date" id="dcp-start" min="2010-07-18" value="${D.start || ''}"></label><label class="dcap-in date"><span>to</span><input type="date" id="dcp-end" min="2010-07-18" value="${D.end || ''}"></label></div>
      <div class="dcap-row"><span class="k">Fee per buy</span><div class="seg">${FEES.map((f) => chip('data-dfee', f, `${f}%`, D.fee === f)).join('')}</div><span class="dim small">Exchange fees reduce the bitcoin each purchase buys.</span></div>
    </div>
    <div id="dcp-body"></div>
  </section>`;
}

export function mountDcaPage({ pi, getLive }) {
  ctx.pi = pi; ctx.live = getLive;
  const root = document.querySelector('.dcap'); if (!root || root.dataset.wired) return paintDca();
  root.dataset.wired = '1';
  const press = (sel, fn) => root.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => { fn(b); root.querySelectorAll(sel).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); save(); paintDca(); }));
  press('[data-damt]', (b) => { D.amount = +b.dataset.damt; root.querySelector('#dcp-amt').value = D.amount; });
  press('[data-dfreq]', (b) => { D.every = b.dataset.dfreq; });
  press('[data-dyears]', (b) => { D.years = +b.dataset.dyears; D.start = null; D.end = null; root.querySelector('#dcp-start').value = ''; root.querySelector('#dcp-end').value = ''; });
  press('[data-dfee]', (b) => { D.fee = +b.dataset.dfee; });
  root.querySelector('#dcp-amt').addEventListener('input', (e) => { const v = +String(e.target.value).replace(/[^0-9.]/g, ''); if (v > 0) { D.amount = v; root.querySelectorAll('[data-damt]').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.damt === v))); save(); paintDca(); } });
  const dates = () => { D.start = root.querySelector('#dcp-start').value || null; D.end = root.querySelector('#dcp-end').value || null; root.querySelectorAll('[data-dyears]').forEach((x) => x.setAttribute('aria-pressed', String(!D.start && +x.dataset.dyears === D.years))); save(); paintDca(); };
  root.querySelector('#dcp-start').addEventListener('change', dates); root.querySelector('#dcp-end').addEventListener('change', dates);
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-dfwd]'); if (f) { D.fwd = +f.dataset.dfwd; save(); paintForward(); return; }
    if (e.target.closest('#dcp-all')) { D.showAll = !D.showAll; paintTable(); return; }
    if (e.target.closest('#dcp-csv')) downloadCsv();
  });
  paintDca();
}

// re-value with the live price (cheap: reuses the last backtest's holdings)
let liveT = 0;
export function dcaLive() { if (!last || Date.now() - liveT < 5000 || !document.querySelector('.dcap')?.offsetParent) return; liveT = Date.now(); paintDca(); }

export function paintDca() {
  const body = document.getElementById('dcp-body'); if (!body) return;
  const cl = closes();
  if (cl.length < 400) { body.innerHTML = '<p class="muted">Price history is not available yet.</p>'; return; }
  const L = ctx.live(), r = range(cl);
  const res = backtest(cl, { amount: D.amount, every: D.every, start: r.start, end: r.end, feePct: D.fee }, L?.price && r.end === cl.at(-1)[0] ? L.price : null);
  if (!res) { body.innerHTML = '<p class="muted">No purchases fall in this period. Pick a longer range.</p>'; return; }
  last = res;
  const lv = document.getElementById('dcp-live');
  if (lv) lv.innerHTML = res.priceIsLive ? `<i class="fd ok"></i>Valued at the live price ${usd(res.price)} · ${esc(L.source)}` : `<i class="fd stale"></i>Valued at the ${dL(res.end)} close ${usd(res.price)}${r.end !== cl.at(-1)[0] ? ' (end of the chosen period)' : ' (live price not available)'}`;
  const yrs = (Date.parse(res.end) - Date.parse(res.start)) / (365.25 * DAY);
  const freqWord = { week: 'week', '2weeks': '2 weeks', month: 'month', day: 'day' }[D.every];
  const tile = (k, v, s, c = '') => `<div class="dkcard"><div class="mc-h"><span class="mc-l">${k}</span></div><div class="mc-v num ${c}">${v}</div><div class="mc-s">${s || ''}</div></div>`;
  const lumpD = res.lump.value - res.value, hindD = res.hindsight.value - res.value;
  body.innerHTML = `
    <p class="dcap-sum">Buying <b>${usd(D.amount)}</b> of bitcoin every ${freqWord} from <b>${dL(res.start)}</b> to <b>${dL(res.end)}</b> (${yrs.toFixed(1)} years, ${num(res.n)} purchases${D.fee ? `, ${D.fee}% fee each` : ''}) would have turned <b>${usd(res.invested)}</b> into <b class="${cls(res.pnl)}">${usd(res.value)}</b>.</p>
    <div class="dkcards dcap-score">
      ${tile('Total invested', usd(res.invested), `${num(res.n)} purchases of ${usd(D.amount)}`)}
      ${tile('Bitcoin accumulated', btcS(res.btc), sats(res.btc))}
      ${tile('Average cost basis', usd(res.avgCost), `per BTC · ${num(1e8 / res.avgCost)} sats per $1 on average`)}
      ${tile('Value today', usd(res.value), `at ${usd(res.price)} per BTC`)}
      ${tile('Profit / loss', `${res.pnl >= 0 ? '+' : '−'}${usd(Math.abs(res.pnl))}`, `<span class="${cls(res.pnlPct)}">${pct(res.pnlPct)}</span> on money put in`, cls(res.pnl))}
      ${tile('Annualised return (XIRR)', ok(res.xirr) ? pct(res.xirr * 100) : '—', 'money-weighted: accounts for when each dollar went in', cls(res.xirr))}
      ${tile('Max drawdown', `−${res.maxDrawdown.toFixed(1)}%`, `largest fall in portfolio value from a peak${res.maxDrawdownAt ? ` (low on ${dL(res.maxDrawdownAt)})` : ''}`, 'down')}
      ${tile('Deepest underwater', res.worstUnderwater < 0 ? pct(res.worstUnderwater) : 'never', res.worstUnderwater < 0 ? `value vs money put in, on ${dL(res.worstUnderwaterAt)}` : 'value never fell below the money put in', res.worstUnderwater < 0 ? 'down' : 'up')}
    </div>
    <div class="dcard dcap-chart"><div class="dc-h"><h2>Money in vs value</h2><span class="dcap-leg"><span><i class="li"></i>Money put in</span><span><i class="lv"></i>Portfolio value</span><span><i class="lp"></i>BTC price (right axis)</span></span></div><div id="dcp-chart"></div></div>
    <div class="dcap-two">
      <div class="dcard dcap-cmp"><div class="dc-h"><h2>Same money, other ways${ctx.info('d_dcacmp')}</h2></div>
        ${cmpRow('DCA (this plan)', res.value, res.btc, res.pnlPct, `average cost ${usd(res.avgCost)}`, res)}
        ${cmpRow('Lump sum on day one', res.lump.value, res.lump.btc, res.lump.pnlPct, `all ${usd(res.invested)} on ${dL(res.lump.date)} at ${usd(res.lump.price)}`, res)}
        ${cmpRow('Best single day (hindsight)', res.hindsight.value, res.hindsight.btc, res.hindsight.pnlPct, `all at the period’s lowest close, ${usd(res.hindsight.price)} on ${dL(res.hindsight.date)} — impossible to know in advance`, res, true)}
        <p class="dcap-note">${lumpD > 0 ? `Here a lump sum would have ended ${usd(lumpD)} ahead, because price rose over the period and the lump sum was invested longer. ` : lumpD < 0 ? `Here DCA ended ${usd(-lumpD)} ahead of a lump sum, because buying over time picked up cheaper prices after the start. ` : ''}DCA trades some of that potential for smoother entry and less dependence on a single day.</p>
      </div>
      <div class="dcard dcap-roll" id="dcp-roll"></div>
    </div>
    <div class="dcap-two">
      <div class="dcard dcap-fwd" id="dcp-fwd"></div>
      <div class="dcard dcap-tbl" id="dcp-tbl"></div>
    </div>
    <p class="dcap-foot">Purchases are simulated at each scheduled day’s daily close (Coin Metrics Community data, UTC); real fills, spreads and timing differ. Fees are applied as a percentage of each purchase. XIRR treats today’s value as if sold now. Past performance says nothing about future returns. Illustration only — not a recommendation to buy or sell.</p>`;
  drawChart(document.getElementById('dcp-chart'), res);
  paintRolling(cl, yrs);
  paintForward(); paintTable();
}
function cmpRow(label, value, btc, p, sub, res, hind) {
  const max = Math.max(res.value, res.lump.value, res.hindsight.value);
  return `<div class="cmp-row${hind ? ' hind' : ''}"><div class="cmp-l"><b>${label}</b><span class="dim">${sub}</span></div><div class="cmp-bar"><i style="width:${((value / max) * 100).toFixed(1)}%"></i></div><div class="cmp-v num"><b>${usd(value)}</b><span class="${cls(p)}">${pct(p)}</span><span class="dim">${btcS(btc)}</span></div></div>`;
}

function paintRolling(cl, yrs) {
  const el = document.getElementById('dcp-roll'); if (!el) return;
  const y = Math.max(1, Math.round(yrs));
  const key = `${y}|${D.every}|${cl.length}`;
  let R = rollCache.get(key);
  if (R === undefined) { R = y <= 12 ? rollingWindows(cl, { years: y, every: D.every === 'day' ? 'week' : D.every, step: 7 }) : null; rollCache.set(key, R); }
  if (!R) { el.innerHTML = `<div class="dc-h"><h2>Every ${y}-year window in history${ctx.info('d_dcaroll')}</h2></div><p class="muted small">This period is too long to compare against other start dates.</p>`; return; }
  const hist = histogram(R.points.map((p) => p[1]));
  el.innerHTML = `<div class="dc-h"><h2>Every ${y}-year window in history${ctx.info('d_dcaroll')}</h2></div>
    <p class="roll-big"><b class="num">${(R.profitable * 100).toFixed(0)}%</b> of ${num(R.n)} ${y}-year ${D.every === 'month' ? 'monthly' : D.every === '2weeks' ? 'every-2-weeks' : 'weekly'} DCA plans started between ${dL(R.from)} and ${dL(R.to)} ended in profit.</p>
    ${hist}
    <div class="roll-stats"><span>Median <b class="${cls(R.median)}">${pct(R.median * 100, 0)}</b></span><span>Middle 80% <b>${pct(R.p10 * 100, 0)} to ${pct(R.p90 * 100, 0)}</b></span><span>Worst start <b class="${cls(R.worst[1])}">${dL(R.worst[0])} (${pct(R.worst[1] * 100, 0)})</b></span><span>Best start <b class="up">${dL(R.best[0])} (${pct(R.best[1] * 100, 0)})</b></span></div>
    <p class="dim small">Each window buys on the same schedule for ${y} year${y === 1 ? '' : 's'} and is valued at its own final close. Early years had far smaller, more volatile markets; history is not a guide to what comes next.</p>`;
}
function histogram(vals) {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  // bins in log space of the value multiple, so −50% and +100% sit symmetrically
  const lv = vals.map((v) => Math.log(1 + v)), a = Math.log(1 + lo), b = Math.log(1 + hi), n = 28, bins = new Array(n).fill(0);
  for (const x of lv) bins[Math.min(n - 1, Math.floor(((x - a) / (b - a || 1)) * n))]++;
  const m = Math.max(...bins), W = 300, H = 60, bw = W / n, zero = ((0 - a) / (b - a || 1)) * W;
  // labels are HTML below the bars: text inside a non-uniformly stretched SVG would distort
  return `<svg class="roll-h" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Distribution of outcomes across start dates">${bins.map((c, i) => { const x0 = Math.exp(a + (i / n) * (b - a)) - 1; const hh = (c / m) * H; return `<rect class="${x0 >= 0 ? 'pos' : 'neg'}" x="${(i * bw + 0.5).toFixed(1)}" y="${(H - hh).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${hh.toFixed(1)}"><title>${c} windows</title></rect>`; }).join('')}${zero > 0 && zero < W ? `<line x1="${zero.toFixed(1)}" x2="${zero.toFixed(1)}" y1="0" y2="${H}"/>` : ''}</svg><div class="roll-ax"><span>${pct(lo * 100, 0)}</span>${zero > 0 && zero < W ? `<span style="left:${((zero / W) * 100).toFixed(1)}%">break-even</span>` : ''}<span>${pct(hi * 100, 0)}</span></div><p class="dim small roll-key">Bars: number of start dates by final gain or loss (log scale of the value multiple); red = ended below the money put in.</p>`;
}

function paintForward() {
  const el = document.getElementById('dcp-fwd'); if (!el || !last) return;
  const F = forwardAtConstantPrice({ amount: D.amount, every: D.every, years: D.fwd, price: last.price, feePct: D.fee });
  el.innerHTML = `<div class="dc-h"><h2>If you keep this pace${ctx.info('d_dcafwd')}</h2><div class="seg">${[1, 2, 5, 10].map((y) => `<button type="button" data-dfwd="${y}" aria-pressed="${D.fwd === y}">${y}Y</button>`).join('')}</div></div>
    <p class="fwd-tag">Hypothetical · one constant price (${usd(last.price)}) · not a forecast</p>
    <div class="fwd-grid"><div><span class="k">Another ${D.fwd} year${D.fwd === 1 ? '' : 's'}</span><b class="num">${num(F.purchases)} purchases · ${usd(F.invested)}</b></div><div><span class="k">Would add</span><b class="num">${btcS(F.btc)}</b><span class="dim">${sats(F.btc)}</span></div><div><span class="k">Holding in total</span><b class="num">${btcS(last.btc + F.btc)}</b><span class="dim">${sats(last.btc + F.btc)}</span></div></div>
    <p class="dim small">Real future purchases will happen at whatever the price is at the time — higher prices buy fewer sats, lower prices more. This shows quantities only, never a future value.</p>`;
}

function paintTable() {
  const el = document.getElementById('dcp-tbl'); if (!el || !last) return;
  const rows = [...last.purchases].reverse(), show = D.showAll ? rows : rows.slice(0, 12);
  el.innerHTML = `<div class="dc-h"><h2>Purchases</h2><button type="button" class="linkbtn" id="dcp-csv">Download CSV</button></div>
    <div class="dcap-twrap"><table class="pmt"><thead><tr><th>Date</th><th class="r">Price</th><th class="r">Bought</th><th class="r">Total BTC</th><th class="r">Invested</th></tr></thead><tbody>${show.map(([d, p, b, t, inv]) => `<tr><td>${dL(d)}</td><td class="r num">${usd(p)}</td><td class="r num">${num(Math.round(b * 1e8))} sats</td><td class="r num">${t.toFixed(6)}</td><td class="r num">${usd(inv)}</td></tr>`).join('')}</tbody></table></div>
    ${rows.length > 12 ? `<button type="button" class="linkbtn" id="dcp-all">${D.showAll ? 'Show latest 12' : `Show all ${num(rows.length)}`}</button>` : ''}`;
}
function downloadCsv() {
  if (!last) return;
  const lines = ['date,price_usd,amount_usd,fee_pct,btc_bought,sats_bought,total_btc,total_invested_usd'].concat(last.purchases.map(([d, p, b, t, inv]) => [d, p.toFixed(2), D.amount, D.fee, b.toFixed(8), Math.round(b * 1e8), t.toFixed(8), inv.toFixed(2)].join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
  a.download = `btcintel-dca-${last.start}-to-${last.end}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// chart: money in (step) and portfolio value (area) on the left axis; BTC price faded on a log right axis
function drawChart(host, res) {
  if (!host) return;
  const W = Math.max(300, Math.round(host.clientWidth || 800)), mobile = innerWidth < 768, H = mobile ? 240 : Math.round(Math.max(300, Math.min(460, innerHeight * 0.42)));
  const PAD = { l: mobile ? 50 : 62, r: mobile ? 46 : 58, t: 12, b: 26 };
  const s = res.series, step = Math.max(1, Math.floor(s.length / (W - PAD.l - PAD.r)));
  const pts = s.filter((_, i) => i % step === 0 || i === s.length - 1);
  const x0 = Date.parse(pts[0][0]), x1 = Date.parse(pts.at(-1)[0]);
  const X = (d) => PAD.l + ((Date.parse(d) - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const vmax = Math.max(...pts.map((p) => Math.max(p[1], p[2]))) * 1.06;
  const Y = (v) => PAD.t + (1 - v / vmax) * (H - PAD.t - PAD.b);
  const plo = Math.min(...pts.map((p) => p[3])) / 1.1, phi = Math.max(...pts.map((p) => p[3])) * 1.1, LP = Math.log10;
  const YP = (v) => PAD.t + (1 - (LP(v) - LP(plo)) / (LP(phi) - LP(plo))) * (H - PAD.t - PAD.b);
  const s0 = vmax / 4, mag = 10 ** Math.floor(Math.log10(s0)), st = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= s0);
  const ticks = []; for (let v = 0; v <= vmax; v += st) ticks.push(v);
  const pticks = []; for (let e = Math.floor(LP(plo)); e <= Math.ceil(LP(phi)); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= plo && v <= phi) pticks.push(v); }
  const yrs = (x1 - x0) / (365.25 * DAY), xl = [];
  if (yrs > 2.5) { for (let y = new Date(x0).getUTCFullYear() + 1; y <= new Date(x1).getUTCFullYear(); y++) xl.push([`${y}-01-01`, String(y)]); }
  else { const d = new Date(x0); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); while (d.getTime() < x1) { const every = yrs > 1.2 ? 3 : yrs > 0.6 ? 2 : 1; if (d.getUTCMonth() % every === 0) xl.push([d.toISOString().slice(0, 10), `${MON[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? ' ' + d.getUTCFullYear() : ''}`]); d.setUTCMonth(d.getUTCMonth() + 1); } }
  while (xl.length > (mobile ? 5 : 12)) for (let i = xl.length - 2; i > 0; i -= 2) xl.splice(i, 1);
  const path = (k, yf) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${yf(p[k]).toFixed(1)}`).join('');
  const inv = pts.map((p, i) => (i ? `H${X(p[0]).toFixed(1)}V${Y(p[1]).toFixed(1)}` : `M${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`)).join('');
  const base = H - PAD.b;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Money put in and portfolio value over time">
    ${ticks.map((v) => `<line class="g" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${PAD.l - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${usdK(v)}</text>`).join('')}
    ${pticks.map((v) => `<text class="ax axp" x="${W - PAD.r + 6}" y="${(YP(v) + 3.5).toFixed(1)}">${usdK(v)}</text>`).join('')}
    ${xl.map(([d, l]) => `<text class="ax" x="${X(d).toFixed(1)}" y="${H - 8}" text-anchor="middle">${l}</text>`).join('')}
    <path class="dp-price" d="${path(3, YP)}"/>
    <path class="dp-area" d="${path(2, Y)}L${X(pts.at(-1)[0]).toFixed(1)},${base}L${X(pts[0][0]).toFixed(1)},${base}Z"/>
    <path class="dp-value" d="${path(2, Y)}"/><path class="dp-inv" d="${inv}"/>
    <line class="xh" y1="${PAD.t}" y2="${base}" style="display:none"/>
  </svg><div class="pi-tip" hidden></div>`;
  const svg = host.querySelector('svg'), tip = host.querySelector('.pi-tip'), xh = svg.querySelector('.xh');
  const show = (cx) => {
    const r = svg.getBoundingClientRect(), x = ((cx - r.left) / r.width) * W;
    let b = pts[0]; for (const p of pts) if (Math.abs(X(p[0]) - x) < Math.abs(X(b[0]) - x)) b = p;
    const px = X(b[0]); xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.style.display = '';
    const g = b[2] / (b[1] || 1) - 1;
    tip.innerHTML = `<b>${dL(b[0])}</b><span>Money in <em>${usd(b[1])}</em></span><span class="v">Value <em>${usd(b[2])}</em></span><span>Gain <em class="${cls(g)}">${pct(g * 100)}</em></span><span>BTC price <em>${usd(b[3])}</em></span>`;
    tip.hidden = false; const tw = tip.offsetWidth, hx = (px / W) * r.width;
    tip.style.left = Math.max(4, Math.min(hx + 12, r.width - tw - 4)) + 'px'; tip.style.top = '8px';
  };
  svg.addEventListener('pointermove', (e) => show(e.clientX)); svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { tip.hidden = true; xh.style.display = 'none'; } });
}
export function redrawDcaChart() { if (last) drawChart(document.getElementById('dcp-chart'), last); }
