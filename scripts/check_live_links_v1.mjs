import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const REPORT_PATH = path.join(ARTIFACT_DIR, 'live-link-report-v1.json');
const TIMEOUT_MS = Number(process.env.LINK_CHECK_TIMEOUT_MS || 15000);
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.LINK_CHECK_CONCURRENCY || 6)));
const LIMIT = Math.max(0, Number(process.env.LINK_CHECK_LIMIT || 0));
const USER_AGENT = 'Chu-kei-Link-Audit/1.0 (+https://github.com/M-Osugi1230/chu-kei)';

function readBundle() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  return JSON.parse(zlib.gunzipSync(compressed));
}
function classify(status, error) {
  if (error) return 'network_error';
  if (status >= 200 && status < 400) return 'ok';
  if (status === 401 || status === 403) return 'restricted';
  if (status === 404 || status === 410) return 'missing';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'other';
}
async function request(url, method) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': USER_AGENT,
        accept: method === 'HEAD' ? '*/*' : 'text/html,application/pdf;q=0.9,*/*;q=0.8',
        range: method === 'GET' ? 'bytes=0-2047' : undefined,
      },
    });
    if (response.body) await response.body.cancel().catch(() => {});
    return {
      status: response.status,
      finalUrl: response.url,
      elapsedMs: Date.now() - started,
      error: null,
      method,
    };
  } catch (error) {
    return {
      status: null,
      finalUrl: null,
      elapsedMs: Date.now() - started,
      error: error.name === 'TimeoutError' ? `timeout after ${TIMEOUT_MS}ms` : error.message,
      method,
    };
  }
}
async function inspect(record) {
  let result = await request(record.url, 'HEAD');
  if (result.error || [405, 501].includes(result.status)) result = await request(record.url, 'GET');
  if (result.error || result.status === 429 || (result.status && result.status >= 500)) {
    await new Promise(resolve => setTimeout(resolve, 750));
    const retry = await request(record.url, result.method === 'HEAD' ? 'GET' : result.method);
    if (!retry.error || result.error) result = retry;
  }
  return {
    ...record,
    ...result,
    classification: classify(result.status, result.error),
    checkedAt: new Date().toISOString(),
  };
}
async function mapConcurrent(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
      console.log(`${index + 1}/${items.length} ${results[index].classification} ${items[index].url}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
let data;
try {
  data = readBundle();
} catch (error) {
  const report = { version: 'live-link-audit-v1', checkedAt: new Date().toISOString(), fatalError: error.message, results: [] };
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.error(error);
  process.exit(1);
}

const companies = data.companies.filter(company => company.stage !== 'jpx_indexed');
const grouped = new Map();
for (const company of companies) {
  const url = company.sourceUrl;
  if (!grouped.has(url)) grouped.set(url, []);
  grouped.get(url).push({ code: company.code, name: company.name, stage: company.stage });
}
let records = [...grouped.entries()].map(([url, companyRecords]) => ({ url, companies: companyRecords }));
if (LIMIT) records = records.slice(0, LIMIT);
const results = await mapConcurrent(records, inspect, CONCURRENCY);
const classificationCounts = results.reduce((counts, result) => {
  counts[result.classification] = (counts[result.classification] || 0) + 1;
  return counts;
}, {});
const report = {
  version: 'live-link-audit-v1',
  checkedAt: new Date().toISOString(),
  configuration: { timeoutMs: TIMEOUT_MS, concurrency: CONCURRENCY, limit: LIMIT || null },
  summary: {
    companies: companies.length,
    checkedUrls: results.length,
    ...classificationCounts,
  },
  results,
};
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Report: ${REPORT_PATH}`);
