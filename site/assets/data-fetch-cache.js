(() => {
  const nativeParse = JSON.parse.bind(JSON);
  let portalData = null;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });

  JSON.parse = function capturePortalBundle(text, reviver) {
    const value = nativeParse(text, reviver);
    if (!portalData
      && value
      && Array.isArray(value.companies)
      && Array.isArray(value.progress)) {
      portalData = value;
      resolveReady(value);
      queueMicrotask(() => {
        JSON.parse = nativeParse;
        window.dispatchEvent(new CustomEvent('chukei:portal-data-ready', { detail: value }));
      });
    }
    return value;
  };

  globalThis.ChuKeiDataBridge = Object.freeze({
    ready,
    current: () => portalData,
  });
})();
