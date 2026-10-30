# Courseline Capture (browser extension)

Saves the Canvas data your own browsing loads, so the Courseline app can show it without an access token. Plain
JavaScript, no build step: load this folder as an unpacked extension.

**For the `dev` branch only.** The API-token edition on `main` does not have this folder, and its app never looks for
or talks to the extension: the build leaves out `<meta name="courseline-app">`, so even an installed `bridge.js`
ignores the page. Use `dev` (and no `COURSELINE_EDITION=api`) with the extension.

**Install:** `chrome://extensions` → Developer mode → Load unpacked → this folder. Then open Courseline (on `dev`:
`npm run dev`, <http://localhost:5173>) and follow Settings → Connection (or type your Canvas address in the extension's
popup).

**Reload after a change:** the reload arrow on the card in `chrome://extensions`, then reload your Canvas tabs and the
Courseline tab (a page opened before the reload keeps the old scripts, which can no longer reach the extension). The
card's description ends with an `[Updated ...]` stamp, written by hand in `manifest.json`: update it with each change so
you can tell which copy Chrome has.

**Permissions** (`manifest.json`): `storage` and `unlimitedStorage`, plus host access to `http://localhost/*` and
`http://127.0.0.1/*` (the app). No `cookies`, `tabs`, `webRequest` or `scripting` permission. `inject.js` (in the page's
own JavaScript world) and `relay.js` load on every `https://` page because schools use their own Canvas domains; they act
only on pages that look like Canvas, and the background script keeps data only from the address you saved. `bridge.js`
loads on `localhost`/`127.0.0.1` and answers only the app (ports 5173-5180 and 4173, and the `courseline-app` meta tag).

**What it does**
- Reads, in your Canvas tabs, the responses Canvas's own pages already fetch (never cookies, never requests of its
  own while you browse). It keeps them only for the Canvas address you saved.
- **Sends the messages you write in Courseline**, and nothing else: only after a click (or Enter) on Send, only a reply
  or a new message to Canvas user ids (checked in `lib/message.js`: plain text, up to 50 recipients, up to 10 attachments
  and 25 MB in all), only to your saved Canvas. It opens your Canvas Settings page (`/profile/settings`) in a background
  tab; the extension's script in that page uploads any attachments to your "conversation attachments" folder and makes
  Canvas's documented request with the form token Canvas puts in that page (it still reads no cookies); the tab closes.
- **Reads your messages when you open Messages in Courseline** (from a click; after a reload, Messages shows **Load
  latest messages**): the newest 50 conversations of the inbox and of the sent folder and their threads (up to 100), from
  the same kind of background tab, with read-only requests that mark nothing as read (at most every two minutes, never as
  part of Sync now). Canvas's own Inbox page, when you visit it, is captured like any other page.
- Also reads what Canvas builds into the page instead of fetching it: the Grades page's assignments, scores and the class
  statistics it shows (mean, median, high, low), the course home page and other course pages, the syllabus, the
  Modules page, your display name, and which course tabs are in the menu. A tab that is not in the menu is never loaded by Canvas, so it cannot be captured; Sync now skips it and Courseline says so.
- When you confirm a sync inside Courseline, it opens Canvas pages a few at a time (4 tabs at once) in background tabs of your current
  window, waits until each has finished loading, and closes them. Unless **Essentials only** is ticked (it is not by
  default), the same Sync now also opens the pages those link to (assignment instructions, page bodies, discussions,
  quizzes, files), round after round until nothing new turns up. **Stop** closes the open tabs at once. Nothing opens
  without a click in Courseline, and nothing is scheduled.
- Credential responses (tokens) are never saved. Email addresses, login ids, avatar links and capability links (calendar
  feeds, file links with a `verifier`) are removed. Anything older than 90 days is deleted.

**Files:** `manifest.json`, `inject.js` + `relay.js` (capture; in a tab the extension opened, also sending and reading
messages), `background.js` (storage, background tabs for Sync now and Messages), `bridge.js` (talks to the Courseline app
on localhost and runs the sync loop, 4 tabs at once), `popup.*` (status, address, export), `lib/` (pure logic,
unit-tested; `lib/pullRunner.js` and `lib/message.js` are also loaded by `bridge.js`).

**Tests:** `npm test` (unit) and `npm run e2e` (a real Chrome with this extension, a
mock Canvas and the real app: start `npm run dev` on port 5173 first, and set `CHROME_PATH` if Chrome is not in
`/Applications`; see `e2e/`; it does not cover Messages). Manual checks: [TESTING.md](TESTING.md). The architecture
and the security register are in [../DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md).
