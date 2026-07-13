import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'operations', 'research', 'source-coverage-50-queue.json'), 'utf8'));
const discoveryPath = path.join(ROOT, 'operations', 'research', 'source-coverage-50-discovery.json');
const discovery = fs.existsSync(discoveryPath) ? JSON.parse(fs.readFileSync(discoveryPath, 'utf8')) : { verified: [] };
const verifiedCodes = new Set((discovery.verified || []).map(row => String(row.code)));
const rows = queue.selected.map(row => ({
  code: String(row.code),
  name: row.name,
  market: row.market,
  industry: row.industry,
  score: row.score,
  alreadyVerified: verifiedCodes.has(String(row.code)),
}));
const output = {
  version: 'source-coverage-candidate-list-v1',
  target: queue.targetSourceConfirmed,
  needed: queue.needed,
  candidateCount: rows.length,
  alreadyVerified: rows.filter(row => row.alreadyVerified).length,
  candidates: rows,
};
const out = path.join(ROOT, 'operations', 'research', 'source-coverage-50-candidates-compact.json');
fs.writeFileSync(out, `${JSON.stringify(output)}\n`);
console.log(JSON.stringify(output));
