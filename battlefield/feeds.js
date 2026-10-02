// Live market feeds for the Battlefield. Runs in the browser and in Node 22
// (global WebSocket). Every adapter normalises venue messages into one event
// vocabulary, so the renderer cannot tell live data from a recorded replay:
//
//   { type: 'trade',   t, venue, px, usd, side: 'buy'|'sell' }      taker side
//   { type: 'liq',     t, venue, px, usd, side: 'long'|'short' }    position that was liquidated
//   { type: 'ticker',  t, venue, last, ch24, vol24Usd }
//   { type: 'funding', t, venue, rate8h }
//   { type: 'oi',      t, venue, usd }
//   { type: 'status',  venue, state: 'connecting'|'live'|'error'|'closed', note }
//
// Order books are kept in memory per venue; aggregateBook() produces the
// bucketed, cross-venue view the renderer draws.

const now = () => Date.now();
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

export class BookSet {
  constructor() { this.venues = new Map(); }
  side(venue, s) {
    if (!this.venues.has(venue)) this.venues.set(venue, { bids: new Map(), asks: new Map(), t: 0 });
    return this.venues.get(venue)[s];
  }
  clear(venue) { this.venues.set(venue, { bids: new Map(), asks: new Map(), t: now() }); }
  set(venue, s, px, qty) {
    const m = this.side(venue, s);
    if (!(qty > 0)) m.delete(px); else m.set(px, qty);
    this.venues.get(venue).t = now();
  }
  trim(venue, keep) {
    const v = this.venues.get(venue);
    if (!v) return;
    for (const [s, desc] of [['bids', true], ['asks', false]]) {
      if (v[s].size <= keep) continue;
      const ks = [...v[s].keys()].sort((a, b) => (desc ? b - a : a - b));
      for (const k of ks.slice(keep)) v[s].delete(k);
    }
  }
  live(maxAgeMs = 30000) { return [...this.venues].filter(([, v]) => now() - v.t <= maxAgeMs && v.bids.size && v.asks.size).map(([k]) => k); }
  best(venue) {
    const v = this.venues.get(venue);
    if (!v || !v.bids.size || !v.asks.size) return null;
    let bb = -Infinity, ba = Infinity;
    for (const p of v.bids.keys()) if (p > bb) bb = p;
    for (const p of v.asks.keys()) if (p < ba) ba = p;
    return bb < ba ? { bid: bb, ask: ba, mid: (bb + ba) / 2 } : null;
  }
  // Median of venue mids = robust aggregated front line.
  // `only` (optional Set of venue names) restricts both to the selected source.
  mid(maxAgeMs = 30000, only = null) {
    const mids = [];
    for (const [venue, v] of this.venues) {
      if (only && !only.has(venue)) continue;
      if (now() - v.t > maxAgeMs) continue;
      const b = this.best(venue);
      if (b) mids.push(b.mid);
    }
    if (!mids.length) return null;
    mids.sort((a, b) => a - b);
    return mids[Math.floor(mids.length / 2)];
  }
  // USD liquidity per price bucket within ±rangePct of mid, summed across venues.
  aggregate(mid, rangePct, bucketUsd, maxAgeMs = 30000, only = null) {
    const lo = mid * (1 - rangePct / 100), hi = mid * (1 + rangePct / 100);
    const bids = new Map(), asks = new Map();
    const venues = [];
    for (const [venue, v] of this.venues) {
      if (only && !only.has(venue)) continue;
      if (now() - v.t > maxAgeMs) continue;
      venues.push(venue);
      for (const [p, q] of v.bids) if (p >= lo && p <= mid) { const k = Math.floor(p / bucketUsd) * bucketUsd; bids.set(k, (bids.get(k) || 0) + p * q); }
      for (const [p, q] of v.asks) if (p <= hi && p >= mid) { const k = Math.floor(p / bucketUsd) * bucketUsd; asks.set(k, (asks.get(k) || 0) + p * q); }
    }
    return {
      mid, bucketUsd, venues,
      bids: [...bids.entries()].sort((a, b) => b[0] - a[0]),
      asks: [...asks.entries()].sort((a, b) => a[0] - b[0]),
    };
  }
}

