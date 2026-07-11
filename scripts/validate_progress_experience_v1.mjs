import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  buildProgressIndex,
  progressForCode,
  progressSummary,
  progressMetricLabel,
  formatProgressValue,
  progressRateText,
} from '../site/assets/progress-view.js';

const root = path.resolve('.');
const dataDir = path.join(root, 'site', 'data');
const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'bundle.manifest.json'), 'utf8'));
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(dataDir, part.file))));
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
assert.equal(digest, manifest.sha256, 'bundle SHA-256 must match manifest');
const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
const progress = payload.progress ?? [];
const companyCodes = new Set((payload.companies ?? []).map(company => String(company.code)));
const index = buildProgressIndex(progress);
const actualRows = progress.filter(row => row.actualValue != null);
const actualCompanies = new Set(actualRows.map(row => String(row.code)));

assert.ok(progress.length >= 149, `progress rows regressed: ${progress.length}`);
assert.ok(index.size >= 44, `progress companies regressed: ${index.size}`);
assert.ok(actualRows.length >= 54, `actual rows regressed: ${actualRows.length}`);
assert.ok(actualCompanies.size >= 16, `actual companies regressed: ${actualCompanies.size}`);
assert.equal(progress.filter(row => !companyCodes.has(String(row.code))).length, 0, 'progress rows must reference existing companies');
assert.equal(progress.filter(row => row.targetValue == null).length, 0, 'every progress row must have a target value');
assert.equal(progress.filter(row => !row.fiscalYear || !row.metric || !row.unit).length, 0, 'every progress row must identify target year, metric and unit');
assert.equal(actualRows.filter(row => !row.actualFiscalYear || !row.actualSource || row.progressRate == null).length, 0, 'actual rows must include actual year, source and progress rate');

assert.equal(progressMetricLabel('revenue'), '売上高');
assert.equal(formatProgressValue(86.28, '億円'), '86.28億円');
assert.equal(progressRateText({ progressRate: -80 }), '単純進捗率 -80%');
assert.match(progressSummary(progressForCode(index, '175A')), /^3目標・実績3件/);
assert.equal(progressSummary([]), '未接続');

const report = {
  version: 'progress-experience-v1',
  generatedAt: new Date().toISOString(),
  progressRows: progress.length,
  progressCompanies: index.size,
  actualRows: actualRows.length,
  actualCompanies: actualCompanies.size,
  orphanRows: 0,
  passed: true,
};
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts', 'progress-experience-v1.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
