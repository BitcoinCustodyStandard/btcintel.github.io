#!/usr/bin/env node
// Market-intelligence agent. Runs in GitHub Actions (daily 07:00 local + manual).
//
//   node agent/run.mjs                 # manual refresh
//   node agent/run.mjs --scheduled     # 07:00 gate (waits/skips as needed)
//   node agent/run.mjs --fixture FILE  # offline test with a saved snapshot
//
// Steps: collect → merge with last snapshot (stale-labelling) → analyze vs history
// → morning report (+ optional Claude narrative) → persist history → write site data.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll, mergeWithPrevious } from '../engine/collect.js';
import { analyze, backfillRows } from '../engine/analyze.js';
import { morningReport, briefReport } from '../engine/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.INTEL_DATA_DIR ? path.resolve(process.env.INTEL_DATA_DIR) : path.resolve(here, '../data');
const TZ = process.env.INTEL_TZ || 'America/New_York';
const args = process.argv.slice(2);
const scheduled = args.includes('--scheduled');
const fixture = args.includes('--fixture') ? args[args.indexOf('--fixture') + 1] : null;
const log = (...a) => console.log(new Date().toISOString(), ...a);

const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJSON = (p, o, pretty = false) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, pretty ? 1 : 0)); };

function localParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24, minute: +p.minute };
}

async function gate() {
  const now = localParts();
  const index = readJSON(path.join(DATA, 'index.json'), { reports: [] });
  if (index.reports.some((r) => r.date === now.date && r.kind === 'morning')) {
    log(`Morning report for ${now.date} already exists — skipping.`);
    return false;
  }
  const minsTo7 = 7 * 60 - (now.hour * 60 + now.minute);
  if (minsTo7 > 20) { log(`Local time ${now.hour}:${String(now.minute).padStart(2, '0')} ${TZ} — too early (other cron slot covers DST). Skipping.`); return false; }
  if (now.hour >= 11) { log(`Local time past 11:00 ${TZ} — scheduled slot missed; skipping (use manual refresh).`); return false; }
  if (minsTo7 > 0) { log(`Waiting ${minsTo7} min until 07:00 ${TZ}…`); await new Promise((r) => setTimeout(r, minsTo7 * 60000)); }
  return true;
}

// Optional manual ETF flows (if Farside blocks the runner): data/manual/etf_flows.csv
// header: date,total_usd_m[,IBIT,FBTC,...]  — values in US$ millions, negative = outflow.
// Rows only fill dates the scraper does not have; the source is labelled.
function mergeManualEtf(snap) {
  const f = path.join(DATA, 'manual', 'etf_flows.csv');
  if (!fs.existsSync(f)) return;
  const [hdr, ...lines] = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/);
  const cols = hdr.split(',').map((c) => c.trim());
  const have = new Map((snap.etf?.daily || []).map((r) => [r.date, r]));
  let added = 0;
  for (const l of lines) {
    const v = l.split(',').map((c) => c.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v[0]) || have.has(v[0])) continue;
    const funds = {};
    cols.slice(2).forEach((c, i) => { const n = parseFloat(v[i + 2]); if (Number.isFinite(n)) funds[c] = n; });
    const total = parseFloat(v[1]);
    if (!Number.isFinite(total)) continue;
    have.set(v[0], { date: v[0], totalUsdM: total, funds, manual: true });
    added++;
  }
  if (!added) return;
  const daily = [...have.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  snap.etf = { ...(snap.etf || {}), daily };
  const s = snap.sources.farside || { name: 'Farside Investors — BTC ETF flows', frequency: 'daily' };
  snap.sources.farside = { ...s, status: s.status === 'ok' ? 'ok' : 'stale', asOf: daily.at(-1).date, method: (s.method || '') + ` Includes ${added} manually entered day(s) from data/manual/etf_flows.csv.` };
  log(`Merged ${added} manual ETF flow rows.`);
}

const runPoint = (r) => ({ price: r.price, depth1: r.depth1, depthVenues: r.depthVenues, depthBid1: r.depthBid1, depthAsk1: r.depthAsk1, oiTotal: r.oiTotal, oiCoverage: r.oiCoverage, fundingAnn: r.fundingAnn, iv30: r.iv30, cbPremium: r.cbPremium });

