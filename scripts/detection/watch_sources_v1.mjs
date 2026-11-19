// 一次資料ウォッチ: registry の解決済み企業が持つ sourceUrl の内容ハッシュを
// 前回スナップショットと比較し、変化を operations/detection/inbox-v1.json に起票する。
// registry や公開データは変更しない。初回はベースライン作成のみ。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const REGISTRY = 'operations/plan-detection/registry-v1.json';
const SNAPSHOT = 'operations/detection/source-snapshot-v1.json';
const INBOX = 'operations/detection/inbox-v1.json';
const UA = 'Chu-kei-Insight-Detection/1.0 (+https://chu-kei.com)';
const TIMEOUT_MS = 30000;
const CONCURRENCY = 8;

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

async function fetchOne(target, prev) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target.url, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (res.status === 404 || res.status === 410) {
      return { ...target, outcome: 'gone', httpStatus: res.status };
    }
    if (!res.ok) {
      return { ...target, outcome: 'error', httpStatus: res.status };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha256 = createHash('sha256').update(buf).digest('hex');
    return { ...target, outcome: 'ok', httpStatus: res.status, sha256, bytes: buf.length };
  } catch {
    return { ...target, outcome: 'error', httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(items, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, next));
  return results;
}

const registry = loadJson(REGISTRY, null);
if (!registry) {
  console.error('registry not found');
  process.exit(1);
}
const targets = registry.companies
  .filter((c) => (c.status === 'current' || c.status === 'expired') && c.review && c.review.sourceUrl)
  .map((c) => ({ code: c.code, name: c.name, url: c.review.sourceUrl }));
console.log(`targets: ${targets.length}`);

const snapshot = loadJson(SNAPSHOT, { version: 1, generatedAt: null, entries: {} });
const inbox = loadJson(INBOX, { version: 1, entries: [] });
const isBaseline = !snapshot.generatedAt;
const now = new Date().toISOString();

const results = await runPool(targets, (t) => fetchOne(t, snapshot.entries[t.code]));
const errors = results.filter((r) => r.outcome === 'error').length;
if (errors > targets.length / 2) {
  console.error(`systemic failure suspected: ${errors}/${targets.length} fetch errors; writing nothing`);
  process.exit(1);
}

let added = 0;
function pushInbox(entry) {
  if (inbox.entries.some((e) => e.id === entry.id)) return;
  inbox.entries.push(entry);
  added++;
}

for (const r of results) {
  const prev = snapshot.entries[r.code];
  if (r.outcome === 'ok') {
    if (prev && prev.state === 'ok' && prev.sha256 && prev.sha256 !== r.sha256) {
      pushInbox({
        id: `document_changed-${r.code}-${r.sha256.slice(0, 12)}`,
        kind: 'document_changed',
        code: r.code,
        name: r.name,
        title: null,
        url: r.url,
        detectedAt: now,
        detail: { oldSha256: prev.sha256, newSha256: r.sha256, oldBytes: prev.bytes, newBytes: r.bytes },
        status: 'open',
      });
    }
    snapshot.entries[r.code] = {
      url: r.url, sha256: r.sha256, bytes: r.bytes, httpStatus: r.httpStatus,
      state: 'ok', errorStreak: 0, checkedAt: now,
    };
  } else if (r.outcome === 'gone') {
    if (prev && prev.state === 'ok') {
      pushInbox({
        id: `document_gone-${r.code}-${r.httpStatus}`,
        kind: 'document_gone',
        code: r.code,
        name: r.name,
        title: null,
        url: r.url,
        detectedAt: now,
        detail: { httpStatus: r.httpStatus, lastKnownSha256: prev.sha256 || null },
        status: 'open',
      });
    }
    snapshot.entries[r.code] = {
      url: r.url, sha256: prev ? prev.sha256 || null : null, bytes: prev ? prev.bytes || null : null,
      httpStatus: r.httpStatus, state: 'gone', errorStreak: 0, checkedAt: now,
    };
  } else {
    const streak = (prev ? prev.errorStreak || 0 : 0) + 1;
    if (prev && prev.state === 'ok' && streak === 3) {
      pushInbox({
        id: `fetch_error-${r.code}-${now.slice(0, 10)}`,
        kind: 'fetch_error',
        code: r.code,
        name: r.name,
        title: null,
        url: r.url,
        detectedAt: now,
        detail: { httpStatus: r.httpStatus, errorStreak: streak },
        status: 'open',
      });
    }
    snapshot.entries[r.code] = {
      url: r.url,
      sha256: prev ? prev.sha256 || null : null,
      bytes: prev ? prev.bytes || null : null,
      httpStatus: r.httpStatus,
      state: prev ? prev.state : 'unknown',
      errorStreak: streak,
      checkedAt: now,
    };
  }
}

snapshot.generatedAt = now;
saveJson(SNAPSHOT, snapshot);
saveJson(INBOX, inbox);
console.log(`done: baseline=${isBaseline} ok=${results.filter((r) => r.outcome === 'ok').length} gone=${results.filter((r) => r.outcome === 'gone').length} error=${errors} inboxAdded=${added}`);
