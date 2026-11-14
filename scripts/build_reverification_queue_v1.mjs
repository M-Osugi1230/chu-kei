#!/usr/bin/env node
// Build the Issue #288 re-verification queue.
//
// The quality-debt budget counts every structured bundle record whose
// lastVerifiedDate is older than its stage limit (core = 90 days). All
// 3,000 core records were verified in one July 2026 batch, so they crossed
// the limit together. This queue orders the genuine re-verification work:
//   group 1: companies with a resolved plan detection (public company pages)
//   group 2: remaining Prime records
//   group 3: all other core records
// Oldest lastVerifiedDate first inside each group.
//
// Re-verification means re-checking the official source (URL liveness,
// current document version, summary/metrics consistency) and only then
// updating lastVerifiedDate through the normal source pipeline. Editing
// dates without re-verification is prohibited.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const REGISTRY_PATH = path.join(ROOT, 'operations', 'plan-detection', 'registry-v1.json');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'plan-detection', 'reverification-queue-v1.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(manifest.parts.map((part) => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  return { manifest, payload };
}

const { manifest, payload } = readBundle();
const bundleRows = Array.isArray(payload) ? payload : payload.companies;
if (!Array.isArray(bundleRows)) throw new Error('Bundle payload has no companies array');

const registry = readJson(REGISTRY_PATH);
const registryRows = Array.isArray(registry) ? registry : registry.companies;
const statusByCode = new Map(registryRows.map((row) => [row.code, row.status]));

const queue = [];
for (const row of bundleRows) {
  if (row.stage !== 'core') continue;
  const planStatus = statusByCode.get(row.code) ?? null;
  let priorityGroup = 3;
  if (planStatus === 'current' || planStatus === 'expired') priorityGroup = 1;
  else if (row.market === 'Prime') priorityGroup = 2;
  queue.push({
    code: row.code,
    name: row.name ?? null,
    market: row.market ?? null,
    planStatus,
    lastVerifiedDate: row.lastVerifiedDate ?? null,
    sourceUrl: row.sourceUrl ?? null,
    priorityGroup,
  });
}

queue.sort((a, b) =>
  a.priorityGroup - b.priorityGroup ||
  String(a.lastVerifiedDate ?? '9999').localeCompare(String(b.lastVerifiedDate ?? '9999')) ||
  String(a.code).localeCompare(String(b.code)));

const counts = { total: queue.length, group1Resolved: 0, group2Prime: 0, group3Other: 0 };
for (const item of queue) {
  if (item.priorityGroup === 1) counts.group1Resolved += 1;
  else if (item.priorityGroup === 2) counts.group2Prime += 1;
  else counts.group3Other += 1;
}

const output = {
  version: 'reverification-queue-v1',
  generatedAt: new Date().toISOString(),
  issue: 'M-Osugi1230/chu-kei#288',
  basis: {
    bundleSha256: manifest.sha256,
    bundleRecords: bundleRows.length,
    stage: 'core',
    staleRule: 'core records with (asOfDate - lastVerifiedDate) > 90 days count as staleVerification in the quality-debt budget',
  },
  rule: 'Re-verify the official source (URL liveness, current document version, summary/metrics consistency); only then update lastVerifiedDate through the normal source pipeline. Never edit dates without re-verification.',
  counts,
  queue,
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ version: output.version, counts }, null, 2));
