# Courseline Capture (browser extension)

Saves the Canvas data your own browsing loads, so the Courseline app can show it without an access token. Plain
JavaScript, no build step: load this folder as an unpacked extension.

**Install:** `chrome://extensions` → Developer mode → Load unpacked → this folder. Then open Courseline and follow
Settings → Connection (or type your Canvas address in the extension's popup).

**What it does**
- Reads, in your Canvas tabs, the responses Canvas's own pages already fetch (never cookies, never requests of its
  own while you browse, never writes). It keeps them only for the Canvas address you saved.
- When you confirm a sync inside Courseline, it opens Canvas pages one at a time in background tabs of your current
  window, waits until each has finished loading, and closes them.
- Credential responses (tokens) are never saved. Email addresses and similar fields are removed. Anything older than
  90 days is deleted.

**Files:** `manifest.json`, `inject.js` + `relay.js` (capture), `background.js` (storage, background tabs), `bridge.js`
(talks to the Courseline app on localhost), `popup.*` (status), `lib/` (pure logic, unit-tested).

**Tests:** `npm test` (unit) and `npm run e2e` (a real Chrome with this extension, a mock Canvas and the real app;
see `e2e/`). Manual checks: [TESTING.md](TESTING.md). The architecture and the security register are in
[../DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md).
