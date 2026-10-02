// Live BTC price for the page headers. Polls public tickers in order of
// preference and falls back when one fails; never invents a value. If every
// source fails, the caller keeps the last good value and marks it stale.

const SOURCES = [
  { // true USD, with a 24h open for the 24h change
    name: 'Coinbase', every: 10e3,
    url: 'https://api.exchange.coinbase.com/products/BTC-USD/stats',
    parse: (j) => { const last = +j.last, open = +j.open; return { price: last, ch24: open ? (last / open - 1) * 100 : null, high: +j.high, low: +j.low, volBtc: +j.volume }; },
  },
  { // quoted in USDT, which trades within a few basis points of USD
    name: 'Binance', every: 10e3, note: 'quoted in USDT (≈ USD)',
    url: 'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT',
    parse: (j) => ({ price: +j.lastPrice, ch24: +j.priceChangePercent, high: +j.highPrice, low: +j.lowPrice, volBtc: +j.volume }),
  },
  { // free tier allows ~30 calls a minute, so never faster than every 30 s
    name: 'CoinGecko', every: 30e3,
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
    parse: (j) => ({ price: +j.bitcoin.usd, ch24: j.bitcoin.usd_24h_change ?? null }),
  },
  {
    name: 'Kraken', every: 10e3,
    url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
    parse: (j) => { const r = Object.values(j.result || {})[0]; return { price: +r.c[0], ch24: null }; },
  },
];
const TIMEOUT = 4000, FAILS_TO_SKIP = 3, SKIP_MS = 5 * 60e3, STALE_MS = 60e3, TICK = 10e3;

export function startLivePrice({ onPrice, onState }) {
  const health = new Map(SOURCES.map((s) => [s.name, { fails: 0, skipUntil: 0, lastAt: 0 }]));
  let last = null, timer = null, stopped = false;

  async function fetchFrom(s) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(s.url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const v = s.parse(await r.json());
      if (!(v.price > 1000 && v.price < 1e7)) throw new Error('implausible price');
      return v;
    } finally { clearTimeout(t); }
  }
  async function tick() {
    const now = Date.now();
    for (const s of SOURCES) {
      const h = health.get(s.name);
      if (now < h.skipUntil || now - h.lastAt < s.every - 500) continue;
      h.lastAt = now;
      try {
        const v = await fetchFrom(s);
        h.fails = 0;
        last = { ...v, source: s.name, note: s.note || null, at: Date.now() };
        onPrice(last);
        onState('live', last);
        return;
      } catch {
        if (++h.fails >= FAILS_TO_SKIP) { h.skipUntil = now + SKIP_MS; h.fails = 0; }
      }
    }
    onState(last && Date.now() - last.at < STALE_MS ? 'live' : 'stale', last);
  }
  function schedule() { clearTimeout(timer); if (!stopped && !document.hidden) timer = setTimeout(async () => { await tick(); schedule(); }, TICK); }
  const onVis = () => { if (document.hidden) clearTimeout(timer); else tick().then(schedule); };
  document.addEventListener('visibilitychange', onVis);
  tick().then(schedule);
  return { stop() { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); }, get last() { return last; } };
}
