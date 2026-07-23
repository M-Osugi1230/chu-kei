import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const SITE = path.join(ROOT, 'site');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const checks = [];
const issues = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); if (!ok) issues.push({ name, detail }); };
const size = file => fs.statSync(path.join(SITE, file)).size;

const files = {
  indexHtml: 'index.html',
  qualityHtml: 'quality.html',
  appJs: 'assets/app.js',
  dataLoaderJs: 'assets/frontend-data-loader.js',
  qualityJs: 'assets/quality.js',
  stylesCss: 'assets/styles.css',
  qualityCss: 'assets/quality.css',
  sourceManifest: 'data/bundle.manifest.json',
  frontendManifest: 'data/frontend/manifest.json',
};
for (const [name, file] of Object.entries(files)) check(`${name} exists`, fs.existsSync(path.join(SITE, file)), file);

const sourceManifest = JSON.parse(fs.readFileSync(path.join(SITE, files.sourceManifest), 'utf8'));
const compressedBundle = Buffer.concat(sourceManifest.parts.map(part => fs.readFileSync(path.join(SITE, 'data', part.file))));
const bundle = JSON.parse(zlib.gunzipSync(compressedBundle));
const structuredCompanyCount = bundle.companies.filter(company => ['core', 'detailed_extracted'].includes(company.stage)).length;
const frontendManifest = JSON.parse(fs.readFileSync(path.join(SITE, files.frontendManifest), 'utf8'));
const frontendManifestBytes = size(files.frontendManifest);
const initialFrontendDataBytes = frontendManifestBytes + frontendManifest.index.bytes;
const maxDetailShardBytes = Math.max(...frontendManifest.detailShards.map(shard => shard.bytes));
const totalDetailShardBytes = frontendManifest.detailShards.reduce((sum, shard) => sum + shard.bytes, 0);
const detailShardBytesMatch = frontendManifest.detailShards.every(shard => size(`data/frontend/${shard.file}`) === shard.bytes);
const indexBytesMatch = size(`data/frontend/${frontendManifest.index.file}`) === frontendManifest.index.bytes;

const shellFiles = [files.indexHtml, files.qualityHtml, files.appJs, files.dataLoaderJs, files.qualityJs, files.stylesCss, files.qualityCss];
const shellBytes = shellFiles.reduce((sum, file) => sum + size(file), 0);
const htmlBytes = size(files.indexHtml) + size(files.qualityHtml);
const jsBytes = size(files.appJs) + size(files.dataLoaderJs) + size(files.qualityJs);
const cssBytes = size(files.stylesCss) + size(files.qualityCss);

const SOURCE_DATA_HARD_CAP_BYTES = 896 * 1024;
const SOURCE_DATA_DENSITY_LIMIT_BYTES = 1500;
const INITIAL_FRONTEND_DATA_CAP_BYTES = 256 * 1024;
const DETAIL_SHARD_CAP_BYTES = 32 * 1024;
const compressedSourceDensity = sourceManifest.compressedBytes / structuredCompanyCount;

