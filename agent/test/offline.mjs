#!/usr/bin/env node
// Offline end-to-end test. Builds a SYNTHETIC snapshot with the same shape the
// live collectors produce, then runs the full pipeline into a temp directory.
// Synthetic data is for testing only and is never written to the site's data/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isoDate, DAY } from '../../engine/util.js';
import { simulateImpact, parseFarside, parseFredCsv } from '../../engine/collect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());

export function syntheticSnapshot(dayOffset = 0) {
  const now = Date.now() + dayOffset * DAY;
  const days = 400;
  const ph = [];
  let p = 95000;
  for (let i = days; i >= 0; i--) {
    p *= Math.exp(gauss() * 0.028 - (i > 240 && i < 260 ? 0.02 : 0));
    ph.push([isoDate(now - i * DAY), p, 3e10 * (0.7 + rnd()), p * 19.9e6]);
  }
  const spot = ph.at(-1)[1];
  const book = (venue, pair, scale) => {
    const bids = [], asks = [];
    for (let k = 1; k < 600; k++) {
      bids.push([spot * (1 - k * 0.00005), scale * (0.2 + rnd())]);
      asks.push([spot * (1 + k * 0.00005), scale * (0.2 + rnd())]);
    }
    const mid = spot;
    const bands = {};
    for (const b of [0.5, 1, 2]) {
      const lo = mid * (1 - b / 100), hi = mid * (1 + b / 100);
      bands[b] = { bidUsd: bids.filter(([x]) => x >= lo).reduce((s, [x, q]) => s + x * q, 0), askUsd: asks.filter(([x]) => x <= hi).reduce((s, [x, q]) => s + x * q, 0), bidTruncated: false, askTruncated: false };
    }
    return { venue, pair, mid: venue === 'Coinbase' ? spot * 1.0004 : spot, spreadBps: 0.2, bands, deepestBidPct: 3, deepestAskPct: 3, levels: { bids, asks } };
  };
  const venues = [book('Binance', 'BTC-USDT', 3), book('Coinbase', 'BTC-USD', 2), book('OKX', 'BTC-USDT', 1.5), book('Kraken', 'XBT/USD', 0.6), book('Bitstamp', 'BTC/USD', 0.4)];
  const etfDaily = [];
  for (let i = 300; i >= 1; i--) {
    const d = new Date(now - i * DAY);
    if ([0, 6].includes(d.getUTCDay())) continue;
    const t = Math.round((gauss() * 250 + (i < 10 ? 180 : 0)) * 10) / 10;
    etfDaily.push({ date: isoDate(d), totalUsdM: t, funds: { IBIT: t * 0.6, FBTC: t * 0.25, GBTC: t * 0.15 } });
  }
  const series = (base, vol, n = 400, step = 1) => { const out = []; let v = base; for (let i = n; i >= 0; i -= step) { v += gauss() * vol; out.push([isoDate(now - i * DAY), v]); } return out; };
  const strikes = [];
  for (let k = 50000; k <= 160000; k += 5000) {
    strikes.push({ strike: k, callOi: k > spot ? 800 * rnd() + (k % 10000 === 0 ? 1500 : 0) : 200 * rnd(), putOi: k < spot ? 900 * rnd() : 150 * rnd(), gammaUsd: 2e6 * Math.exp(-(((k - spot) / 8000) ** 2)), nearGammaUsd: 1.5e6 * Math.exp(-(((k - spot) / 6000) ** 2)) });
  }
  const exp = (dd) => isoDate(now + dd * DAY);
  const ok = (name, freq) => ({ name, status: 'ok', fetchedAt: new Date(now).toISOString(), asOf: new Date(now).toISOString(), frequency: freq || 'snapshot' });
  const snap = {
    collectedAt: new Date(now).toISOString(), scope: 'server',
    sources: { coingecko: ok('CoinGecko'), coingecko_hist: ok('CoinGecko (daily history)'), farside: ok('Farside'), fred: ok('FRED'), yahoo: ok('Yahoo'), deribit_opt: ok('Deribit options'), okx_deriv: ok('OKX'), okx_rubik: ok('OKX Rubik'), book_binance: ok('Binance book'), coinmetrics: ok('Coin Metrics'), defillama_stables: ok('DefiLlama'), mempool: ok('mempool.space'), bgeometrics: ok('BGeometrics'), binance_deriv: { name: 'Binance futures', status: 'error', error: 'HTTP 451 (geo-blocked)' } },
    price: { spot, change24h: (spot / ph.at(-2)[1] - 1) * 100, change7d: (spot / ph.at(-8)[1] - 1) * 100, change30d: (spot / ph.at(-31)[1] - 1) * 100, marketCap: spot * 19.93e6, volume24h: 3.2e10, circulatingSupply: 19.93e6, ath: 126000, athDate: '2025-10-06' },
    priceHistory: ph.slice(-366),
    global: { btcDominance: 58.2, totalMcap: 3.1e12 },
    breadth: { coins: [{ id: 'bitcoin', ch7d: 2, ch30d: 5 }, ...Array.from({ length: 40 }, (_, i) => ({ id: 'alt' + i, ch7d: gauss() * 6, ch30d: gauss() * 12 }))] },
    books: { venues, impact: simulateImpact(venues) },
    derivs: {
      venues: [{ venue: 'OKX', oiUsd: 4.1e9, funding8h: 0.00008 }, { venue: 'Deribit', oiUsd: 1.6e9, funding8h: 0.00005 }, { venue: 'BitMEX', oiUsd: 0.4e9, funding8h: 0.0001 }, { venue: 'Hyperliquid', oiUsd: 3.2e9, funding8h: 0.00011 }],
      okxOiHistory: Array.from({ length: 120 }, (_, i) => [isoDate(now - (119 - i) * DAY), 3.5e9 + i * 5e6 + gauss() * 1e8, 2e10]),
      okxFundingHistory: Array.from({ length: 300 }, (_, i) => [now - (299 - i) * 8 * 3600e3, 0.00006 + gauss() * 0.00004]),
      okxLongShort: Array.from({ length: 30 }, (_, i) => [isoDate(now - (29 - i) * DAY), 1 + gauss() * 0.2]),
      takerContracts: Array.from({ length: 30 }, (_, i) => [isoDate(now - (29 - i) * DAY), 5e9 * (1 + gauss() * 0.1), 5e9]),
      takerSpot: Array.from({ length: 30 }, (_, i) => [isoDate(now - (29 - i) * DAY), 1e9 * (1 + gauss() * 0.1), 1e9]),
      curve: [{ instrument: 'BTC-X1', expiry: exp(7), days: 7, basisAnnPct: 5.1 }, { instrument: 'BTC-X2', expiry: exp(35), days: 35, basisAnnPct: 6.2 }, { instrument: 'BTC-X3', expiry: exp(90), days: 90, basisAnnPct: 6.8 }],
      cot: { contractBtc: 5, rows: Array.from({ length: 8 }, (_, i) => ({ date: isoDate(now - (7 - i) * 7 * DAY), oiContracts: 28000 + i * 300, levLong: 9000, levShort: 21000 + i * 200, amLong: 14000, amShort: 2000, dealerLong: 1000, dealerShort: 800 })) },
    },
    liquidations: { venue: 'OKX BTC-USDT-SWAP', count: 100, longUsd: 3.2e6, shortUsd: 1.1e6, largestUsd: 4e5, from: new Date(now - 3 * 3600e3).toISOString(), to: new Date(now).toISOString() },
    options: {
      underlying: spot, callOi: 250000, putOi: 160000, pcRatio: 0.64, notionalUsd: 410000 * spot, atmIv30: 44, skew25_30: -2.1, ref30Expiry: exp(30),
      expiries: [{ expiry: exp(2), days: 2, callOi: 20000, putOi: 15000, notionalUsd: 35000 * spot, maxPain: Math.round(spot / 5000) * 5000, atmIv: 41, skew25: -1, topStrikes: [{ strike: 100000, oi: 4000 }] }, { expiry: exp(30), days: 30, callOi: 80000, putOi: 50000, notionalUsd: 130000 * spot, maxPain: 90000, atmIv: 44, skew25: -2.1, topStrikes: [{ strike: 120000, oi: 9000 }] }],
      byStrike: strikes,
      dvolHistory: series(48, 1.2, 400),
    },
    etf: { daily: etfDaily },
    macro: {
      fred: {
        WALCL: { points: series(6600, 8, 400, 7) }, WTREGEN: { points: series(820, 20, 400, 7) }, RRPONTSYD: { points: series(30, 3, 400) },
        DFF: { points: series(3.6, 0.002) }, DGS2: { points: series(3.5, 0.03) }, DGS10: { points: series(4.1, 0.03) }, DFII10: { points: series(1.8, 0.02) }, T10YIE: { points: series(2.3, 0.01) }, BAMLH0A0HYM2: { points: series(3.0, 0.03) },
      },
      markets: { NDX: series(22000, 180), SPX: series(6400, 40), GOLD: series(3600, 25), SILVER: series(42, 0.5), DXY: series(98, 0.3), VIX: series(17, 0.8), TNX: series(4.1, 0.03) },
    },
    onchain: { coinmetrics: { series: { CapMVRVCur: series(1.9, 0.02), CapRealUSD: series(1.0e12, 1e9), SplyCur: series(19.9e6, 50), HashRate: series(9.5e8, 1e7), RevUSD: series(4.5e7, 1e6), IssTotNtv: series(450, 2), PriceUSD: series(60000, 400) }, unavailable: ['FlowInExNtv', 'FlowOutExNtv', 'SplyExNtv'] }, mempool: { hashrateEhs: 950, nextAdjPct: 1.8 }, stablecoins: series(2.9e11, 4e8), bgeo: { fetchedAt: new Date().toISOString(), sopr: series(1.0, 0.01).slice(-60, -7), soprDelayed: true, supplyProfit: series(1.5e7, 1e5).slice(-60, -2) } },
  };
  return snap;
}

