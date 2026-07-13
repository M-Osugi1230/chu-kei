import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve('.');
const dataDir = path.join(root, 'site', 'data');
const manifestPath = path.join(dataDir, 'bundle.manifest.json');
const qualityReportPath = path.join(root, 'reports', 'v43', 'QUALITY_SCORE_V2_REPORT.json');
const artifactDir = path.join(root, 'artifacts');
const TARGET_PARTS = 43;

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const compressed = Buffer.concat(
  manifest.parts.map((part) => fs.readFileSync(path.join(dataDir, part.file))),
);
const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));

const stageTier = {
  core: '本番',
  detailed_extracted: '詳細抽出済みβ',
  source_indexed: '一次確認β',
  jpx_indexed: 'Coverageβ',
};

const changes = [];
const blocking = [];

for (const company of payload.companies ?? []) {
  const code = String(company.code ?? '');
  for (const field of ['code', 'name', 'market', 'stage', 'lastVerifiedDate', 'quality']) {
    if (company[field] == null || company[field] === '') {
      blocking.push({ code, field, reason: '安全に補完できない必須項目' });
    }
  }

  if (Object.hasOwn(company, 'reviewEvidence')) {
    delete company.reviewEvidence;
    changes.push({ code, field: 'reviewEvidence', action: 'remove_derived_duplicate' });
  }

  const beforeThemes = company.themes;
  let themes = [];
  if (Array.isArray(beforeThemes)) {
    themes = beforeThemes;
  } else if (typeof beforeThemes === 'string') {
    themes = [beforeThemes];
  } else if (beforeThemes != null) {
    blocking.push({ code, field: 'themes', reason: `未対応の型: ${typeof beforeThemes}` });
    continue;
  }

  const normalizedThemes = [...new Set(
    themes
      .filter((theme) => typeof theme === 'string')
      .map((theme) => theme.trim())
      .filter(Boolean),
  )];
  if (!Array.isArray(beforeThemes) || JSON.stringify(beforeThemes) !== JSON.stringify(normalizedThemes)) {
    changes.push({ code, field: 'themes', beforeType: typeof beforeThemes, afterCount: normalizedThemes.length });
    company.themes = normalizedThemes;
  }

  if (typeof company.industry !== 'string' || !company.industry.trim()) {
    company.industry = '未確認';
    changes.push({ code, field: 'industry', action: 'set_explicit_unknown' });
  }
  if (typeof company.tier !== 'string' || !company.tier.trim()) {
    company.tier = stageTier[company.stage] ?? '未確認';
    changes.push({ code, field: 'tier', action: 'derive_from_stage' });
  }
  if (typeof company.summary !== 'string') {
    company.summary = '';
    changes.push({ code, field: 'summary', action: 'set_empty_unconfirmed' });
  }
  if (!company.flags || typeof company.flags !== 'object' || Array.isArray(company.flags)) {
    company.flags = {};
    changes.push({ code, field: 'flags', action: 'set_empty_object' });
  }
}

const qualityV2Ready = (payload.companies ?? []).every((company) => (
  company.quality?.version === '2.0'
  && Object.keys(company.quality?.checks ?? {}).length === 8
));
if (!qualityV2Ready) {
  blocking.push({
    field: 'quality',
    reason: '全570社のquality.version=2.0と8項目checksを確認できないため、v2マニフェストへ昇格できません',
  });
}

if (blocking.length > 0) {
  throw new Error(`安全に正規化できない項目があります: ${JSON.stringify(blocking)}`);
}

const json = Buffer.from(JSON.stringify(payload), 'utf8');
const nextCompressed = zlib.gzipSync(json, { level: 9, mtime: 0 });
const partSize = Math.ceil(nextCompressed.length / TARGET_PARTS);
const nextParts = [];

for (const oldPart of fs.readdirSync(dataDir).filter((name) => /^bundle\.gz\.part\d+$/.test(name))) {
  fs.rmSync(path.join(dataDir, oldPart));
}

const gitBlobSha = (buffer) => crypto
  .createHash('sha1')
  .update(Buffer.from(`blob ${buffer.length}\0`))
  .update(buffer)
  .digest('hex');

for (let index = 0; index < TARGET_PARTS; index += 1) {
  const start = index * partSize;
  const end = Math.min(start + partSize, nextCompressed.length);
  const buffer = nextCompressed.subarray(start, end);
  const file = `bundle.gz.part${String(index).padStart(3, '0')}`;
  fs.writeFileSync(path.join(dataDir, file), buffer);
  nextParts.push({ file, bytes: buffer.length, blobSha: gitBlobSha(buffer) });
}

const nextManifest = {
  ...manifest,
  version: 'v43-quality-score-v2',
  compressedBytes: nextCompressed.length,
  uncompressedBytes: json.length,
  sha256: crypto.createHash('sha256').update(nextCompressed).digest('hex'),
  companyCount: payload.companies?.length ?? 0,
  progressCount: payload.progress?.length ?? 0,
  parts: nextParts,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest)}\n`);

if (fs.existsSync(qualityReportPath)) {
  const qualityReport = JSON.parse(fs.readFileSync(qualityReportPath, 'utf8'));
  qualityReport.bundle = {
    sha256: nextManifest.sha256,
    compressedBytes: nextManifest.compressedBytes,
    parts: nextManifest.parts.length,
  };
  fs.writeFileSync(qualityReportPath, `${JSON.stringify(qualityReport, null, 2)}\n`);
}

fs.mkdirSync(artifactDir, { recursive: true });
const report = {
  version: 'bundle-contract-normalization-v1',
  generatedAt: new Date().toISOString(),
  automaticFactCompletion: false,
  companyCount: payload.companies?.length ?? 0,
  progressCount: payload.progress?.length ?? 0,
  qualityManifestVersion: nextManifest.version,
  changes,
  blocking,
  outputSha256: nextManifest.sha256,
};
fs.writeFileSync(
  path.join(artifactDir, 'bundle-contract-normalization-v1.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(`Normalized ${changes.length} contract fields across ${report.companyCount} companies.`);
