(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const nativeSetItem = Storage.prototype.setItem;
  const responsePromises = new Map();
  let portalDataPromise;

  function cacheKey(input, init = {}) {
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') return null;
    const rawUrl = typeof input === 'string' || input instanceof URL ? input : input.url;
    const url = new URL(rawUrl, location.href);
    if (url.origin !== location.origin) return null;
    if (!url.pathname.includes('/data/')) return null;
    return url.href;
  }

  globalThis.fetch = async function sharedDataFetch(input, init = {}) {
    const key = cacheKey(input, init);
    if (!key) return nativeFetch(input, init);

    if (!responsePromises.has(key)) {
      const promise = nativeFetch(input, init).then(response => {
        if (!response.ok) responsePromises.delete(key);
        return response;
      }).catch(error => {
        responsePromises.delete(key);
        throw error;
      });
      responsePromises.set(key, promise);
    }

    const response = await responsePromises.get(key);
    return response.clone();
  };

  Storage.prototype.setItem = function notifyingSetItem(key, value) {
    const previous = this.getItem(key);
    nativeSetItem.call(this, key, value);
    if (this === localStorage
      && previous !== String(value)
      && ['chukei.savedCompanies.v1', 'chukei.savedResearch.v2'].includes(String(key))) {
      queueMicrotask(() => window.dispatchEvent(new CustomEvent('chukei:saved-change', { detail: { key: String(key) } })));
    }
  };

  function loadSharedPortalData() {
    if (!portalDataPromise) {
      portalDataPromise = (async () => {
        if (!('DecompressionStream' in window)) throw new Error('圧縮データの展開に対応していません。');
        const manifest = await fetch('./data/bundle.manifest.json', { cache: 'no-cache' }).then(response => {
          if (!response.ok) throw new Error('データマニフェストを取得できません。');
          return response.json();
        });
        const buffers = await Promise.all(manifest.parts.map(part => fetch(`./data/${part.file}`).then(response => {
          if (!response.ok) throw new Error(`${part.file}を取得できません。`);
          return response.arrayBuffer();
        })));
        const bytes = new Uint8Array(buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0));
        let offset = 0;
        for (const buffer of buffers) {
          bytes.set(new Uint8Array(buffer), offset);
          offset += buffer.byteLength;
        }
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map(value => value.toString(16).padStart(2, '0')).join('');
        if (digest !== manifest.sha256) throw new Error('データ整合性の確認に失敗しました。');
        const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
        const data = JSON.parse(text);
        if (data.companies.length !== manifest.companyCount || data.progress.length !== manifest.progressCount) {
          throw new Error('データ件数がマニフェストと一致しません。');
        }
        return data;
      })().catch(error => {
        portalDataPromise = undefined;
        throw error;
      });
    }
    return portalDataPromise;
  }

  globalThis.ChuKeiDataLoader = Object.freeze({ loadSharedPortalData });
})();
