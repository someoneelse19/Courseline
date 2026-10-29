// Isolated-world bridge: page (inject.js) -> extension background, and, for a message the student sent from the app,
// background -> page (the page's own script makes the request; see background.js sendViaTab). Accepts only messages the page itself posted
// with our tag, from this window, on this origin.
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.source !== 'courseline-capture') return;
  if (data.type === 'mailResult') {
    try {
      chrome.runtime.sendMessage({ type: 'mailResult', nonce: data.nonce, where: String(data.where ?? ''), ok: data.ok === true, lists: data.lists, threads: data.threads, error: typeof data.error === 'string' ? data.error : undefined });
    } catch {
      /* extension reloaded */
    }
    return;
  }
  if (data.type === 'sendResult') {
    try {
      chrome.runtime.sendMessage({ type: 'sendResult', nonce: data.nonce, where: String(data.where ?? ''), ok: data.ok === true, body: data.body, error: typeof data.error === 'string' ? data.error : undefined });
    } catch {
      /* extension reloaded */
    }
    return;
  }
  if (data.type === 'idle') {
    // The page has finished loading everything it asked for. Only used by a pull waiting on this tab.
    try {
      chrome.runtime.sendMessage({ type: 'pageIdle' });
    } catch {
      /* extension reloaded */
    }
    return;
  }
  if (typeof data.url !== 'string') return;
  try {
    chrome.runtime.sendMessage({
      type: 'capture',
      url: data.url,
      body: data.body,
      operation: typeof data.operation === 'string' ? data.operation : undefined,
      variables: data.variables && typeof data.variables === 'object' ? data.variables : undefined,
      // Set for data read from the page itself rather than from an API response (see inject.js readPage).
      page: typeof data.page === 'string' ? data.page : undefined,
    });
  } catch {
    // Extension was reloaded; the next page load re-attaches.
  }
});

// Only the extension itself can send this (chrome.runtime.onMessage): pass it to the page's own script.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'courseline-send' || typeof msg.nonce !== 'string') return;
  window.postMessage({ source: 'courseline-command', type: 'send', nonce: msg.nonce, path: msg.path, payload: msg.payload, files: Array.isArray(msg.files) ? msg.files : [] }, location.origin);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'courseline-mail' || typeof msg.nonce !== 'string') return;
  window.postMessage({ source: 'courseline-command', type: 'mail', nonce: msg.nonce }, location.origin);
});
