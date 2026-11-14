#!/usr/bin/env node
/**
 * Read-only audit of the deployed Chu-kei Site against the latest reviewed
 * GitHub company universe, frontend assets, and Plan Detection summary.
 *
 * Default: check a declared public candidate URL, report drift, fail on drift.
 * --offline: validate local contracts only (suitable for normal PR CI).
 *
 * No deploy, source modification, company approval or credentials required.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = path.join(root, 'artifacts', 'live-deployment-parity-v1.json');
const offline = process.argv.includes('--offline');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const checks = [];
const errors = [];
const check = (name, ok, detail) => {
  const item = { name, passed: Boolean(ok), detail: String(detail ?? '') };
  checks.push(item);
  if (!ok) errors.push(item);
};

const universe = readJson('operations/universe/current-universe-v1.json');
const registry = readJson('operations/plan-detection/registry-v1.json');
const summary = readJson('site/data/plan-detection-summary-v1.json');
const manifest = readJson('site/data/frontend/manifest.json');
const target = readJson('operations/site-sync/deployment-targets-v1.json');

const expectedCount = universe.companies.length;
check('canonical universe count', universe.companyCount === expectedCount, String(expectedCount));
check('registry universe count', registry.companyCount === expectedCount, String(registry.companyCount));
check('public summary universe count', summary.companyCount === expectedCount, String(summary.companyCount));
check('frontend manifest count', manifest.companyCount === expectedCount, String(manifest.companyCount));
check('frontend shards cover universe',
  manifest.detailShards.reduce((sum, shard) => sum + shard.companyCount, 0) === expectedCount,
  String(manifest.detailShards.length) + ' detail files');
check('pending status consistency',
  summary.pendingCount === registry.counts.not_checked
  && summary.resolvedCount + summary.pendingCount === expectedCount,
  'resolved=' + summary.resolvedCount + ' pending=' + summary.pendingCount);
check('override counts',
  summary.verifiedOverrideCount === registry.verifiedOverrideCount
  && summary.primaryReviewedOverrideCount === registry.primaryReviewedOverrideCount);
const localIndexPath = path.join(root, 'site', 'data', 'frontend', manifest.index.file);
const indexBytes = fs.readFileSync(localIndexPath);
check('local frontend index SHA-256',
  indexBytes.length === manifest.index.bytes && hash(indexBytes) === manifest.index.sha256,
  manifest.index.sha256);

const report = {
  schemaVersion: 1,
  audit: 'live-deployment-parity-v1',
  checkedAt: new Date().toISOString(),
  mode: offline ? 'offline' : 'live',
  canonical: {
    sourceFetchedAt: universe.sourceFetchedAt,
    companyCount: expectedCount,
    resolvedCount: summary.resolvedCount,
    pendingCount: summary.pendingCount,
    indexSha256: manifest.index.sha256,
    sourceBundleSha256: manifest.sourceBundleSha256,
  },
  publicCandidate: target.publicCandidate.url,
  publicationVerified: false,
  checks,
  errors,
};

const publicUrl = new URL(target.publicCandidate.url);
assert.equal(publicUrl.protocol, 'https:', 'site audit URL must use HTTPS');
assert.equal(publicUrl.pathname, '/', 'site audit URL must use root path');
assert.equal(publicUrl.search, '', 'site audit URL must not contain a query');
assert.equal(publicUrl.hash, '', 'site audit URL must not contain a fragment');

async function requestSite(file, asJson = true) {
  const url = new URL(file, publicUrl);
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: { 'cache-control': 'no-cache', 'user-agent': 'chu-kei-live-parity/1.0' },
  });
  if (!response.ok) throw new Error(file + ' returned HTTP ' + response.status);
  // Do not silently validate an unrelated host reached through a redirect.
  if (new URL(response.url).origin !== publicUrl.origin) {
    throw new Error(file + ' redirected to unexpected origin ' + new URL(response.url).origin);
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 4_000_000) throw new Error(file + ' exceeds response budget');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 4_000_000) throw new Error(file + ' exceeds response budget');
  if (!asJson) return bytes;
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(file + ' did not return JSON');
  }
}

if (!offline && !errors.length) {
  try {
    const html = (await requestSite('', false)).toString('utf8');
    check('public HTML uses GitHub app shell',
      /id=["']stat-total["']/.test(html) && /assets\/app\.js/.test(html),
      'The public shell must be the reviewed repository application, not an older separate Site');
  } catch (error) {
    check('public homepage reachable', false, error.message);
  }
  let publicManifest = null;
  try {
    publicManifest = await requestSite('data/frontend/manifest.json');
    check('public frontend format', publicManifest.version === 'frontend-data-manifest-v1',
      String(publicManifest.version));
    check('public company count', publicManifest.companyCount === manifest.companyCount,
      'actual=' + publicManifest.companyCount + ' expected=' + manifest.companyCount);
    check('public source bundle identity',
      publicManifest.sourceBundleSha256 === manifest.sourceBundleSha256);
    check('public search index identity',
      publicManifest.index?.sha256 === manifest.index.sha256,
      'actual=' + String(publicManifest.index?.sha256) + ' expected=' + manifest.index.sha256);
  } catch (error) {
    check('public manifest reachable', false, error.message);
  }

  try {
    const publicSummary = await requestSite('data/plan-detection-summary-v1.json');
    check('public Plan Detection format', publicSummary.version === 'plan-detection-summary-v1');
    check('public Plan Detection universe', publicSummary.companyCount === summary.companyCount);
    check('public Plan Detection resolved', publicSummary.resolvedCount === summary.resolvedCount);
    check('public Plan Detection pending', publicSummary.pendingCount === summary.pendingCount);
    check('public Plan Detection statuses',
      JSON.stringify(publicSummary.counts) === JSON.stringify(summary.counts));
  } catch (error) {
    check('public Plan Detection summary reachable', false, error.message);
  }

  if (publicManifest?.index?.file && /^[a-z0-9._-]+$/i.test(publicManifest.index.file)) {
    try {
      const bytes = await requestSite('data/frontend/' + publicManifest.index.file, false);
      check('public index raw bytes and SHA-256',
        bytes.length === manifest.index.bytes && hash(bytes) === manifest.index.sha256,
        'bytes=' + bytes.length);
    } catch (error) {
      check('public search index reachable', false, error.message);
    }
  }
} else if (!offline) {
  check('local prerequisites before live audit', false, 'canonical source data failed local integrity checks');
}

report.publicationVerified = !offline && errors.length === 0;
report.result = offline ? (errors.length ? 'LOCAL_FAILED' : 'LOCAL_PASSED') :
  (report.publicationVerified ? 'PUBLIC_PARITY_VERIFIED' : 'PUBLIC_DRIFT_OR_UNREACHABLE');
fs.mkdirSync(path.dirname(artifact), { recursive: true });
fs.writeFileSync(artifact, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
