// TDnet 新規開示ウォッチ: TDnet 適時開示の日次リスト（Yanoshin TDnet Web API）から
// 中計関連の開示を抽出し、operations/detection/inbox-v1.json に起票する。
// registry や公開データは変更しない。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const REGISTRY = 'operations/plan-detection/registry-v1.json';
const SEEN = 'operations/detection/tdnet-seen-v1.json';
const INBOX = 'operations/detection/inbox-v1.json';
const UA = 'Chu-kei-Insight-Detection/1.0 (+https://chu-kei.com)';
const KEYWORDS = ['中期経営計画', '中計', '事業計画及び成長可能性に関する事項'];
const SEEN_CAP = 5000;

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function jstDate(offsetDays) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function normalize(s) {
  return (s || '').normalize('NFKC').replace(/[\s　]/g, '').replace(/株式会社/g, '');
}

function parseAtom(xml) {
  const entries = [];
  const blocks = xml.split('<entry>').slice(1);
  for (const b of blocks) {
    const title = (b.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    let link = (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    const created = (b.match(/<created>([^<]*)<\/created>/) || [])[1] || null;
    if (link.includes('rd.php?')) link = link.split('rd.php?')[1];
    if (title && link) entries.push({ title, url: link, publishedAt: created });
  }
  return entries;
}

async function fetchAtom(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  return parseAtom(await res.text());
}

let filings = [];
let source = 'dated';
try {
  const today = await fetchAtom(`https://webapi.yanoshin.jp/webapi/tdnet/list/${jstDate(0)}.atom`);
  const yesterday = await fetchAtom(`https://webapi.yanoshin.jp/webapi/tdnet/list/${jstDate(-1)}.atom`);
  const byUrl = new Map();
  for (const f of [...yesterday, ...today]) byUrl.set(f.url, f);
  filings = [...byUrl.values()];
} catch (e) {
  console.error(`dated list failed (${e.message}); falling back to recent.atom`);
  source = 'recent';
  filings = await fetchAtom('https://webapi.yanoshin.jp/webapi/tdnet/list/recent.atom');
}
console.log(`filings fetched: ${filings.length} (source=${source})`);

const registry = loadJson(REGISTRY, null);
if (!registry) {
  console.error('registry not found');
  process.exit(1);
}
const nameIndex = new Map();
for (const c of registry.companies) {
  const n = normalize(c.name);
  if (n && !nameIndex.has(n)) nameIndex.set(n, c);
}

function matchCompany(title) {
  const sep = title.search(/[:：]/);
  if (sep < 0) return null;
  // TDnet のタイトルには市場区分プレフィックス（Ｇ－ / Ｐ－ / Ｓ－）が付くことがある
  const prefix = normalize(title.slice(0, sep)).replace(/^[GPS]-/, '');
  if (nameIndex.has(prefix)) return nameIndex.get(prefix);
  for (const [n, c] of nameIndex) {
    if (n.length >= 2 && (prefix.startsWith(n) || n.startsWith(prefix))) return c;
  }
  return null;
}

const seen = loadJson(SEEN, { version: 1, urls: [] });
const seenSet = new Set(seen.urls);
const inbox = loadJson(INBOX, { version: 1, entries: [] });
const now = new Date().toISOString();
let added = 0;

for (const f of filings) {
  if (!KEYWORDS.some((k) => f.title.includes(k))) continue;
  if (seenSet.has(f.url)) continue;
  seenSet.add(f.url);
  const company = matchCompany(f.title);
  const id = `new_disclosure-${f.url.split('/').pop().replace('.pdf', '')}`;
  if (inbox.entries.some((e) => e.id === id)) continue;
  inbox.entries.push({
    id,
    kind: 'new_disclosure',
    code: company ? company.code : null,
    name: company ? company.name : null,
    title: f.title,
    url: f.url,
    detectedAt: now,
    detail: { publishedAt: f.publishedAt, matchedByName: !!company },
    status: 'open',
  });
  added++;
}

seen.urls = [...seenSet].slice(-SEEN_CAP);
saveJson(SEEN, seen);
saveJson(INBOX, inbox);
console.log(`done: keywordMatched added=${added} inboxTotal=${inbox.entries.length}`);
