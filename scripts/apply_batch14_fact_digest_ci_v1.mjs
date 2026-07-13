import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
execFileSync(process.execPath, ['scripts/build_batch14_fact_digest_v1.mjs'], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
  timeout: 300_000,
});
execFileSync(process.execPath, ['scripts/validate_quality_v43.mjs'], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
  timeout: 120_000,
});
const digest = JSON.parse(fs.readFileSync(path.join(ROOT, 'operations', 'research', 'structured-expansion-batch-14-fact-digest.json'), 'utf8'));
if (digest.companyCount !== 9) throw new Error(`companyCount=${digest.companyCount}`);
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
fs.rmSync(path.join(ROOT, 'scripts', 'apply_batch14_fact_digest_ci_v1.mjs'), { force: true });
fs.rmSync(path.join(ROOT, 'package-lock.json'), { force: true });
console.log(JSON.stringify({ companyCount: digest.companyCount, companies: digest.companies.map(company => ({ code: company.code, name: company.name })) }, null, 2));
