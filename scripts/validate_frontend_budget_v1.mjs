import fs from 'node:fs';
import path from 'node:path';

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
  qualityJs: 'assets/quality.js',
  stylesCss: 'assets/styles.css',
  qualityCss: 'assets/quality.css',
  manifest: 'data/bundle.manifest.json',
};
for (const [name, file] of Object.entries(files)) check(`${name} exists`, fs.existsSync(path.join(SITE, file)), file);

const manifest = JSON.parse(fs.readFileSync(path.join(SITE, files.manifest), 'utf8'));
const shellFiles = [files.indexHtml, files.qualityHtml, files.appJs, files.qualityJs, files.stylesCss, files.qualityCss];
const shellBytes = shellFiles.reduce((sum, file) => sum + size(file), 0);
const htmlBytes = size(files.indexHtml) + size(files.qualityHtml);
const jsBytes = size(files.appJs) + size(files.qualityJs);
const cssBytes = size(files.stylesCss) + size(files.qualityCss);

check('static shell under 160 KB', shellBytes <= 160 * 1024, `actual=${shellBytes}`);
check('HTML under 40 KB', htmlBytes <= 40 * 1024, `actual=${htmlBytes}`);
check('JavaScript under 90 KB', jsBytes <= 90 * 1024, `actual=${jsBytes}`);
check('CSS under 45 KB', cssBytes <= 45 * 1024, `actual=${cssBytes}`);
check('compressed data bundle under 100 KB', manifest.compressedBytes <= 100 * 1024, `actual=${manifest.compressedBytes}`);
check('data chunk count under 64', manifest.parts.length <= 64, `actual=${manifest.parts.length}`);
check('data chunks have positive size', manifest.parts.every(part => Number.isInteger(part.bytes) && part.bytes > 0));
check('data chunk bytes match manifest', manifest.parts.reduce((sum, part) => sum + part.bytes, 0) === manifest.compressedBytes);

const html = shellFiles.filter(file => file.endsWith('.html')).map(file => fs.readFileSync(path.join(SITE, file), 'utf8')).join('\n');
const scripts = shellFiles.filter(file => file.endsWith('.js')).map(file => fs.readFileSync(path.join(SITE, file), 'utf8')).join('\n');
const css = shellFiles.filter(file => file.endsWith('.css')).map(file => fs.readFileSync(path.join(SITE, file), 'utf8')).join('\n');
check('no external script dependency', !/<script[^>]+src=["']https?:\/\//i.test(html));
check('no external stylesheet dependency', !/<link[^>]+href=["']https?:\/\//i.test(html));
check('no remote CSS imports', !/@import\s+(?:url\()?['"]?https?:\/\//i.test(css));
check('no eval usage', !/\beval\s*\(/.test(scripts));
check('no document.write usage', !/document\.write\s*\(/.test(scripts));
check('main page has skip link', fs.readFileSync(path.join(SITE, files.indexHtml), 'utf8').includes('class="skip-link"'));
check('quality page has skip link', fs.readFileSync(path.join(SITE, files.qualityHtml), 'utf8').includes('class="skip-link"'));
check('responsive viewport present', shellFiles.filter(file => file.endsWith('.html')).every(file => fs.readFileSync(path.join(SITE, file), 'utf8').includes('name="viewport"')));

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const report = {
  version: 'frontend-budget-v1',
  checkedAt: new Date().toISOString(),
  budgets: { shellBytes, htmlBytes, jsBytes, cssBytes, compressedDataBytes: manifest.compressedBytes, dataChunks: manifest.parts.length },
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
