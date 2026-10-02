// Battle-state model: turns order-book snapshots, trades and liquidations into
// armies, walls, routs, set pieces and range victories. Pure and deterministic
// (no clock, no randomness): the same inputs always give the same output, so a
// replay plays out identically and every rule can be tested in Node.
//
// Rules are the ones published in the design spec and the page legend.

export const RULES = {
  BAND: 50,                       // $ per formation band
  WALL_MULT: 4, WALL_MIN: 2e6,    // wall = band >= 4x median band and >= $2M
  STONE_WALL: 10e6,               // stone wall section
  WALL_GONE: 0.5,                 // a wall "falls" when its band loses half its size
  WALL_HIT_SHARE: 0.3,            // ...and is "hit" if trades at that price took >= 30% of the drop
  ROUT_DROP: 0.3, ROUT_WINDOW: 60e3, ROUT_RECOVER: 0.85,
  VOLLEY_MIN: 5e3, SURGE: 50e3,   // < $50k/s volley, $50k..big surge, >= big cavalry
  LIQ_TIERS: [50e3, 150e3, 500e3, 2e6],
  LIQ_MERGE_MS: 2000,
  RANGE_STEP: 500, RANGE_HOLD_MS: 60e3,
  HISTORY_MS: 15 * 60e3,
};

// Soldiers in a band: 12 x log2(1 + USD / $250k) → $250k 12, $1M 28, $4M 49, $16M 72.
export const soldiersFor = (usd) => (usd > 0 ? Math.round(12 * Math.log2(1 + usd / 250e3)) : 0);
export const liqTier = (usd) => RULES.LIQ_TIERS.reduce((t, x, i) => (usd >= x ? i + 1 : t), 0);

