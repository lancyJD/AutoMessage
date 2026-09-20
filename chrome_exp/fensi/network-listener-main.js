(() => {
  if (window.__IGX_GRAPHQL_LISTENER__) return;
  window.__IGX_GRAPHQL_LISTENER__ = true;

  const collectPosts = value => {
    const posts = [];
    const seen = new Set();
    const visit = item => {
      if (posts.length >= 50 || item == null) return;
      if (Array.isArray(item)) { for (const child of item) visit(child); return; }
      if (typeof item !== 'object') return;
      const mediaId = item.id || item.pk;
      const shortcode = item.shortcode || item.code;
      if (mediaId && shortcode && !seen.has(String(mediaId))) {
        seen.add(String(mediaId));
        posts.push({ mediaId: String(mediaId), shortcode: String(shortcode) });
      }
      for (const child of Object.values(item)) visit(child);
    };
    visit(value);
    return posts;
  };

  const publish = data => {
    const posts = collectPosts(data);
    if (!posts.length) return;
    window.postMessage({ source: 'igx-extension', type: 'IGX_GRAPHQL_RESPONSE', posts }, '*');
  };

  const isGraphql = url => String(url || '').includes('/graphql/query');
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0] && args[0].url;
    if (isGraphql(url)) response.clone().json().then(publish).catch(() => {});
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__igxGraphqlUrl = isGraphql(url) ? String(url) : null;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__igxGraphqlUrl) {
      this.addEventListener('load', () => {
        try { publish(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch (e) {}
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };
})();
