// Usage: node live_instagram_api_check.js 127.0.0.1:PORT username
// Uses an already-open, logged-in Instagram tab through CDP. It never prints cookies or credentials.
const [cdpHttp, username] = process.argv.slice(2);
if (!cdpHttp || !username) throw new Error('Usage: node live_instagram_api_check.js 127.0.0.1:PORT username');

async function main() {
  const targets = await fetch(`http://${cdpHttp}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && /^https:\/\/www\.instagram\.com\//.test(item.url));
  if (!target) throw new Error('No Instagram page target found');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const expression = `(async () => {
    const headers = { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest', 'Accept': '*/*' };
    const posts = [];
    const seen = new Set();
    const visit = value => {
      if (posts.length >= 2 || value == null) return;
      if (Array.isArray(value)) { for (const child of value) visit(child); return; }
      if (typeof value !== 'object') return;
      const id = value.id || value.pk;
      const code = value.shortcode || value.code;
      if (id && code && !seen.has(String(id))) { seen.add(String(id)); posts.push(String(id)); }
      for (const child of Object.values(value)) visit(child);
    };
    for (const script of document.querySelectorAll('script[type="application/json"], script:not([src])')) {
      if (posts.length >= 2) break;
      const text = script.textContent || '';
      if (!text || (!text.includes('shortcode') && !text.includes('"code"'))) continue;
      try { visit(JSON.parse(text)); } catch (e) {}
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const decode = shortcode => {
      let value = 0n;
      for (const char of shortcode) {
        const digit = alphabet.indexOf(char);
        if (digit < 0) return null;
        value = value * 64n + BigInt(digit);
      }
      return value > 0n ? value.toString() : null;
    };
    for (const anchor of document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"],a[href*="/tv/"]')) {
      if (posts.length >= 2) break;
      const match = (anchor.getAttribute('href') || '').match(/\\/(?:p|reel|tv)\\/([^/?#]+)/);
      if (!match) continue;
      const id = decode(match[1]);
      if (id && !seen.has(id)) { seen.add(id); posts.push(id); }
    }
    const commentChecks = [];
    for (const mediaId of posts) {
      const response = await fetch('/api/v1/media/' + encodeURIComponent(mediaId) + '/comments/?can_support_threading=true&permalink_enabled=false', { credentials: 'include', headers });
      const data = await response.json().catch(() => null);
      commentChecks.push({ status: response.status, commentCount: Number(data && data.comment_count || 0), returnedComments: Array.isArray(data && data.comments) ? data.comments.length : 0, hasMore: Boolean(data && data.has_more_comments) });
    }
    return { source: 'current-profile-page', requestedPostCount: 2, resolvedPostCount: posts.length, commentChecks };
  })()`;
  const response = await new Promise((resolve, reject) => {
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id === 1) resolve(message);
    };
    ws.onerror = reject;
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  const exception = response.result && response.result.exceptionDetails;
  if (exception) throw new Error(exception.text || 'Runtime evaluation failed');
  console.log(JSON.stringify(response.result.result.value, null, 2));
}

main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
