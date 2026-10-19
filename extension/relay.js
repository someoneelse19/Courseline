// Isolated-world bridge: page (inject.js) -> extension background. Accepts only messages the page itself posted
// with our tag, from this window, on this origin.
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.source !== 'courseline-capture') return;
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
    });
  } catch {
    // Extension was reloaded; the next page load re-attaches.
  }
});