// --- unit checks on parsers
const farsideHtml = `<table><tr><th></th><th>IBIT</th><th>FBTC</th><th>Total</th></tr>
<tr><td>05 Feb 2026</td><td>(120.5)</td><td>30.0</td><td>(90.5)</td></tr>
<tr><td>06 Feb 2026</td><td>-</td><td>12.1</td><td>12.1</td></tr><tr><td>Total</td><td>1</td><td>2</td><td>3</td></tr></table>`;
const fs1 = parseFarside(farsideHtml);
if (fs1.length !== 2 || fs1[0].totalUsdM !== -90.5 || fs1[0].funds.IBIT !== -120.5 || fs1[1].funds.IBIT !== 0) throw new Error('parseFarside failed: ' + JSON.stringify(fs1));
// Two-row header (names row, then tickers row without "Total"), blank pending day
const farside2 = `<table><tr><th></th><th>Blackrock</th><th>Fidelity</th><th>Total</th></tr><tr><th></th><th>IBIT</th><th>FBTC</th><th></th></tr>
<tr><td>29 Sep 2026</td><td>500.1</td><td>(20.0)</td><td>480.1</td></tr><tr><td>30 Sep 2026</td><td>-</td><td>-</td><td></td></tr></table>`;
const fs2 = parseFarside(farside2);
if (fs2.length !== 1 || fs2[0].totalUsdM !== 480.1 || fs2[0].funds.FBTC !== -20) throw new Error('parseFarside two-row failed: ' + JSON.stringify(fs2));
const fr = parseFredCsv('observation_date,DGS10\n2026-09-01,4.10\n2026-09-02,.\n2026-09-03,4.2\n');
if (fr.length !== 2 || fr[1][1] !== 4.2) throw new Error('parseFredCsv failed');
console.log('parser checks ok');

