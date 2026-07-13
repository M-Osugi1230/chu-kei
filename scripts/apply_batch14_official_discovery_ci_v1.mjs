import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const runNode = script => execFileSync(process.execPath, [script], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
  timeout: 1_500_000,
});

runNode('scripts/discover_batch14_official_ir_v1.mjs');
runNode('scripts/validate_quality_v43.mjs');

const reportPath = path.join(ROOT, 'operations', 'research', 'structured-expansion-batch-14-official-discovery.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.selectedCompanyCount !== 25) throw new Error(`selectedCompanyCount=${report.selectedCompanyCount}`);
if (report.detailedResearchCount !== 15) throw new Error(`detailedResearchCount=${report.detailedResearchCount}`);
if (new Set(report.selectedForDetailedResearch.map(row => row.code)).size !== 15) throw new Error('detailed research codes are not unique');

const cleanPackage = {
  name: 'chu-kei',
  version: '43.0.0',
  private: true,
  description: '日本上場企業の中期経営計画を比較・理解・調査するための品質重視ポータル',
  type: 'module',
  scripts: {
    'quality:v43': 'node scripts/validate_quality_v43.mjs',
    'quality:local': 'node scripts/run_local_quality_gate.mjs',
    'quality:local:quick': 'node scripts/run_local_quality_gate.mjs --quick',
    quality: 'npm run quality:v43',
  },
  engines: { node: '>=20' },
};
fs.writeFileSync(path.join(ROOT, 'package.json'), `${JSON.stringify(cleanPackage, null, 2)}\n`);
fs.rmSync(path.join(ROOT, 'scripts', 'apply_batch14_official_discovery_ci_v1.mjs'), { force: true });
fs.rmSync(path.join(ROOT, 'package-lock.json'), { force: true });
fs.rmSync(path.join(ROOT, 'node_modules'), { recursive: true, force: true });
console.log(JSON.stringify({
  detailedResearchCount: report.detailedResearchCount,
  selectedForDetailedResearch: report.selectedForDetailedResearch,
}, null, 2));