let debugHook = null;
export function setDebug(fn) { debugHook = fn; }

function socket(url, { onOpen, onMessage, venue, emit, pingMs, ping, silentMs }) {
  let ws, timer, watch, closed = false, retry = 0, gotData = false;
  const open = () => {
    emit({ type: 'status', venue, state: 'connecting' });
    try { ws = new WebSocket(url); } catch (e) { emit({ type: 'status', venue, state: 'error', note: String(e.message || e) }); return schedule(); }
    ws.onopen = () => {
      retry = 0; gotData = false;
      emit({ type: 'status', venue, state: 'connected', note: 'connected, waiting for data' });
      onOpen(ws);
      if (pingMs) timer = setInterval(() => { try { ws.send(ping); } catch {} }, pingMs);
      clearTimeout(watch);
      watch = setTimeout(() => { if (!gotData) emit({ type: 'status', venue, state: 'silent', note: 'connected but no data received — likely a regional restriction' }); }, silentMs || 60000);
    };
    ws.onmessage = (m) => { if (m.data === 'pong') return; let j; try { j = JSON.parse(m.data); } catch { return; } if (debugHook) debugHook(venue, j); if (!gotData) { gotData = true; emit({ type: 'status', venue, state: 'live' }); } try { onMessage(j, ws); } catch (e) { if (debugHook) debugHook(venue, { parseError: String(e) }); } };
    ws.onerror = () => emit({ type: 'status', venue, state: 'error', note: 'connection error (blocked, or venue unavailable in this region)' });
    ws.onclose = () => { clearInterval(timer); clearTimeout(watch); if (!closed) { emit({ type: 'status', venue, state: 'closed' }); schedule(); } };
  };
  const schedule = () => { if (closed) return; retry++; setTimeout(open, Math.min(30000, 1500 * 2 ** retry)); };
  open();
  return () => { closed = true; clearInterval(timer); clearTimeout(watch); try { ws.close(); } catch {} };
}

// ---- Coinbase Advanced Trade (spot BTC-USD): level2 book, trades, 24h ticker
function coinbase(books, emit) {
  return socket('wss://advanced-trade-ws.coinbase.com', {
    venue: 'Coinbase', emit,
    onOpen: (ws) => {
      for (const channel of ['level2', 'market_trades', 'ticker', 'heartbeats']) ws.send(JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD'], channel }));
    },
    onMessage: (j) => {
      if (j.channel === 'l2_data') {
        for (const ev of j.events || []) {
          if (ev.type === 'snapshot') books.clear('Coinbase');
          for (const u of ev.updates || []) books.set('Coinbase', u.side === 'bid' ? 'bids' : 'asks', num(u.price_level), num(u.new_quantity));
        }
      } else if (j.channel === 'market_trades') {
        const b = books.best('Coinbase');
        for (const ev of j.events || []) {
          if (ev.type !== 'update') continue;
          for (const tr of ev.trades || []) {
            const px = num(tr.price), q = num(tr.size);
            // Aggressor inferred from execution vs the book (at/above mid = buyer lifted the offer).
            const side = b ? (px >= b.mid ? 'buy' : 'sell') : (tr.side === 'SELL' ? 'buy' : 'sell');
            emit({ type: 'trade', t: Date.parse(tr.time) || now(), venue: 'Coinbase', px, usd: px * q, side });
          }
        }
      } else if (j.channel === 'ticker') {
        for (const ev of j.events || []) for (const tk of ev.tickers || []) {
          const last = num(tk.price);
          emit({ type: 'ticker', t: now(), venue: 'Coinbase', last, ch24: num(tk.price_percent_chg_24_h), vol24Usd: num(tk.volume_24_h) * last });
        }
      }
    },
  });
}

// ---- Kraken v2 (spot BTC/USD): 1000-level book, trades, ticker
function kraken(books, emit) {
  return socket('wss://ws.kraken.com/v2', {
    venue: 'Kraken', emit, pingMs: 20000, ping: JSON.stringify({ method: 'ping' }),
    onOpen: (ws) => {
      ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'book', symbol: ['BTC/USD'], depth: 1000 } }));
      ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'trade', symbol: ['BTC/USD'] } }));
      ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ticker', symbol: ['BTC/USD'] } }));
    },
    onMessage: (j) => {
      if (j.channel === 'book') {
        for (const d of j.data || []) {
          if (j.type === 'snapshot') books.clear('Kraken');
          for (const l of d.bids || []) books.set('Kraken', 'bids', num(l.price), num(l.qty));
          for (const l of d.asks || []) books.set('Kraken', 'asks', num(l.price), num(l.qty));
        }
        books.trim('Kraken', 1000);
      } else if (j.channel === 'trade') {
        for (const d of j.data || []) { const px = num(d.price); emit({ type: 'trade', t: Date.parse(d.timestamp) || now(), venue: 'Kraken', px, usd: px * num(d.qty), side: d.side === 'buy' ? 'buy' : 'sell' }); }
      } else if (j.channel === 'ticker') {
        for (const d of j.data || []) { const last = num(d.last); emit({ type: 'ticker', t: now(), venue: 'Kraken', last, ch24: num(d.change_pct), vol24Usd: num(d.volume) * last }); }
      }
    },
  });
}

