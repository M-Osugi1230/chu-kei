// plan-events シード生成: registry・#288再確認の判定記録・検知スナップショットから
// operations/history/plan-events-v1.json を機械的に生成する（AI不使用・決定的）。
// recordedVia === 'detection_inbox' の既存イベントは保持する。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const REGISTRY = 'operations/plan-detection/registry-v1.json';
const RESULTS = 'operations/history/reverification-2026-11/results-by-company.json';
const SNAPSHOT = 'operations/detection/source-snapshot-v1.json';
const OUT = 'operations/history/plan-events-v1.json';

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function eventId(code, date, kind, tail) {
  const suffix = (tail || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'x';
  return `${code}-${date}-${kind}-${suffix}`;
}

const registry = loadJson(REGISTRY);
const results = loadJson(RESULTS);
const snapshot = existsSync(SNAPSHOT) ? loadJson(SNAPSHOT) : { entries: {} };

const events = [];
const seen = new Set();
function add(ev) {
  const key = `${ev.code}|${ev.date}|${ev.kind}|${ev.sourceUrl || ''}|${ev.documentSha256 || ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  events.push(ev);
}

// 1) registry: 解決済み500社の登録記録
for (const c of registry.companies) {
  if (!((c.status === 'current' || c.status === 'expired') && c.review && c.review.sourceUrl)) continue;
  const snap = snapshot.entries[c.code];
  const sha = snap && snap.state === 'ok' ? snap.sha256 : null;
  add({
    id: eventId(c.code, c.review.checkedAt, 'registered_plan', sha || c.review.sourceUrl),
    code: c.code,
    name: c.name,
    date: c.review.checkedAt,
    dateBasis: 'verified',
    kind: 'registered_plan',
    sourceUrl: c.review.sourceUrl,
    sourceTitle: c.review.sourceTitle || null,
    documentSha256: sha,
    recordedVia: 'registry_v1',
  });
}

// 2) #288 再確認の判定記録 3,000 件
for (const r of results.results) {
  const base = {
    code: r.code,
    name: r.name,
    date: r.checkedAt,
    dateBasis: 'verified',
    sourceUrl: r.sourceUrl || null,
    sourceTitle: null,
    documentSha256: r.sha256 || null,
    recordedVia: 'reverification_2026_11',
  };
  if (r.verdict === 'verified_unchanged' || r.verdict === 'verified_with_notes') {
    add({ ...base, id: eventId(r.code, r.checkedAt, r.verdict, r.sha256 || r.sourceUrl), kind: r.verdict });
  } else if (r.verdict === 'superseded_by_new_plan' && r.newerDocument) {
    const nd = r.newerDocument;
    add({
      id: eventId(r.code, nd.publishedDate || r.checkedAt, 'plan_superseded', nd.sourceUrl || r.sha256),
      code: r.code,
      name: r.name,
      date: nd.publishedDate || r.checkedAt,
      dateBasis: nd.publishedDate ? 'disclosed' : 'verified',
      kind: 'plan_superseded',
      sourceUrl: nd.sourceUrl || null,
      sourceTitle: nd.title || null,
      documentSha256: null,
      previousSourceUrl: r.sourceUrl || null,
      previousDocumentSha256: r.sha256 || null,
      recordedVia: 'reverification_2026_11',
    });
  } else if (r.verdict === 'source_url_changed') {
    add({ ...base, id: eventId(r.code, r.checkedAt, 'source_url_changed', r.sha256 || r.sourceUrl), kind: 'source_url_changed' });
  } else if (r.verdict === 'plan_withdrawn') {
    add({ ...base, id: eventId(r.code, r.checkedAt, 'plan_withdrawn', r.sha256 || r.sourceUrl), kind: 'plan_withdrawn' });
  }
}

// 3) 既存の detection_inbox 由来イベントは保持
if (existsSync(OUT)) {
  const prev = loadJson(OUT);
  for (const ev of prev.events || []) {
    if (ev.recordedVia === 'detection_inbox') add(ev);
  }
}

events.sort((a, b) =>
  a.code !== b.code ? (a.code < b.code ? -1 : 1)
    : a.date !== b.date ? (a.date < b.date ? -1 : 1)
    : a.kind < b.kind ? -1 : 1);

const out = {
  version: 1,
  note: 'Append-only plan event log. See operations/history/PLAN-EVENTS.md. Seed generated mechanically by scripts/history/build_plan_events_v1.mjs (no AI).',
  generatedFrom: ['registry_v1', 'reverification_2026_11', 'detection_snapshot_v1'],
  count: events.length,
  events,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

const byKind = {};
for (const e of events) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
console.log(`events: ${events.length}`, byKind);
