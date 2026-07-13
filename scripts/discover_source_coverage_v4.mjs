import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const BASE_SCRIPT = path.join(ROOT, 'scripts', 'discover_source_coverage_v3.mjs');
const CURATED_PATH = path.join(ROOT, 'operations', 'research', 'source-coverage-50-curated-start-urls.json');
const TEMP_DIR = path.join(ROOT, 'artifacts');
const TEMP_SCRIPT = path.join(TEMP_DIR, 'discover_source_coverage_v4.generated.mjs');

const curated = JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8'));
let source = fs.readFileSync(BASE_SCRIPT, 'utf8');
source = source.replace(
  'const KNOWN_START_URLS = {',
  `const CURATED_START_URLS = ${JSON.stringify(curated)};\n\nconst KNOWN_START_URLS = {`,
);
source = source.replace(
  "const known = (KNOWN_START_URLS[company.code] || []).map(url => ({ url, text: `${company.name} IR`, score: 120, provider: 'known-map' }));",
  "const known = [...(CURATED_START_URLS[company.code] || []), ...(KNOWN_START_URLS[company.code] || [])].map((url, index) => ({ url, text: `${company.name} IR`, score: index < (CURATED_START_URLS[company.code] || []).length ? 140 : 120, provider: index < (CURATED_START_URLS[company.code] || []).length ? 'curated-official-map' : 'known-map' }));",
);
if (!source.includes('CURATED_START_URLS') || !source.includes("provider: index <")) {
  throw new Error('Unable to inject curated source URLs into discovery engine');
}
fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.writeFileSync(TEMP_SCRIPT, source);
execFileSync(process.execPath, [TEMP_SCRIPT], { cwd: ROOT, env: process.env, stdio: 'inherit' });
