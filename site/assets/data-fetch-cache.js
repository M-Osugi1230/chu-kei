const nativeFetch = globalThis.fetch.bind(globalThis);
const responsePromises = new Map();

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
