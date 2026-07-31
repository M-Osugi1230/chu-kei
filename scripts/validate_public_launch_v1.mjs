import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

async function read(path) {
  return readFile(new URL(path, ROOT), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const publicBase = 'https://chukei-insight.osugimurata.chatgpt.site/';
const [index, contact, privacy, robots, sitemap, releaseStatus, operationsStatus] = await Promise.all([
  read('site/index.html'),
  read('site/contact.html'),
  read('site/privacy.html'),
  read('site/robots.txt'),
  read('site/sitemap.xml'),
  read('site/data/release-status.json'),
  read('operations/site-sync/current.json'),
]);

assert(index.includes('<link rel="canonical" href="https://chukei-insight.osugimurata.chatgpt.site/">'), 'トップページのcanonical URLがありません。');
assert(index.includes('3,000社'), 'トップページに3,000社の公開表示がありません。');
assert(index.includes('./contact.html'), 'トップページに問い合わせ導線がありません。');
assert(index.includes('運営：Chu-kei事務局'), 'トップページに事務局表示がありません。');

assert(contact.includes('name="general-inquiry"'), '一般問い合わせフォーム名がありません。');
assert(contact.includes('data-netlify="true"'), '一般問い合わせフォームがNetlify Forms形式ではありません。');
assert(contact.includes('netlify-honeypot="bot-field"'), '一般問い合わせフォームにハニーポットがありません。');
assert(contact.includes('name="form-name" value="general-inquiry"'), '一般問い合わせフォームのhidden form-nameがありません。');
assert(contact.includes('運営：Chu-kei事務局'), '問い合わせページに事務局表示がありません。');
assert(!contact.includes('@'), '問い合わせページにメールアドレスを直接公開しないでください。');

assert(privacy.includes('Chu-kei事務局'), 'プライバシーページに運営主体がありません。');
assert(privacy.includes('./contact.html'), 'プライバシーページに問い合わせ窓口がありません。');

assert(robots.includes('User-agent: *'), 'robots.txtにUser-agentがありません。');
assert(robots.includes('Allow: /'), 'robots.txtがクロールを許可していません。');
assert(robots.includes(`${publicBase}sitemap.xml`), 'robots.txtにサイトマップURLがありません。');

for (const path of ['', 'quality.html', 'history.html', 'reports.html', 'pricing.html', 'contact.html', 'privacy.html', 'release.html']) {
  assert(sitemap.includes(`<loc>${publicBase}${path}</loc>`), `sitemap.xmlに${path || 'トップページ'}がありません。`);
}

const release = JSON.parse(releaseStatus);
const operations = JSON.parse(operationsStatus);
for (const [label, value] of [['公開データ', release], ['運用台帳', operations]]) {
  assert(value.repository.companies === 3000, `${label}の掲載企業数が3,000社ではありません。`);
  assert(value.repository.production === 0, `${label}の深掘り確認済みがPhase 0基準の0社ではありません。`);
  assert(value.repository.reAuditPool === 315, `${label}の再監査母集団が315社ではありません。`);
  assert(value.repository.templateReviewRequired === 2685, `${label}のテンプレート型が2,685社ではありません。`);
  assert(value.repository.strictEarningsReleaseReSearch === 610, `${label}の決算短信再探索対象が610社ではありません。`);
  assert(value.repository.actualCompanies === 72, `${label}の実績接続企業が72社ではありません。`);
  assert(value.repository.actualRows === 258, `${label}の実績接続レコードが258件ではありません。`);
  assert(value.repository.coverageBeta === 0, `${label}のCoverageβが0社ではありません。`);
  assert(value.repository.qualityDebt === 3000, `${label}の深掘り未完了件数が3,000社ではありません。`);
  assert(Array.isArray(value.repository.forms), `${label}のフォーム一覧がありません。`);
  for (const form of ['general-inquiry', 'spot-report-request', 'product-waitlist']) {
    assert(value.repository.forms.includes(form), `${label}のフォーム一覧に${form}がありません。`);
  }
}

assert(releaseStatus === operationsStatus, '公開データと運用台帳の内容が一致していません。');

console.log('Public launch validation passed.');
