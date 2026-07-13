import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');

const runNode = (script, args = []) => {
  console.log(`\n> node ${script} ${args.join(' ')}`.trim());
  execFileSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    timeout: 300_000,
  });
};

const run = (command, args) => {
  console.log(`\n> ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    timeout: 300_000,
  });
};

runNode('scripts/build_frontend_data_shards_v1.mjs');
runNode('scripts/migrate_app_to_lazy_details_v1.mjs');

const indexPath = path.join(ROOT, 'site', 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');
indexHtml = indexHtml.replace('<dd id="stat-structured">110社</dd>', '<dd id="stat-structured">200社</dd>');
fs.writeFileSync(indexPath, indexHtml);

run(process.execPath, ['--check', 'site/assets/app.js']);
run(process.execPath, ['--check', 'site/assets/frontend-data-loader.js']);
runNode('scripts/validate_frontend_budget_v1.mjs');
runNode('scripts/validate_quality_v43.mjs');
runNode('scripts/validate_quality_score_v2.mjs');
runNode('scripts/validate_data_contract_v1.mjs');
runNode('scripts/validate_quality_dashboard_v1.mjs');

const frontendManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', 'frontend', 'manifest.json'), 'utf8'));
const shardReport = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'v43', 'FRONTEND_DATA_SHARDS_V1_REPORT.json'), 'utf8'));
if (frontendManifest.companyCount !== 570) throw new Error(`frontend company count: ${frontendManifest.companyCount}`);
if (shardReport.structuredCompanyCount !== 200) throw new Error(`structured company count: ${shardReport.structuredCompanyCount}`);
if (shardReport.initialBytes > shardReport.initialBudgetBytes) throw new Error(`initial bytes: ${shardReport.initialBytes}`);
if (shardReport.maxDetailShardBytes > shardReport.detailShardBudgetBytes) throw new Error(`detail shard bytes: ${shardReport.maxDetailShardBytes}`);

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
fs.rmSync(path.join(ROOT, 'scripts', 'apply_lazy_frontend_ci_v1.mjs'), { force: true });
fs.rmSync(path.join(ROOT, 'package-lock.json'), { force: true });

console.log(JSON.stringify({
  version: 'lazy-frontend-application-v1',
  companyCount: frontendManifest.companyCount,
  progressCount: frontendManifest.progressCount,
  indexBytes: shardReport.indexBytes,
  initialBytes: shardReport.initialBytes,
  initialBudgetBytes: shardReport.initialBudgetBytes,
  detailShardCount: shardReport.detailShardCount,
  maxDetailShardBytes: shardReport.maxDetailShardBytes,
  detailShardBudgetBytes: shardReport.detailShardBudgetBytes,
  sourceBundleSha256: frontendManifest.sourceBundleSha256,
}, null, 2));
