#!/usr/bin/env node
/**
 * Read-only end-to-end file integrity audit of the active JPX universe,
 * search index and all frontend company detail shards.
 *
 * Safe for scheduled data sync, PR quality gates and local use.
 * Does not promote source evidence or approve any company review.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'site', 'data', 'frontend');
const read = (filename) => JSON.parse(fs.readFileSync(path.join(root, filename), 'utf8'));

const universe = read('operations/universe/current-universe-v1.json');
const registry = read('operations/plan-detection/registry-v1.json');
const summary = read('site/data/plan-detection-summary-v1.json');
const manifest = read('site/data/frontend/manifest.json');

assert.equal(universe.version, 'company-universe-v1');
assert.equal(registry.version, 'plan-detection-registry-v1');
assert.equal(summary.version, 'plan-detection-summary-v1');
assert.equal(manifest.version, 'frontend-data-manifest-v1');

const canonicalCodes = new Set();
for (const company of universe.companies) {
  const code = String(company.code);
  assert.match(code, /^[0-9A-Z]{4}$/, `invalid canonical code ${code}`);
  assert.ok(!canonicalCodes.has(code), `duplicate canonical code ${code}`);
  canonicalCodes.add(code);
}

assert.equal(universe.companyCount, canonicalCodes.size);
assert.equal(manifest.companyCount, canonicalCodes.size);
assert.equal(manifest.universeCompanyCount, canonicalCodes.size);
assert.equal(registry.companyCount, canonicalCodes.size);
assert.equal(summary.companyCount, canonicalCodes.size);

function verifiedGzip(descriptor, allowedFilename) {
  assert.ok(allowedFilename.test(descriptor.file), `unsafe shard filename: ${descriptor.file}`);
  const bytes = fs.readFileSync(path.join(dataDir, descriptor.file));
  assert.equal(bytes.length, descriptor.bytes, `byte-size mismatch: ${descriptor.file}`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, descriptor.sha256, `SHA-256 mismatch: ${descriptor.file}`);
  return JSON.parse(gunzipSync(bytes).toString('utf8'));
}

const index = verifiedGzip(manifest.index, /^company-index\.json\.gz$/);
assert.equal(index.version, 'frontend-company-index-v1');
assert.equal(index.companies.length, canonicalCodes.size);
assert.equal(index.progress.length, manifest.progressCount);

const indexByCode = new Map();
for (const company of index.companies) {
  const code = String(company.code);
  assert.ok(canonicalCodes.has(code), `index contains unlisted code ${code}`);
  assert.ok(!indexByCode.has(code), `duplicate indexed code ${code}`);
  assert.match(String(company.detailFile), /^details-\d{3}\.json\.gz$/);
  indexByCode.set(code, company);
}

assert.equal(indexByCode.size, canonicalCodes.size);

const seenShardNames = new Set();
const seenDetailCodes = new Set();
let totalDetailRows = 0;

for (const descriptor of manifest.detailShards) {
  assert.ok(!seenShardNames.has(descriptor.file), `duplicate shard file ${descriptor.file}`);
  seenShardNames.add(descriptor.file);

  const shard = verifiedGzip(descriptor, /^details-\d{3}\.json\.gz$/);
  assert.equal(shard.version, 'frontend-company-details-v1');
  assert.ok(Array.isArray(shard.companies) && shard.companies.length > 0,
    `empty detail shard ${descriptor.file}`);
  assert.equal(shard.companies.length, descriptor.companyCount);
  assert.equal(String(shard.companies[0].code), descriptor.firstCode);
  assert.equal(String(shard.companies.at(-1).code), descriptor.lastCode);

  for (const company of shard.companies) {
    const code = String(company.code);
    assert.ok(canonicalCodes.has(code), `detail contains unlisted code ${code}`);
    assert.ok(!seenDetailCodes.has(code), `duplicate detail code ${code}`);
    assert.equal(indexByCode.get(code)?.detailFile, descriptor.file,
      `index/detail shard routing mismatch for ${code}`);
    seenDetailCodes.add(code);
  }

  totalDetailRows += shard.companies.length;
}

assert.equal(totalDetailRows, canonicalCodes.size, 'detail rows do not match current JPX universe');
assert.equal(seenDetailCodes.size, canonicalCodes.size, 'some listed company details are missing');
for (const code of canonicalCodes) {
  assert.ok(indexByCode.has(code), `listed company is not searchable: ${code}`);
  assert.ok(seenDetailCodes.has(code), `listed company is missing details: ${code}`);
}

const report = {
  audit: 'full-universe-frontend-integrity-v1',
  readOnly: true,
  sourceFetchedAt: universe.sourceFetchedAt,
  listedCompanies: canonicalCodes.size,
  indexedCompanies: indexByCode.size,
  detailCompanies: seenDetailCodes.size,
  verifiedShards: seenShardNames.size,
  verifiedIndex: manifest.index.file,
  passed: true,
  scope: 'listing identity and local asset integrity only; not review approval or live deployment',
};
console.log(JSON.stringify(report, null, 2));