// --- end-to-end: two consecutive days so change-tracking paths run
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-'));
const run = (offset) => {
  const f = path.join(tmp, `fixture${offset}.json`);
  fs.writeFileSync(f, JSON.stringify(syntheticSnapshot(offset)));
  execFileSync(process.execPath, [path.join(here, '..', 'run.mjs'), '--fixture', f], { env: { ...process.env, INTEL_DATA_DIR: path.join(tmp, 'data'), ANTHROPIC_API_KEY: '' }, stdio: 'inherit' });
};
run(-1);
run(0);
const latest = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'latest.json'), 'utf8'));
const must = ['forces', 'map', 'scenarios', 'regime', 'attribution', 'reportMd', 'briefMd', 'cycle'];
for (const k of must) if (!latest[k]) throw new Error('missing ' + k);
if (latest.cycle.error) throw new Error('cycle: ' + latest.cycle.error);
const cyS = Object.fromEntries(latest.cycle.metrics.map((x) => [x.id, x.status]));
if (cyS.sopr !== 'delayed') throw new Error('expected SOPR flagged delayed, got ' + cyS.sopr);
if (cyS.profit === 'unavailable' || cyS.mvrv === 'unavailable') throw new Error('cycle inputs missing: ' + JSON.stringify(cyS));
if (latest.cycle.valuation.score === null) throw new Error('composite not computed');
if (/NaN|undefined|Infinity/.test(JSON.stringify(latest.cycle.metrics.map((x) => [x.display, x.meaning, x.move])))) throw new Error('bad cycle copy');
if (latest.forces.length < 6) throw new Error('too few forces');
if (!latest.map.levels.length) throw new Error('empty level map');
const runsLog = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'runs.json'), 'utf8')).runs;
if (runsLog.length !== 2) throw new Error('runs log should have 2 entries, has ' + runsLog.length);
if (/NaN|undefined/.test(latest.reportMd + latest.briefMd)) {
  const bad = (latest.reportMd + '\n' + latest.briefMd).split('\n').filter((l) => /NaN|undefined/.test(l));
  throw new Error('report contains NaN/undefined:\n' + bad.join('\n'));
}
console.log(`ok — ${latest.forces.length} forces, ${latest.map.levels.length} levels, regime "${latest.regime.primary}", report ${latest.reportMd.length} chars`);
console.log('output:', tmp);
if (process.argv.includes('--copy-to')) {
  const dest = process.argv[process.argv.indexOf('--copy-to') + 1];
  fs.cpSync(path.join(tmp, 'data'), dest, { recursive: true });
  console.log('copied synthetic data to', dest);
}
