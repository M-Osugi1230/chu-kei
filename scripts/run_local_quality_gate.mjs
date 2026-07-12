import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

const quick = process.argv.includes('--quick');
const checks = [
  {
    name: 'Research Platform v2',
    command: ['node', 'scripts/validate_research_platform_v2.mjs'],
    required: true,
  },
  {
    name: 'Quality debt budget',
    command: ['node', 'scripts/validate_quality_debt_budget_v1.mjs'],
    required: true,
  },
  {
    name: 'Quality dashboard',
    command: ['node', 'scripts/validate_quality_dashboard_v1.mjs'],
    required: true,
  },
  {
    name: 'v43 quality gate',
    command: ['node', 'scripts/validate_quality_v43.mjs'],
    required: !quick,
  },
];

const syntaxFiles = [
  'site/assets/local-metrics.js',
  'site/assets/metrics.js',
  'site/assets/release.js',
  'site/assets/history.js',
];

const results = [];

function run(name, command) {
  const [bin, ...args] = command;
  const startedAt = Date.now();
  const result = spawnSync(bin, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
    env: process.env,
  });
  const passed = result.status === 0;
  results.push({
    name,
    passed,
    status: result.status,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
  });
  process.stdout.write(`\n${passed ? 'PASS' : 'FAIL'} ${name}\n`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

for (const check of checks) {
  const scriptPath = check.command[1];
  if (!fs.existsSync(scriptPath)) {
    if (check.required) {
      results.push({ name: check.name, passed: false, status: null, durationMs: 0, stdout: '', stderr: `Missing ${scriptPath}` });
      process.stderr.write(`\nFAIL ${check.name}: missing ${scriptPath}\n`);
    } else {
      process.stdout.write(`\nSKIP ${check.name}: missing ${scriptPath}\n`);
    }
    continue;
  }
  run(check.name, check.command);
}

for (const file of syntaxFiles) {
  if (!fs.existsSync(file)) {
    results.push({ name: `Syntax ${file}`, passed: false, status: null, durationMs: 0, stdout: '', stderr: `Missing ${file}` });
    process.stderr.write(`\nFAIL Syntax ${file}: missing file\n`);
    continue;
  }
  run(`Syntax ${file}`, ['node', '--check', file]);
}

const failed = results.filter(result => !result.passed);
const report = {
  version: 'local-quality-gate-v1',
  checkedAt: new Date().toISOString(),
  mode: quick ? 'quick' : 'full',
  passed: results.length - failed.length,
  total: results.length,
  allPassed: failed.length === 0,
  results,
};

fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/local-quality-gate-v1.json', `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`\n${report.passed}/${report.total} local checks passed\n`);
process.exit(report.allPassed ? 0 : 1);
