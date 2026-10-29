# Courseline Capture (browser extension)

Saves the Canvas data your own browsing loads, so the Courseline app can show it without an access token. Plain
JavaScript, no build step: load this folder as an unpacked extension.

**Install:** `chrome://extensions` → Developer mode → Load unpacked → this folder. Then open Courseline and follow
Settings → Connection (or type your Canvas address in the extension's popup).

**What it does**
- Reads, in your Canvas tabs, the responses Canvas's own pages already fetch (never cookies, never requests of its
  own while you browse). It keeps them only for the Canvas address you saved.
- **Sends the messages you write in Courseline**, and nothing else: only after a click on Send, only a reply or a new
  message (checked in `lib/message.js`), only to your saved Canvas, from a Canvas tab it opens in the background,
  using the form token Canvas puts in the page (it still reads no cookies).
- **Reads your messages when you open Messages in Courseline**: the inbox, the sent folder and every thread, from a
  Canvas tab in the background, with read-only requests that mark nothing as read (at most every two minutes).
- Also reads what Canvas builds into the page instead of fetching it: the Grades page's assignments and scores, the
  course home page, the syllabus, the Modules page, your display name, and which course tabs are in the menu. A tab
  that is not in the menu is never loaded by Canvas, so it cannot be captured; Sync now skips it and Courseline says so.
- When you confirm a sync inside Courseline, it opens Canvas pages a few at a time (4 tabs at once) in background tabs of your current
  window, waits until each has finished loading, and closes them.
- Credential responses (tokens) are never saved. Email addresses and similar fields are removed. Anything older than
  90 days is deleted.

**Files:** `manifest.json`, `inject.js` + `relay.js` (capture), `background.js` (storage, background tabs), `bridge.js`
(talks to the Courseline app on localhost), `popup.*` (status), `lib/` (pure logic, unit-tested).

**Tests:** `npm test` (unit) and `npm run e2e` (a real Chrome with this extension, a mock Canvas and the real app;
see `e2e/`). Manual checks: [TESTING.md](TESTING.md). The architecture and the security register are in
[../DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md).
