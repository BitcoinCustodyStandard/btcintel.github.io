// Large moves, streamed in the browser from free public WebSockets:
//   trades ≥ $1M        Coinbase (BTC-USD), Binance (BTC-USDT), Kraken (BTC/USD)
//   liquidations ≥ $100K OKX and Bybit (BTC perpetuals); Binance futures best effort
//   on-chain ≥ 500 BTC  blockchain.info unconfirmed-transaction stream
// Only events seen while this page is open (kept in this browser for 24 h) are shown;
// nothing is back-filled or estimated. Each feed reconnects with backoff.

export const MIN_TRADE = 1e6, MIN_LIQ = 1e5, MIN_TX_BTC = 500;
const KEEP_MS = 24 * 3600e3, MAX = 150, STORE = 'btcintel-moves';

function load() {
  try { const a = JSON.parse(localStorage.getItem(STORE) || '[]'); return a.filter((m) => Date.now() - m.t < KEEP_MS); } catch { return []; }
}
function save(list) { try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, MAX))); } catch {} }

// handlers return an event { kind, t, usd, btc, side, venue, note, link } or null
const FEEDS = [
  {
    venue: 'Coinbase', kind: 'trade', url: 'wss://ws-feed.exchange.coinbase.com',
    sub: { type: 'subscribe', product_ids: ['BTC-USD'], channels: ['matches'] },
    on: (j) => {
      if (j.type !== 'match') return null;
      const btc = +j.size, px = +j.price, usd = btc * px;
      // Coinbase reports the maker's side; the aggressor (taker) is the opposite
      return usd >= MIN_TRADE ? { kind: 'trade', t: Date.parse(j.time) || Date.now(), usd, btc, px, side: j.side === 'sell' ? 'buy' : 'sell' } : null;
    },
  },
  {
    venue: 'Binance', kind: 'trade', url: 'wss://data-stream.binance.vision/ws/btcusdt@aggTrade', note: 'USDT pair',
    on: (j) => { const btc = +j.q, px = +j.p, usd = btc * px; return usd >= MIN_TRADE ? { kind: 'trade', t: j.T, usd, btc, px, side: j.m ? 'sell' : 'buy' } : null; },
  },
  {
    venue: 'Kraken', kind: 'trade', url: 'wss://ws.kraken.com/v2',
    sub: { method: 'subscribe', params: { channel: 'trade', symbol: ['BTC/USD'] } },
    on: (j) => {
      if (j.channel !== 'trade' || !Array.isArray(j.data)) return null;
      const out = j.data.map((d) => ({ kind: 'trade', t: Date.parse(d.timestamp), usd: d.qty * d.price, btc: +d.qty, px: +d.price, side: d.side })).filter((e) => e.usd >= MIN_TRADE);
      return out.length ? out : null;
    },
  },
  {
    venue: 'OKX', kind: 'liq', url: 'wss://ws.okx.com:8443/ws/v5/public',
    sub: { op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] },
    on: (j) => {
      const out = [];
      for (const d of j.data || []) {
        if (d.instFamily !== 'BTC-USDT' && d.instFamily !== 'BTC-USD') continue;
        for (const x of d.details || []) {
          const px = +x.bkPx, sz = +x.sz;
          // contract size: BTC-USDT-SWAP = 0.01 BTC; BTC-USD-SWAP = $100
          const usd = d.instFamily === 'BTC-USDT' ? sz * 0.01 * px : sz * 100;
          if (usd >= MIN_LIQ) out.push({ kind: 'liq', t: +x.ts, usd, btc: usd / px, px, side: x.posSide === 'short' || (x.posSide === 'net' && x.side === 'buy') ? 'short' : 'long' });
        }
      }
      return out.length ? out : null;
    },
  },
  {
    venue: 'Bybit', kind: 'liq', url: 'wss://stream.bybit.com/v5/public/linear', ping: { op: 'ping' },
    sub: { op: 'subscribe', args: ['allLiquidation.BTCUSDT'] },
    on: (j) => {
      if (!String(j.topic || '').startsWith('allLiquidation')) return null;
      // S = "Buy" means a long position was liquidated
      const out = (j.data || []).map((d) => ({ kind: 'liq', t: +d.T, usd: d.v * d.p, btc: +d.v, px: +d.p, side: d.S === 'Buy' ? 'long' : 'short' })).filter((e) => e.usd >= MIN_LIQ);
      return out.length ? out : null;
    },
  },
  {
    venue: 'Binance', kind: 'liq', url: 'wss://fstream.binance.com/ws/btcusdt@forceOrder', bestEffort: true,
    on: (j) => { const o = j.o; if (!o) return null; const usd = o.q * o.ap; return usd >= MIN_LIQ ? { kind: 'liq', t: o.T, usd, btc: +o.q, px: +o.ap, side: o.S === 'SELL' ? 'long' : 'short' } : null; },
  },
  {
    venue: 'On-chain', kind: 'tx', url: 'wss://ws.blockchain.info/inv', sub: { op: 'unconfirmed_sub' }, ping: { op: 'ping' },
    on: (j) => {
      if (j.op !== 'utx') return null;
      const sats = (j.x.out || []).reduce((s, o) => s + (o.value || 0), 0), btc = sats / 1e8;
      return btc >= MIN_TX_BTC ? { kind: 'tx', t: (j.x.time || Date.now() / 1000) * 1000, btc, outs: j.x.out.length, ins: j.x.inputs?.length ?? null, hash: j.x.hash } : null;
    },
  },
];

export function startMoves({ onEvent, onStatus, priceNow }) {
  const list = load(), status = {}, sockets = [];
  let stopped = false;
  const add = (venue, e) => {
    const ev = { ...e, venue, id: `${venue}-${e.kind}-${e.hash || e.t + '-' + Math.round(e.usd)}` };
    if (ev.kind === 'tx' && priceNow()) ev.usd = ev.btc * priceNow();
    if (list.some((x) => x.id === ev.id)) return;
    list.unshift(ev); list.sort((a, b) => b.t - a.t); list.length = Math.min(list.length, MAX);
    save(list); onEvent(list, ev);
  };
  FEEDS.forEach((f, i) => {
    let tries = 0, pingT = null;
    const key = `${f.venue}-${f.kind}`;
    const open = () => {
      if (stopped) return;
      let ws;
      try { ws = new WebSocket(f.url); } catch { status[key] = 'down'; onStatus(status); return; }
      sockets[i] = ws;
      ws.onopen = () => { tries = 0; status[key] = 'live'; onStatus(status); if (f.sub) ws.send(JSON.stringify(f.sub)); if (f.ping) pingT = setInterval(() => { try { ws.send(JSON.stringify(f.ping)); } catch {} }, 20e3); };
      ws.onmessage = (m) => { let j; try { j = JSON.parse(m.data); } catch { return; } const r = f.on(j); if (r) [].concat(r).forEach((e) => add(f.venue, e)); };
      ws.onclose = () => { clearInterval(pingT); status[key] = f.bestEffort && tries > 1 ? 'unavailable' : 'reconnecting'; onStatus(status); if (!stopped && tries < 8) setTimeout(open, Math.min(60e3, 2000 * 2 ** tries++)); else if (!stopped) { status[key] = 'down'; onStatus(status); } };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };
    status[key] = 'connecting';
    open();
  });
  onStatus(status);
  onEvent(list, null);
  return { stop() { stopped = true; sockets.forEach((s) => { try { s.close(); } catch {} }); }, list };
}
