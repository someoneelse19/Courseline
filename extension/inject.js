// Runs in the page's own JavaScript world (manifest: "world": "MAIN") so it can wrap fetch/XHR.
// Passive only: it reads responses Canvas's own frontend already asked for. It never reads cookies,
// never sends a request, and never changes what Canvas sees or receives.
//
// It is loaded on every https page because schools use custom Canvas domains, so it first decides whether the page
// IS Canvas. Until it is sure, same-origin /api/v1/ responses wait in a small in-memory buffer; if the page turns out
// not to be Canvas the buffer is thrown away and nothing ever leaves the page.
(() => {
  if (window.__courselineCapture) return;
  window.__courselineCapture = true;

  const TAG = 'courseline-capture';
  // Any Canvas API address (REST under /api/v1, /api/v2 and so on, and /api/graphql). Reads only: see report().
  const API = /^\/api\//;
  const MAX_BODY_CHARS = 4_000_000; // a response bigger than this is skipped rather than held in memory
  const MAX_BUFFER = 200;
  const GIVE_UP_MS = 4000;
  const IDLE_MS = 700; // quiet for this long after the load event = the page has finished its own requests

  // Canvas fingerprints: its body class, and the global `ENV` object its own pages define.
  function looksLikeCanvas() {
    try {
      if (document.body?.classList.contains('ic-app')) return true;
      const env = window.ENV;
      if (env && typeof env === 'object') return ['current_user_id', 'ASSET_HOST', 'DOMAIN_ROOT_ACCOUNT_ID'].some((k) => k in env);
    } catch {
      /* ignore */
    }
    return false;
  }

  let state = 'unknown'; // 'unknown' -> 'canvas' | 'other'
  let buffer = [];

  function send(item) {
    window.postMessage({ source: TAG, ...item }, location.origin);
  }

  function decide() {
    if (state !== 'unknown') return;
    if (looksLikeCanvas()) {
      state = 'canvas';
      buffer.forEach(send);
      buffer = [];
    }
  }

  function giveUp() {
    decide();
    if (state === 'unknown') {
      state = 'other';
      buffer = [];
    }
  }

  // Is the page still loading? Counts requests in flight; once the load event has fired and none has been in flight
  // for IDLE_MS, the page tells the extension it has gone quiet, so a pull can move to its next page right then
  // instead of waiting a fixed time. (Requests and responses are still only observed, never changed.)
  let inflight = 0;
  let idleTimer;
  function checkIdle() {
    clearTimeout(idleTimer);
    if (inflight > 0 || state !== 'canvas' || document.readyState !== 'complete') return;
    idleTimer = setTimeout(() => {
      if (inflight === 0 && state === 'canvas') window.postMessage({ source: TAG, type: 'idle' }, location.origin);
    }, IDLE_MS);
  }
  const started = () => void inflight++;
  const ended = () => {
    inflight = Math.max(0, inflight - 1);
    checkIdle();
  };

  document.addEventListener('DOMContentLoaded', decide);
  window.addEventListener('load', () => {
    decide();
    checkIdle();
  });
  setTimeout(giveUp, GIVE_UP_MS);

  const isApiUrl = (raw) => {
    try {
      const u = new URL(raw, location.href);
      return u.origin === location.origin && API.test(u.pathname);
    } catch {
      return false;
    }
  };

  // Canvas's own frontend responses are prefixed with `while(1);` to defeat JSON hijacking.
  const parse = (text) => JSON.parse(text.replace(/^while\(1\);/, ''));

  // GraphQL calls all share one address, so the only way to tell them apart is the operation name the page sends,
  // plus its variables (which carry the course id). Never the query text.
  const WRITE_NAME = /^(create|update|delete|destroy|set|mark|add|remove|hide|unhide|subscribe|unsubscribe|submit|post|send|upsert|save|move|reorder|toggle|dismiss|archive|restore|accept|reject)/i;

  function graphqlRequest(init) {
    try {
      if (typeof init?.body !== 'string') return {};
      const parsed = JSON.parse(init.body);
      const ops = Array.isArray(parsed) ? parsed : [parsed];
      const names = ops.map((o) => o?.operationName).filter((n) => typeof n === 'string');
      const operation = names.length ? [...new Set(names)].slice(0, 3).join(',') : undefined;
      const vars = ops.length === 1 ? ops[0]?.variables : undefined;
      const variables = vars && typeof vars === 'object' && JSON.stringify(vars).length < 2000 ? vars : undefined;
      // A GraphQL "mutation" changes something; it is not a read, so it is not captured. Normally the query text
      // says so. A persisted query sends no text, only a name, so a name that reads like a change counts too.
      const textSaysMutation = ops.some((o) => typeof o?.query === 'string' && /^\s*mutation\b/.test(o.query));
      const noText = ops.every((o) => typeof o?.query !== 'string');
      const nameSaysChange = names.some((n) => WRITE_NAME.test(n));
      return { operation, variables, mutation: textSaysMutation || (noText && nameSaysChange) };
    } catch {
      return {};
    }
  }

  // `read` gives the parsed body: from text (fetch, XHR text) or as it already is (XHR in JSON mode).
  const fromText = (text) => () => {
    if (text.length > MAX_BODY_CHARS) throw new Error('too large');
    return parse(text);
  };

  function report(rawUrl, status, read, request = {}) {
    if (state === 'other') return;
    try {
      const url = new URL(rawUrl, location.href);
      if (url.origin !== location.origin || !API.test(url.pathname)) return;
      if (status < 200 || status >= 300) return;
      // Only reads: a REST write (POST, PUT, DELETE) or a GraphQL mutation is never saved.
      const isGraphql = url.pathname === '/api/graphql';
      if (!isGraphql && request.method && request.method !== 'GET') return;
      if (request.mutation) return;
      const item = { url: url.href, status, body: read(), operation: request.operation, variables: request.variables };
      if (state === 'canvas') return send(item);
      decide();
      if (state === 'canvas') return send(item);
      if (buffer.length < MAX_BUFFER) buffer.push(item);
    } catch {
      // Not JSON or not a URL: nothing to capture, and never disturb the page.
    }
  }

  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    // The operation name (and whether it is a mutation) comes from the request body: from `init`, or, when the page
    // passed a Request object, from a copy of its body taken before fetch uses it up.
    let requestInfo = Promise.resolve(graphqlRequest(init));
    if (input instanceof Request && init?.body === undefined && method !== 'GET' && method !== 'HEAD') {
      try {
        requestInfo = input.clone().text().then((body) => graphqlRequest({ body }), () => ({}));
      } catch {
        /* body already used: no name */
      }
    }
    started();
    const result = realFetch.apply(this, arguments);
    result.then(
      (res) => {
        const url = res.url || String(input instanceof Request ? input.url : input);
        // Only a same-origin /api/ response is ever read. Everything else (video, downloads, streams, other sites)
        // is never cloned or buffered: it simply counts as finished when the response arrives.
        if (state === 'other' || !isApiUrl(url)) return ended();
        let reading;
        try {
          reading = res.clone().text();
        } catch {
          return ended();
        }
        // The body can still be arriving when the response does, so "finished" waits for it too.
        Promise.all([reading, requestInfo]).then(
          ([text, info]) => {
            report(url, res.status, fromText(text), { ...info, method });
            ended();
          },
          ended,
        );
      },
      ended,
    );
    return result;
  };

  const realSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    started();
    this.__courselineBody = typeof body === 'string' ? body : undefined;
    this.addEventListener('loadend', ended, { once: true });
    return realSend.apply(this, arguments);
  };

  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__courselineMethod = String(method).toUpperCase();
    this.__courselineUrl = String(url);
    // open() can be called again on the same object: listen once, and read whatever the latest open() set.
    if (!this.__courselineListening) {
      this.__courselineListening = true;
      this.addEventListener('load', () => {
        try {
          const request = { ...graphqlRequest({ body: this.__courselineBody }), method: this.__courselineMethod };
          const where = this.responseURL || this.__courselineUrl;
          if (this.responseType === '' || this.responseType === 'text') report(where, this.status, fromText(this.responseText), request);
          else if (this.responseType === 'json' && this.response !== null) report(where, this.status, () => this.response, request);
        } catch {
          /* ignore */
        }
      });
    }
    return realOpen.apply(this, arguments);
  };
})();
