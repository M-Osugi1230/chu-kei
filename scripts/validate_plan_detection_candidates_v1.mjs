import fs from 'node:fs';
import path from 'node:path';
import { validateCandidateFile } from './lib/plan_detection_v1.mjs';

const ROOT = 'operations/plan-detection/candidates';

function fail(message) {
  console.error(`Plan Detection candidate validation failed: ${message}`);
  process.exit(1);
}

function walkJson(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkJson(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
  }
  return files.sort();
}

const files = walkJson(ROOT);
if (files.length === 0) {
  console.log('No Plan Detection candidate batches found; validation skipped.');
  process.exit(0);
}

const seenCodes = new Set();
for (const file of files) {
  try {
    validateCandidateFile(file, seenCodes);
  } catch (error) {
    fail(error.message);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      schemaVersion: 'plan-detection-candidate-batch-v1',
      files: files.length,
      candidateCount: seenCodes.size,
      nonPublic: true,
      automaticPromotionAllowed: false,
    },
    null,
    2,
  ),
);