// Bucketed book ([[price, usd], ...]) → $50 bands per side, nearest first.
export function toBands(book, band = RULES.BAND) {
  const g = (arr) => { const m = new Map(); for (const [p, u] of arr || []) { const k = Math.floor(p / band) * band; m.set(k, (m.get(k) || 0) + u); } return m; };
  const b = g(book?.bids), a = g(book?.asks);
  return {
    bids: [...b.entries()].sort((x, y) => y[0] - x[0]).map(([p, usd]) => ({ p, usd, n: soldiersFor(usd) })),
    asks: [...a.entries()].sort((x, y) => x[0] - y[0]).map(([p, usd]) => ({ p, usd, n: soldiersFor(usd) })),
  };
}
const median = (xs) => { const v = xs.filter((x) => x > 0).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
export function markWalls(bands) {
  const med = median([...bands.bids, ...bands.asks].map((x) => x.usd));
  for (const side of ['bids', 'asks']) for (const x of bands[side]) {
    x.wall = x.usd >= RULES.WALL_MULT * med && x.usd >= RULES.WALL_MIN ? (x.usd >= RULES.STONE_WALL ? 'stone' : 'palisade') : null;
    x.mult = med ? x.usd / med : null;
  }
  return med;
}
const within = (bands, mid, pct) => bands.filter((x) => Math.abs(x.p + RULES.BAND / 2 - mid) / mid <= pct / 100).reduce((s, x) => s + x.usd, 0);

export class Battle {
  constructor(opts = {}) {
    this.big = opts.bigTrade ?? 250e3;
    this.rangeStep = opts.rangeStep ?? RULES.RANGE_STEP;
    this.rangeHold = opts.rangeHoldMs ?? RULES.RANGE_HOLD_MS;
    this.reset();
  }
  reset() {
    this.out = [];
    this.bands = { bids: [], asks: [] };
    this.mid = null; this.t = 0;
    this.prevWalls = new Map();        // key side|price → {usd, t}
    this.recentTrades = [];            // [{t, px, usd}] last 30 s, for wall-hit attribution
    this.pendTrade = { buy: null, sell: null };
    this.pendLiq = { long: null, short: null };
    this.depth = { bull: [], bear: [] }; // 1 Hz ±1% depth samples
    this.rout = { bull: null, bear: null };
    this.zone = null; this.cand = null;
    this.history = { snaps: [], events: [] };
    this.lastSnapAt = 0;
  }
  emit(e) { this.out.push(e); this.history.events.push(e); }
  drain() { const o = this.out; this.out = []; return o; }

  // ---- order-book snapshot (call every 250 ms with the selected source's book)
  book(t, book, mid) {
    if (!book || !mid) return;
    this.t = t; this.mid = mid;
    const bands = toBands(book);
    this.median = markWalls(bands);
    this.bands = bands;
    this.flush(t);
    // Only judge walls when the same venues are reporting; a venue dropping out is not a withdrawal.
    const vk = (book.venues || []).join(',') || String(book.venues?.length ?? '');
    if (vk !== this.venueKey) { this.venueKey = vk; this.prevWalls = new Map(); }
    this.cover = { lo: bands.bids.at(-1)?.p ?? mid, hi: (bands.asks.at(-1)?.p ?? mid) + RULES.BAND };
    this.checkWalls(t, bands, mid);
    this.checkRout(t, bands, mid);
    this.checkRange(t, mid);
    if (t - this.lastSnapAt >= 1000) {
      this.lastSnapAt = t;
      this.history.snaps.push({ t, mid, bids: bands.bids.map((x) => [x.p, Math.round(x.usd)]), asks: bands.asks.map((x) => [x.p, Math.round(x.usd)]) });
      const cut = t - RULES.HISTORY_MS;
      while (this.history.snaps.length && this.history.snaps[0].t < cut) this.history.snaps.shift();
      while (this.history.events.length && this.history.events[0].t < cut) this.history.events.shift();
    }
  }

  checkWalls(t, bands, mid) {
    const now = new Map();
    for (const [side, arr] of [['bid', bands.bids], ['ask', bands.asks]]) for (const x of arr) if (x.wall) now.set(`${side}|${x.p}`, { usd: x.usd, t, side, p: x.p, kind: x.wall });
    const usdAt = (side, p) => (side === 'bid' ? bands.bids : bands.asks).find((x) => x.p === p)?.usd ?? 0;
    const margin = 2 * RULES.BAND, verdicts = [];
    for (const [k, w] of this.prevWalls) {
      if (now.has(k)) continue;
      // a wall that slid out of the captured window is not judged
      if (w.p < this.cover.lo + margin || w.p + RULES.BAND > this.cover.hi - margin) continue;
      const cur = usdAt(w.side, w.p);
      if (cur > w.usd * (1 - RULES.WALL_GONE)) { now.set(k, { ...w, usd: Math.max(cur, w.usd) }); continue; } // still mostly there
      const drop = w.usd - cur;
      const traded = this.recentTrades.filter((x) => x.t >= w.t - 1000 && x.px >= w.p && x.px < w.p + RULES.BAND).reduce((s, x) => s + x.usd, 0);
      const crossed = w.side === 'bid' ? mid < w.p : mid >= w.p + RULES.BAND;
      const hit = crossed || traded >= RULES.WALL_HIT_SHARE * drop;
      verdicts.push({ kind: hit ? 'wall-hit' : 'wall-pulled', t, side: w.side === 'bid' ? 'bull' : 'bear', price: w.p, usd: w.usd, traded, badge: 'Observed' });
    }
    // Walls on BOTH sides vanishing in one snapshot without trades looks like a venue feed
    // resync, not two traders cancelling at once: no "withdrawn" verdicts for that snapshot.
    const pulled = verdicts.filter((v) => v.kind === 'wall-pulled');
    const resync = pulled.some((v) => v.side === 'bull') && pulled.some((v) => v.side === 'bear');
    for (const v of verdicts) if (!(resync && v.kind === 'wall-pulled')) this.emit(v);
    // remember walls (keeping the first-seen time for trade attribution)
    const next = new Map();
    for (const [k, w] of now) next.set(k, this.prevWalls.has(k) ? { ...w, t: this.prevWalls.get(k).t } : w);
    this.prevWalls = next;
  }

  checkRout(t, bands, mid) {
    for (const [side, arr] of [['bull', bands.bids], ['bear', bands.asks]]) {
      const d = within(arr, mid, 1);
      const S = this.depth[side];
      if (!S.length || t - S.at(-1).t >= 1000) S.push({ t, d });
      while (S.length && t - S[0].t > RULES.ROUT_WINDOW) S.shift();
      const peak = Math.max(...S.map((x) => x.d));
      const r = this.rout[side];
      if (!r && peak > 0 && S.length >= 5 && d < peak * (1 - RULES.ROUT_DROP)) {
        this.rout[side] = { t, peak, d };
        this.emit({ kind: 'rout', t, side, depth: d, peak, drop: 1 - d / peak, badge: 'Observed' });
      } else if (r && d >= r.peak * RULES.ROUT_RECOVER) {
        this.rout[side] = null;
        this.emit({ kind: 'rally', t, side, depth: d, badge: 'Observed' });
      }
    }
  }

  // A side wins the range when mid crosses a marker and stays beyond it for the hold time.
  checkRange(t, mid) {
    const step = this.rangeStep, z = Math.floor(mid / step);
    if (this.zone === null) { this.zone = z; return; }
    if (!this.cand) {
      if (z !== this.zone) this.cand = { up: z > this.zone, marker: (z > this.zone ? this.zone + 1 : this.zone) * step, since: t };
      return;
    }
    const beyond = this.cand.up ? mid >= this.cand.marker : mid < this.cand.marker;
    if (!beyond) { this.cand = null; return; }
    if (t - this.cand.since >= this.rangeHold) {
      this.emit({ kind: 'range-won', t, side: this.cand.up ? 'bull' : 'bear', marker: this.cand.marker, holdMs: t - this.cand.since, badge: 'Observed' });
      this.zone = z; this.cand = null;
    }
  }

  // ---- trades: grouped per side per second so one sweeping order reads as one charge
  trade(e) {
    if (!(e.usd > 0)) return;
    this.recentTrades.push({ t: e.t, px: e.px, usd: e.usd });
    while (this.recentTrades.length && e.t - this.recentTrades[0].t > 30e3) this.recentTrades.shift();
    const sec = Math.floor(e.t / 1000), p = this.pendTrade[e.side];
    if (p && p.sec !== sec) this.closeTrade(e.side);
    const q = this.pendTrade[e.side] || (this.pendTrade[e.side] = { sec, usd: 0, pxw: 0, venues: new Set(), n: 0 });
    q.usd += e.usd; q.pxw += (e.px || 0) * e.usd; q.n++; if (e.venue) q.venues.add(e.venue);
  }
  closeTrade(side) {
    const q = this.pendTrade[side];
    this.pendTrade[side] = null;
    if (!q || q.usd < RULES.VOLLEY_MIN) return;
    const kind = q.usd >= this.big ? 'charge' : q.usd >= RULES.SURGE ? 'surge' : 'volley';
    this.emit({ kind, t: q.sec * 1000, side: side === 'buy' ? 'bull' : 'bear', usd: q.usd, px: q.pxw / q.usd, fills: q.n, venues: [...q.venues], badge: 'Observed' });
  }

  // ---- liquidations: merged per side within 2 s, tiered by the total
  liq(e) {
    if (!(e.usd > 0)) return;
    const p = this.pendLiq[e.side];
    if (p && e.t - p.t0 > RULES.LIQ_MERGE_MS) this.closeLiq(e.side);
    const q = this.pendLiq[e.side] || (this.pendLiq[e.side] = { t0: e.t, usd: 0, pxw: 0, count: 0, venues: new Set() });
    q.usd += e.usd; q.pxw += e.px * e.usd; q.count++; q.venues.add(e.venue);
  }
  closeLiq(side) {
    const q = this.pendLiq[side];
    this.pendLiq[side] = null;
    if (!q) return;
    // a long liquidation is forced selling: bulls fall; a short one is forced buying: bears fall
    this.emit({ kind: 'liq', t: q.t0, side: side === 'long' ? 'bull' : 'bear', liqSide: side, usd: q.usd, px: q.pxw / q.usd, count: q.count, venues: [...q.venues], tier: liqTier(q.usd), badge: 'Sampled' });
  }

  // close any group whose window has passed (call each frame or snapshot)
  flush(t) {
    for (const s of ['buy', 'sell']) { const q = this.pendTrade[s]; if (q && t - q.sec * 1000 > 1200) this.closeTrade(s); }
    for (const s of ['long', 'short']) { const q = this.pendLiq[s]; if (q && t - q.t0 > RULES.LIQ_MERGE_MS) this.closeLiq(s); }
  }

  // HUD summary
  summary() {
    const mid = this.mid, B = this.bands;
    if (!mid) return null;
    const bid1 = within(B.bids, mid, 1), ask1 = within(B.asks, mid, 1);
    return { mid, bid1, ask1, imbalance: (bid1 - ask1) / ((bid1 + ask1) || 1), routBull: !!this.rout.bull, routBear: !!this.rout.bear, range: this.cand ? { ...this.cand, heldMs: this.t - this.cand.since, needMs: this.rangeHold } : null };
  }
}