async function main() {
  if (scheduled && !(await gate())) { fs.writeFileSync(path.join(DATA, '.skipped'), '1'); return; }
  try { fs.unlinkSync(path.join(DATA, '.skipped')); } catch {}

  const prevSnap = readJSON(path.join(DATA, 'snapshot.json'));
  let rows = readJSON(path.join(DATA, 'timeseries.json'), { rows: [] }).rows;

  log(`Collecting (${fixture ? 'fixture ' + fixture : 'live'})…`);
  let snap = fixture ? readJSON(fixture) : await collectAll({ scope: 'server', log, prev: prevSnap });
  snap = mergeWithPrevious(snap, prevSnap);
  mergeManualEtf(snap);

  // First run (or gaps): reconstruct past rows from series that carry history.
  const bf = backfillRows(snap);
  if (bf.length) {
    const have = new Map(rows.map((r) => [r.date, r]));
    let added = 0;
    for (const r of bf) {
      const ex = have.get(r.date);
      if (!ex) { have.set(r.date, r); added++; }
      else if (ex.backfilled) have.set(r.date, { ...ex, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)) });
      else for (const [k, v] of Object.entries(r)) if ((ex[k] === null || ex[k] === undefined) && v !== null && k !== 'backfilled') ex[k] = v;
    }
    rows = [...have.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (added) log(`Backfilled ${added} historical rows.`);
  }

  const a = analyze(snap, rows);
  const local = localParts(new Date(snap.collectedAt));
  a.localDate = local.date;
  a.timezone = TZ;
  a.kind = scheduled ? 'morning' : 'refresh';
  const reportMd = morningReport(a, { localDate: local.date });
  const briefMd = briefReport(a, { localDate: local.date });

  let narrative = null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { narrate } = await import('./narrate.mjs');
      narrative = await narrate(a, reportMd, rows);
      log('Analyst narrative generated.');
    } catch (e) {
      log('Narrative skipped:', e.message);
      narrative = { error: String(e.message).slice(0, 300) };
    }
  }

  // ---- persist
  const row = { ...a.row, date: a.row.date, kind: a.kind };
  rows = rows.filter((r) => r.date !== row.date).concat([row]).sort((x, y) => (x.date < y.date ? -1 : 1));
  writeJSON(path.join(DATA, 'timeseries.json'), { updated: a.generatedAt, fields: Object.keys(row), rows });
  // Raw book levels are only needed for today's analysis; keep the stored snapshot lean.
  const lean = snap.books ? { ...snap, books: { ...snap.books, venues: snap.books.venues.map(({ levels, ...v }) => v) } } : snap;
  writeJSON(path.join(DATA, 'snapshot.json'), lean);

  // Per-run log (every scheduled or manual run) — feeds charts for series that have no
  // free historical source (order-book depth, aggregate OI, Coinbase premium).
  const runsFile = path.join(DATA, 'runs.json');
  let runs = readJSON(runsFile, null)?.runs;
  if (!runs) {
    runs = [];
    for (const f of fs.existsSync(path.join(DATA, 'history')) ? fs.readdirSync(path.join(DATA, 'history')).sort() : []) {
      const h = readJSON(path.join(DATA, 'history', f));
      if (h?.row) runs.push({ t: h.dataThrough, ...runPoint(h.row) });
    }
  }
  runs.push({ t: a.dataThrough, ...runPoint(a.row) });
  writeJSON(runsFile, { updated: a.generatedAt, runs: runs.slice(-3000) });

  const out = { ...a, briefMd, reportMd, narrative };
  writeJSON(path.join(DATA, 'latest.json'), out);

  const index = readJSON(path.join(DATA, 'index.json'), { reports: [] });
  const stamp = `${local.date}${a.kind === 'morning' ? '' : `-${String(local.hour).padStart(2, '0')}${String(local.minute).padStart(2, '0')}`}`;
  // chart histories are re-derivable; keep them out of the per-run archive
  writeJSON(path.join(DATA, 'history', `${stamp}.json`), out.cycle?.charts ? { ...out, cycle: { ...out.cycle, charts: undefined } } : out);
  fs.mkdirSync(path.join(DATA, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'reports', `${stamp}.md`), briefMd + '\n\n---\n\n' + reportMd + (narrative?.text ? `\n\n---\n\n# Analyst narrative\n\n${narrative.text}\n` : ''));
  index.reports = index.reports.filter((r) => r.id !== stamp).concat([{ id: stamp, date: local.date, kind: a.kind, generatedAt: a.generatedAt, price: a.metrics.price.spot, regime: a.regime.primary }]).sort((x, y) => (x.id < y.id ? 1 : -1));
  index.updated = a.generatedAt;
  index.timezone = TZ;
  writeJSON(path.join(DATA, 'index.json'), index, true);

  const ok = a.quality.filter((q) => q.status === 'ok').length;
  log(`Done. ${ok}/${a.quality.length} sources fresh. Regime: ${a.regime.primary}. BTC ${Math.round(a.metrics.price.spot || 0)}.`);
  for (const q of a.quality.filter((q) => q.status !== 'ok')) log(`  ${q.status.toUpperCase()} ${q.id}: ${q.error || ''}`);
  for (const q of a.quality.filter((q) => q.note)) log(`  NOTE ${q.id}: ${q.note}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