// ---- OKX public: spot book + trades, perp trades, all-SWAP liquidations, funding, OI
const OKX_CT = { 'BTC-USDT-SWAP': { btc: 0.01 }, 'BTC-USD-SWAP': { usd: 100 } };
function okx(books, emit) {
  return socket('wss://ws.okx.com:8443/ws/v5/public', {
    venue: 'OKX', emit, pingMs: 20000, ping: 'ping',
    onOpen: (ws) => ws.send(JSON.stringify({ op: 'subscribe', args: [
      { channel: 'books', instId: 'BTC-USDT' },
      { channel: 'trades', instId: 'BTC-USDT' },
      { channel: 'trades', instId: 'BTC-USDT-SWAP' },
      { channel: 'liquidation-orders', instType: 'SWAP' },
      { channel: 'funding-rate', instId: 'BTC-USDT-SWAP' },
      { channel: 'open-interest', instId: 'BTC-USDT-SWAP' },
      { channel: 'tickers', instId: 'BTC-USDT' },
    ] })),
    onMessage: (j) => {
      const ch = j.arg?.channel;
      if (!ch || !j.data) return;
      if (ch === 'books') {
        for (const d of j.data) {
          if (j.action === 'snapshot') books.clear('OKX');
          for (const [p, s] of d.bids || []) books.set('OKX', 'bids', num(p), num(s));
          for (const [p, s] of d.asks || []) books.set('OKX', 'asks', num(p), num(s));
        }
      } else if (ch === 'trades') {
        for (const d of j.data) {
          const px = num(d.px), sz = num(d.sz);
          const usd = d.instId === 'BTC-USDT-SWAP' ? px * sz * 0.01 : px * sz;
          emit({ type: 'trade', t: num(d.ts) || now(), venue: d.instId === 'BTC-USDT-SWAP' ? 'OKX perp' : 'OKX', px, usd, side: d.side === 'buy' ? 'buy' : 'sell', perp: d.instId.endsWith('SWAP') });
        }
      } else if (ch === 'liquidation-orders') {
        for (const d of j.data) {
          const ct = OKX_CT[d.instId];
          if (!ct) continue;
          for (const x of d.details || []) {
            const px = num(x.bkPx), sz = num(x.sz);
            const usd = ct.btc ? px * sz * ct.btc : sz * ct.usd;
            const long = x.posSide === 'long' || (x.posSide !== 'short' && x.side === 'sell');
            emit({ type: 'liq', t: num(x.ts) || now(), venue: 'OKX', px, usd, side: long ? 'long' : 'short' });
          }
        }
      } else if (ch === 'funding-rate') {
        for (const d of j.data) emit({ type: 'funding', t: now(), venue: 'OKX', rate8h: num(d.fundingRate) });
      } else if (ch === 'open-interest') {
        for (const d of j.data) { const mid = books.mid(); const usd = num(d.oiUsd) ?? (mid && num(d.oiCcy) ? num(d.oiCcy) * mid : null); if (usd) emit({ type: 'oi', t: num(d.ts) || now(), venue: 'OKX BTC-USDT perp', usd }); }
      } else if (ch === 'tickers') {
        for (const d of j.data) { const last = num(d.last), open = num(d.open24h); emit({ type: 'ticker', t: now(), venue: 'OKX', last, ch24: open ? ((last - open) / open) * 100 : null, vol24Usd: num(d.volCcy24h) }); }
      }
    },
  });
}

