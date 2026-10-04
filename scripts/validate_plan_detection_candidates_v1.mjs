import fs from "node:fs";
import path from "node:path";

const ROOT = "operations/plan-detection/candidates";
const ALLOWED_STATUSES = new Set([
  "current",
  "expired",
  "found_unstructured",
  "not_checked",
]);

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
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files.sort();
}

const files = walkJson(ROOT);
if (files.length === 0) {
  console.log("No Plan Detection candidate batches found; validation skipped.");
  process.exit(0);
}

const seenCodes = new Set();
for (const file of files) {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${file}: invalid JSON (${error.message})`);
  }

  if (payload.schemaVersion !== "plan-detection-candidate-batch-v1") {
    fail(`${file}: unsupported schemaVersion`);
  }
  if (typeof payload.batchId !== "string" || !payload.batchId.trim()) {
    fail(`${file}: batchId is required`);
  }
  if (payload.nonPublic !== true) {
    fail(`${file}: candidate batches must remain non-public`);
  }
  if (payload?.policy?.humanReviewRequired !== true) {
    fail(`${file}: human review must be required`);
  }
  if (payload?.policy?.automaticPromotionAllowed !== false) {
    fail(`${file}: automatic promotion must be disabled`);
  }
  if (payload?.policy?.publicationAllowed !== false) {
    fail(`${file}: publication must be disabled`);
  }
  if (payload?.policy?.finalRegistryMutationAllowed !== false) {
    fail(`${file}: final registry mutation must be disabled`);
  }
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    fail(`${file}: candidates must be a non-empty array`);
  }

  for (const candidate of payload.candidates) {
    const code = candidate?.code;
    if (typeof code !== "string" || !code.trim()) {
      fail(`${file}: candidate code is required`);
    }
    if (seenCodes.has(code)) {
      fail(`${file}: duplicate candidate code ${code}`);
    }
    seenCodes.add(code);

    if (typeof candidate?.name !== "string" || !candidate.name.trim()) {
      fail(`${file}: ${code} name is required`);
    }
    const authority = candidate?.source?.authority;
    if (!["official_primary", "first_party_primary"].includes(authority)) {
      fail(`${file}: ${code} source must be official/first-party primary`);
    }
    const sourceUrl = candidate?.source?.url;
    if (typeof sourceUrl !== "string" || !sourceUrl.startsWith("https://")) {
      fail(`${file}: ${code} source URL must be HTTPS`);
    }
    if (
      typeof candidate?.source?.publishedDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(candidate.source.publishedDate)
    ) {
      fail(`${file}: ${code} publishedDate must be YYYY-MM-DD`);
    }
    const suggested = candidate?.observation?.suggestedStatus;
    if (!ALLOWED_STATUSES.has(suggested)) {
      fail(`${file}: ${code} suggestedStatus is not allowed`);
    }
    if (suggested === "no_formal_plan") {
      fail(`${file}: ${code} no_formal_plan is forbidden at candidate stage`);
    }
    if (candidate?.review?.decision !== "needs_review") {
      fail(`${file}: ${code} decision must remain needs_review`);
    }
    if (candidate?.review?.status !== "pending") {
      fail(`${file}: ${code} human review must remain pending`);
    }
    if (candidate?.publication?.eligible !== false) {
      fail(`${file}: ${code} publication must remain ineligible`);
    }
    if (candidate?.promotion?.allowed !== false) {
      fail(`${file}: ${code} promotion must remain disabled`);
    }
    const provenance = candidate?.provenance?.repositoryPaths;
    if (!Array.isArray(provenance) || provenance.length === 0) {
      fail(`${file}: ${code} repository provenance is required`);
    }
    if (provenance.some((value) => typeof value !== "string" || !value.trim())) {
      fail(`${file}: ${code} repository provenance contains an invalid path`);
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      schemaVersion: "plan-detection-candidate-batch-v1",
      files: files.length,
      candidateCount: seenCodes.size,
      nonPublic: true,
      automaticPromotionAllowed: false,
    },
    null,
    2,
  ),
);
