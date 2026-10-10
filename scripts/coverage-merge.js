#!/usr/bin/env node
/**
 * Merges unit + e2e coverage into coverage/merged and reports two numbers:
 * the whole codebase, and "business logic" (services, listeners, processors,
 * pure helpers: the code that makes decisions, as opposed to wiring/DTOs).
 * Usage: npm run test:cov && npm run test:e2e:docker -- --coverage && npm run coverage:merge
 */
const fs = require('fs');
const path = require('path');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

const root = path.resolve(__dirname, '..');
const inputs = ['coverage/unit/coverage-final.json', 'coverage/e2e/coverage-final.json']
  .map((p) => path.join(root, p))
  .filter((p) => fs.existsSync(p));
if (inputs.length === 0) {
  console.error('No coverage-final.json found. Run test:cov and/or test:e2e:docker -- --coverage first.');
  process.exit(1);
}

const map = libCoverage.createCoverageMap({});
for (const file of inputs) map.merge(JSON.parse(fs.readFileSync(file, 'utf8')));

const outDir = path.join(root, 'coverage/merged');
const context = libReport.createContext({ dir: outDir, coverageMap: map });
['lcov', 'json-summary', 'text-summary'].forEach((r) => reports.create(r).execute(context));

const BUSINESS = /src\/(modules\/.+\.(service|listener|listeners|processor)\.ts|modules\/.+\/listeners\/.+\.ts|jobs\/.+\.ts|modules\/.+(pricing|levels|messages|dates|defaults|constants)\.ts|common\/security\/.+\.ts|infrastructure\/(payments|sockets)\/.+\.ts)$/;

const sum = (filter) => {
  const s = libCoverage.createCoverageSummary();
  const rows = [];
  for (const f of map.files()) {
    if (!filter(f)) continue;
    const fs_ = map.fileCoverageFor(f).toSummary();
    s.merge(fs_);
    rows.push({ file: path.relative(root, f), lines: fs_.lines.pct, statements: fs_.statements.total });
  }
  return { s, rows };
};

const biz = sum((f) => BUSINESS.test(f));
const fmt = (m) => `${m.pct.toFixed(1)}% (${m.covered}/${m.total})`;
console.log(`\nMerged from: ${inputs.map((p) => path.relative(root, p)).join(', ')}`);
console.log('\nBusiness logic (services, listeners, processors, helpers):');
console.log(`  Lines       ${fmt(biz.s.lines)}`);
console.log(`  Statements  ${fmt(biz.s.statements)}`);
console.log(`  Branches    ${fmt(biz.s.branches)}`);
console.log(`  Functions   ${fmt(biz.s.functions)}`);
console.log('\nLeast covered business files (by size):');
biz.rows
  .filter((r) => r.statements >= 40)
  .sort((a, b) => a.lines - b.lines)
  .slice(0, 15)
  .forEach((r) => console.log(`  ${String(r.lines.toFixed(1)).padStart(5)}%  ${r.file}`));

const threshold = Number(process.env.BUSINESS_COVERAGE_MIN ?? 0);
if (threshold && biz.s.lines.pct < threshold) {
  console.error(`\nBusiness-logic line coverage ${biz.s.lines.pct.toFixed(1)}% is below ${threshold}%`);
  process.exit(1);
}