// ---- Binance: spot trades (data-stream mirror works from most regions);
//      USDⓈ-M liquidations (blocked in some regions — reported as unavailable)
function binanceSpot(books, emit) {
  return socket('wss://data-stream.binance.vision/ws/btcusdt@aggTrade', {
    venue: 'Binance', emit,
    onOpen: () => {},
    onMessage: (j) => { if (j.e === 'aggTrade') { const px = num(j.p); emit({ type: 'trade', t: j.T, venue: 'Binance', px, usd: px * num(j.q), side: j.m ? 'sell' : 'buy' }); } },
  });
}
function binanceLiqs(books, emit) {
  // All-market stream (every symbol, several per second in normal conditions) so
  // silence can be told apart from "no BTC liquidations"; filtered to BTC perps.
  return socket('wss://fstream.binance.com/ws/!forceOrder@arr', {
    venue: 'Binance futures', emit, silentMs: 45000,
    onOpen: () => {},
    onMessage: (j) => {
      const o = j.o; if (!o || !/^BTCUSD/.test(o.s)) return;
      const px = num(o.ap) || num(o.p);
      emit({ type: 'liq', t: o.T || now(), venue: 'Binance', px, usd: px * num(o.z || o.q), side: o.S === 'SELL' ? 'long' : 'short' });
    },
  });
}

// ---- Deribit BTC-PERPETUAL: trades carry a `liquidation` flag (T = taker side
//      liquidated, M = maker side, MT = both). Amount is USD (inverse contract).
function deribit(books, emit) {
  return socket('wss://www.deribit.com/ws/api/v2', {
    venue: 'Deribit', emit, pingMs: 25000, ping: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'public/test', params: {} }),
    onOpen: (ws) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'public/subscribe', params: { channels: ['trades.BTC-PERPETUAL.100ms'] } })),
    onMessage: (j) => {
      const data = j.params?.data;
      if (j.method !== 'subscription' || !Array.isArray(data)) return;
      for (const d of data) {
        const px = num(d.price), usd = num(d.amount);
        if (!px || !usd) continue;
        const side = d.direction === 'buy' ? 'buy' : 'sell';
        if (d.liquidation) {
          // taker liquidated: a forced sell (direction sell) closes a long; maker liquidated: the resting side was the forced one
          const takerLiq = d.liquidation.includes('T');
          const long = takerLiq ? side === 'sell' : side === 'buy';
          emit({ type: 'liq', t: d.timestamp || now(), venue: 'Deribit', px, usd, side: long ? 'long' : 'short' });
        }
        emit({ type: 'trade', t: d.timestamp || now(), venue: 'Deribit perp', px, usd, side, perp: true });
      }
    },
  });
}

export const VENUES = ['Coinbase', 'Kraken', 'OKX', 'Binance', 'Binance futures', 'Deribit'];

export function connectLive(emit, opts = {}) {
  const books = new BookSet();
  const stops = [coinbase, kraken, okx, binanceSpot, binanceLiqs, deribit].filter((f) => !opts.skip?.includes(f.name)).map((f) => f(books, emit));
  return { books, stop: () => stops.forEach((s) => s()) };
}