check('static shell under 180 KB', shellBytes <= 180 * 1024, `actual=${shellBytes}`);
check('HTML under 40 KB', htmlBytes <= 40 * 1024, `actual=${htmlBytes}`);
check('JavaScript under 110 KB', jsBytes <= 110 * 1024, `actual=${jsBytes}`);
check('CSS under 45 KB', cssBytes <= 45 * 1024, `actual=${cssBytes}`);
check('canonical source bundle under 896 KB', sourceManifest.compressedBytes <= SOURCE_DATA_HARD_CAP_BYTES, `actual=${sourceManifest.compressedBytes}`);
check('canonical source density under 1500 bytes per structured company', compressedSourceDensity <= SOURCE_DATA_DENSITY_LIMIT_BYTES, `actual=${compressedSourceDensity.toFixed(1)} structured=${structuredCompanyCount}`);
check('canonical source chunk count under 256', sourceManifest.parts.length <= 256, `actual=${sourceManifest.parts.length}`);
check('canonical source chunks have positive size', sourceManifest.parts.every(part => Number.isInteger(part.bytes) && part.bytes > 0));
check('canonical source chunk bytes match manifest', sourceManifest.parts.reduce((sum, part) => sum + part.bytes, 0) === sourceManifest.compressedBytes);
check('frontend source hash matches canonical bundle', frontendManifest.sourceBundleSha256 === sourceManifest.sha256, `frontend=${frontendManifest.sourceBundleSha256} source=${sourceManifest.sha256}`);
check('frontend company count matches canonical bundle', frontendManifest.companyCount === bundle.companies.length, `frontend=${frontendManifest.companyCount} source=${bundle.companies.length}`);
check('frontend progress count matches canonical bundle', frontendManifest.progressCount === bundle.progress.length, `frontend=${frontendManifest.progressCount} source=${bundle.progress.length}`);
check('initial frontend data under 256 KB', initialFrontendDataBytes <= INITIAL_FRONTEND_DATA_CAP_BYTES, `actual=${initialFrontendDataBytes}`);
check('detail shard count is positive', frontendManifest.detailShards.length > 0, `actual=${frontendManifest.detailShards.length}`);
check('each detail shard under 32 KB', maxDetailShardBytes <= DETAIL_SHARD_CAP_BYTES, `actual=${maxDetailShardBytes}`);
check('frontend index bytes match manifest', indexBytesMatch, `actual=${size(`data/frontend/${frontendManifest.index.file}`)} expected=${frontendManifest.index.bytes}`);
check('detail shard bytes match manifest', detailShardBytesMatch);
check('frontend detail company count matches canonical bundle', frontendManifest.detailShards.reduce((sum, shard) => sum + shard.companyCount, 0) === bundle.companies.length);

const html = shellFiles.filter(file => file.endsWith('.html')).map(file => fs.readFileSync(path.join(SITE, file), 'utf8')).join('\n');
const scripts = shellFiles.filter(file => file.endsWith('.js')).map(file => fs.readFileSync(path.join(SITE, file), 'utf8')).join('\n');
const css = shellFiles.filter(file => file.endsWith('.css')).map(file => fs.readFileSync(path.join(SITE, file), 'utf8')).join('\n');
const externalStylesheet = /<link(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["']https?:\/\/)[^>]*>/i;
check('no external script dependency', !/<script[^>]+src=["']https?:\/\//i.test(html));
check('no external stylesheet dependency', !externalStylesheet.test(html));
check('no remote CSS imports', !/@import\s+(?:url\()?['"]?https?:\/\//i.test(css));
check('no eval usage', !/\beval\s*\(/.test(scripts));
check('no document.write usage', !/document\.write\s*\(/.test(scripts));
check('main page has skip link', fs.readFileSync(path.join(SITE, files.indexHtml), 'utf8').includes('class="skip-link"'));
check('quality page has skip link', fs.readFileSync(path.join(SITE, files.qualityHtml), 'utf8').includes('class="skip-link"'));
check('responsive viewport present', shellFiles.filter(file => file.endsWith('.html')).every(file => fs.readFileSync(path.join(SITE, file), 'utf8').includes('name="viewport"')));

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const report = {
  version: 'frontend-budget-v2',
  checkedAt: new Date().toISOString(),
  budgets: {
    shellBytes,
    htmlBytes,
    jsBytes,
    cssBytes,
    canonicalSourceBytes: sourceManifest.compressedBytes,
    canonicalSourceHardCapBytes: SOURCE_DATA_HARD_CAP_BYTES,
    canonicalSourceDensityBytes: Number(compressedSourceDensity.toFixed(1)),
    structuredCompanyCount,
    canonicalSourceChunks: sourceManifest.parts.length,
    frontendManifestBytes,
    frontendIndexBytes: frontendManifest.index.bytes,
    initialFrontendDataBytes,
    initialFrontendDataCapBytes: INITIAL_FRONTEND_DATA_CAP_BYTES,
    detailShardCount: frontendManifest.detailShards.length,
    maxDetailShardBytes,
    detailShardCapBytes: DETAIL_SHARD_CAP_BYTES,
    totalDetailShardBytes,
  },
  passed: checks.filter(item => item.ok).length,
  total: checks.length,
  allPassed: issues.length === 0,
  checks,
  issues,
};
fs.writeFileSync(path.join(ARTIFACT_DIR, 'frontend-budget-report-v1.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
console.log(`\n${report.passed}/${report.total} checks passed`);
process.exit(report.allPassed ? 0 : 1);
