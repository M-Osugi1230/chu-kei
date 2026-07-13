const FRONTEND_DATA_BASE = './data/frontend/';
const EXPECTED_MANIFEST_VERSION = 'frontend-data-manifest-v1';
const EXPECTED_INDEX_VERSION = 'frontend-company-index-v1';
const EXPECTED_DETAIL_VERSION = 'frontend-company-details-v1';
const detailCache = new Map();
const shardPromises = new Map();
let manifest;

const digestHex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(byte => byte.toString(16).padStart(2, '0'))
  .join('');

async function fetchCompressedJson(descriptor, expectedVersion) {
  const response = await fetch(`${FRONTEND_DATA_BASE}${descriptor.file}`);
  if (!response.ok) throw new Error(`${descriptor.file}を取得できません。`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== descriptor.bytes) throw new Error(`${descriptor.file}の容量がマニフェストと一致しません。`);
  const digest = await digestHex(bytes);
  if (digest !== descriptor.sha256) throw new Error(`${descriptor.file}の整合性確認に失敗しました。`);
  const text = await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text();
  const payload = JSON.parse(text);
  if (payload.version !== expectedVersion) {
    throw new Error(`${descriptor.file}のデータ形式に対応していません。`);
  }
  return payload;
}

export async function loadFrontendData() {
  if (!('DecompressionStream' in window)) {
    throw new Error('このブラウザは圧縮データの展開に対応していません。最新版のブラウザでお試しください。');
  }
  const response = await fetch(`${FRONTEND_DATA_BASE}manifest.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error('フロントエンド用データマニフェストを取得できません。');
  manifest = await response.json();
  if (manifest.version !== EXPECTED_MANIFEST_VERSION) {
    throw new Error('フロントエンド用データマニフェストの形式に対応していません。');
  }
  const data = await fetchCompressedJson(manifest.index, EXPECTED_INDEX_VERSION);
  if (data.companies.length !== manifest.companyCount || data.progress.length !== manifest.progressCount) {
    throw new Error('フロントエンド用データ件数がマニフェストと一致しません。');
  }
  return data;
}

async function loadShard(file) {
  if (!manifest) throw new Error('データマニフェストが初期化されていません。');
  if (shardPromises.has(file)) return shardPromises.get(file);
  const descriptor = manifest.detailShards.find(shard => shard.file === file);
  if (!descriptor) throw new Error(`詳細シャードが見つかりません: ${file}`);
  const promise = fetchCompressedJson(descriptor, EXPECTED_DETAIL_VERSION).then(payload => {
    for (const detail of payload.companies || []) detailCache.set(String(detail.code), detail);
    return payload;
  }).catch(error => {
    shardPromises.delete(file);
    throw error;
  });
  shardPromises.set(file, promise);
  return promise;
}

export async function loadCompanyDetail(indexCompany) {
  if (!indexCompany) return null;
  const code = String(indexCompany.code);
  if (!detailCache.has(code)) await loadShard(indexCompany.detailFile);
  const detail = detailCache.get(code);
  if (!detail) throw new Error(`${code}の詳細データが見つかりません。`);
  return { ...indexCompany, ...detail, code };
}

export function clearFrontendDetailCache() {
  detailCache.clear();
  shardPromises.clear();
}
