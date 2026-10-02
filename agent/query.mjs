#!/usr/bin/env node
// Ask the archive questions from the command line.
//   node agent/query.mjs between 2026-02-05 2026-03-05
//   node agent/query.mjs selloff | liquidity | etf | funding | oi | decouple
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUERIES } from '../engine/history.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(fs.readFileSync(path.resolve(here, '../data/timeseries.json'), 'utf8')).rows;
const [q, a, b] = process.argv.slice(2);
if (!QUERIES[q]) {
  console.log('Queries:\n' + Object.entries(QUERIES).map(([k, v]) => `  ${k}${v.needsDates ? ' YYYY-MM-DD YYYY-MM-DD' : ''}  — ${v.label}`).join('\n'));
  process.exit(q ? 1 : 0);
}
const r = QUERIES[q].run(rows, a, b);
console.log(`\n${r.title}\n${'='.repeat(r.title.length)}`);
r.findings.forEach((f) => console.log('• ' + f));
if (r.table?.length) {
  console.log('');
  const w = Math.max(...r.table.map((t) => t.metric.length));
  r.table.forEach((t) => console.log(`${t.metric.padEnd(w)}  ${t.from.padStart(12)} → ${t.to.padEnd(12)} ${t.change}`));
}
