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

function isNonEmptyString(val) {
  return typeof val === "string" && val.trim().length > 0;
}

function isDateString(val) {
  return typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

function isHttpsUrl(val) {
  return typeof val === "string" && val.startsWith("https://");
}

function isPlainObject(val) {
  return typeof val === "object" && val !== null && !Array.isArray(val);
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

  if (!isPlainObject(payload)) {
    fail(`${file}: root payload must be an object`);
  }
  if (payload.schemaVersion !== "plan-detection-candidate-batch-v1") {
    fail(`${file}: unsupported schemaVersion`);
  }
  if (!isNonEmptyString(payload.batchId)) {
    fail(`${file}: batchId is required`);
  }
  const folderName = path.basename(path.dirname(file));
  if (folderName !== payload.batchId) {
    fail(`${file}: batchId '${payload.batchId}' must match directory name '${folderName}'`);
  }
  if (payload.checkedAt !== undefined && !isDateString(payload.checkedAt)) {
    fail(`${file}: checkedAt must be YYYY-MM-DD`);
  }
  if (payload.nonPublic !== true) {
    fail(`${file}: candidate batches must remain non-public`);
  }

  const policy = payload.policy;
  if (!isPlainObject(policy)) {
    fail(`${file}: policy object is required`);
  }
  if (policy.humanReviewRequired !== true) {
    fail(`${file}: human review must be required`);
  }
  if (policy.automaticPromotionAllowed !== false) {
    fail(`${file}: automatic promotion must be disabled`);
  }
  if (policy.publicationAllowed !== false) {
    fail(`${file}: publication must be disabled`);
  }
  if (policy.inferNoFormalPlanFromMissingEvidence !== false) {
    fail(`${file}: missing evidence must never imply no formal plan`);
  }
  if (policy.finalRegistryMutationAllowed !== false) {
    fail(`${file}: final registry mutation must be disabled`);
  }
  if (policy.allowedSuggestedStatuses !== undefined) {
    if (!Array.isArray(policy.allowedSuggestedStatuses)) {
      fail(`${file}: policy.allowedSuggestedStatuses must be an array`);
    }
    for (const st of policy.allowedSuggestedStatuses) {
      if (!ALLOWED_STATUSES.has(st) || st === "no_formal_plan") {
        fail(`${file}: policy.allowedSuggestedStatuses contains forbidden or invalid status '${st}'`);
      }
    }
  }

  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    fail(`${file}: candidates must be a non-empty array`);
  }

  for (const candidate of payload.candidates) {
    if (!isPlainObject(candidate)) {
      fail(`${file}: candidate entry must be an object`);
    }
    const code = candidate.code;
    if (!isNonEmptyString(code)) {
      fail(`${file}: candidate code is required`);
    }
    if (seenCodes.has(code)) {
      fail(`${file}: duplicate candidate code ${code}`);
    }
    seenCodes.add(code);

    if (!isNonEmptyString(candidate.name)) {
      fail(`${file}: ${code} name is required`);
    }

    const source = candidate.source;
    if (!isPlainObject(source)) {
      fail(`${file}: ${code} source object is required`);
    }
    const authority = source.authority;
    if (!["official_primary", "first_party_primary"].includes(authority)) {
      fail(`${file}: ${code} source must be official/first-party primary`);
    }
    if (!isHttpsUrl(source.url)) {
      fail(`${file}: ${code} source URL must be HTTPS`);
    }
    if (source.currentnessUrl !== undefined && !isHttpsUrl(source.currentnessUrl)) {
      fail(`${file}: ${code} source currentnessUrl must be HTTPS`);
    }
    if (source.officialIrUrl !== undefined && !isHttpsUrl(source.officialIrUrl)) {
      fail(`${file}: ${code} source officialIrUrl must be HTTPS`);
    }
    if (!isDateString(source.publishedDate)) {
      fail(`${file}: ${code} publishedDate must be YYYY-MM-DD`);
    }
    if (source.currentnessCheckedAt !== undefined && !isDateString(source.currentnessCheckedAt)) {
      fail(`${file}: ${code} currentnessCheckedAt must be YYYY-MM-DD`);
    }

    const observation = candidate.observation;
    if (!isPlainObject(observation)) {
      fail(`${file}: ${code} observation object is required`);
    }
    const suggested = observation.suggestedStatus;
    if (!ALLOWED_STATUSES.has(suggested)) {
      fail(`${file}: ${code} suggestedStatus is not allowed`);
    }
    if (suggested === "no_formal_plan") {
      fail(`${file}: ${code} no_formal_plan is forbidden at candidate stage`);
    }
    if (
      observation.exactPlanEndDate !== null &&
      observation.exactPlanEndDate !== undefined &&
      !isDateString(observation.exactPlanEndDate)
    ) {
      fail(`${file}: ${code} exactPlanEndDate must be null or YYYY-MM-DD`);
    }

    const review = candidate.review;
    if (!isPlainObject(review)) {
      fail(`${file}: ${code} review object is required`);
    }
    if (review.decision !== "needs_review") {
      fail(`${file}: ${code} decision must remain needs_review`);
    }
    if (review.status !== "pending") {
      fail(`${file}: ${code} human review must remain pending`);
    }
    if (
      !Array.isArray(review.requiredChecks) ||
      review.requiredChecks.length === 0 ||
      review.requiredChecks.some((chk) => !isNonEmptyString(chk))
    ) {
      fail(`${file}: ${code} review requiredChecks must be a non-empty array of non-empty strings`);
    }

    const publication = candidate.publication;
    if (!isPlainObject(publication) || publication.eligible !== false) {
      fail(`${file}: ${code} publication must remain ineligible`);
    }

    const promotion = candidate.promotion;
    if (!isPlainObject(promotion) || promotion.allowed !== false) {
      fail(`${file}: ${code} promotion must remain disabled`);
    }

    const provenance = candidate.provenance;
    if (!isPlainObject(provenance)) {
      fail(`${file}: ${code} provenance object is required`);
    }
    const repoPaths = provenance.repositoryPaths;
    if (!Array.isArray(repoPaths) || repoPaths.length === 0) {
      fail(`${file}: ${code} repository provenance is required`);
    }
    for (const p of repoPaths) {
      if (!isNonEmptyString(p)) {
        fail(`${file}: ${code} repository provenance contains an invalid path`);
      }
      if (p.startsWith("/") || p.includes("..")) {
        fail(`${file}: ${code} repository provenance path '${p}' is invalid or unsafe`);
      }
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
