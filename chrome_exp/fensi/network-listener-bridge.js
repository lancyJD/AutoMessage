window.addEventListener('message', event => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'igx-extension' || data.type !== 'IGX_GRAPHQL_RESPONSE') return;
  chrome.runtime.sendMessage({ action: 'IGX_GRAPHQL_RESPONSE', posts: data.posts }).catch(() => {});
});
