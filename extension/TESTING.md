# Testing the extension by hand

Unit tests cover the logic (`npm test`). These steps cover what only a real browser shows. Do them after any change to
`inject.js`, `relay.js`, `bridge.js`, `background.js`, `popup.*` or the manifest, on the `dev` branch: the API-token
edition on `main` never talks to the extension (see the last safety check).

## Load it
1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder (or the reload arrow if loaded). After a
   reload, reload your Canvas tabs and the Courseline tab too: a page opened before it keeps the old scripts, which can
   no longer reach the extension.
2. The card's description ends with `[Updated <date time>]`, written by hand in `manifest.json` (update it with each
   change). If it is older than your last change, Chrome has an old copy.
3. No **Errors** button on the card.

## Passive capture
1. Reload your Canvas tab, then open the dashboard, a course, its Assignments, Grades and Modules pages.
2. Click the extension icon. Type your school's address into **Canvas address** and press **Save** (it accepts
   `https://school.instructure.com/` or just `school.instructure.com`). The popup lists your pinned courses with data.
3. **Health** has no non-zero "Unexpected format" count.

## Signing in from the app
1. On `dev`, start the app (`npm run dev`) and open `http://localhost:5173` while signed out (log out; a private window
   only works if the extension is allowed in Incognito and you sign in to Canvas in that window too).
2. The login page shows **Your Canvas address**. Type your school's address and press **Connect and load my courses**.
3. A panel appears at the bottom right of the page and shows each page loading in the background. No window opens.
   The app signs in by itself when the first data arrives.
4. Settings → **Connection** shows the checklist (extension, address, data, courses) and a Sync now button.
5. In Settings → Connection, try **Use an access token instead** and **Use the extension instead** and confirm each
   switches without a reload.

## The app connection
1. Open `http://localhost:5173` (a port in `bridge.js`'s list, and the page has `<meta name="courseline-app">`).
2. Log out if signed in with a token. With the extension installed the login page shows **Your Canvas address** first
   (the token form is under **Sign in with an access token instead**); press **Sign in with the extension** (or
   **Connect and load my courses** if nothing is captured yet).
3. The sidebar has an **Extension** item under the courses, with a dot and a word for how current the data is (Up to
   date, Partly synced, Out of date, Needs attention, Not synced yet). Open it: it shows "N of M courses synced", when
   each kind of data was last updated, and **Sync now**. It stays open or closed across reloads.
4. Settings → **Courses** → Choose your courses → pick two courses. The popup shows "Courses chosen in Courseline: 2"
   and the courses list narrows to those two.
5. Another localhost page (for example `python3 -m http.server 8000`) gets no marker: in its console,
   `document.documentElement.dataset.courselineExtension` is `undefined`.

## Everything is captured
1. After a Sync now on **Everything** depth, open Settings → Connection → **Everything captured** in the app.
2. You see groups such as `GET /courses/:id/announcements` and `GET /courses/:id/discussion_topics`, each with a
   count; open one and click an address to read the raw JSON.
3. **Download everything (JSON)** (app) or **Export everything (JSON)** (popup) saves one file with every response.
4. Confirm no response from `/jwts` or a tokens endpoint is in it.

## Sync now, refresh and pull a page
1. In the app, press **Sync now** in the sidebar's **Extension** item. The panel shows the plan ("This will open N
   Canvas pages ...") with an **Essentials only** checkbox and **Start** / **Cancel**. Nothing opens until Start.
2. **Start**. Each page moves on to the next as soon as Canvas has finished loading it (fast pages go fast, slow
   ones are given up to 12 seconds). Pages load 4 at a time, in background tabs of the current window (you may see
   them flash in the tab strip or sidebar, in Arc too), and each closes itself. The panel lists each page with how many
   responses it brought and a few item names.
3. **Stop** mid-run: the tabs still loading close at once (the panel says "Stopping after this page…" until they
   have), and nothing else opens.
4. Click a kind of data in the **Extension** item (for example the **Grades** row, "3 days ↻"; on a course page it
   refreshes that course): one page loads at once, with no confirmation step.
5. On a course page, **Refresh this course** in the **Extension** item shows that course's plan to confirm.
6. Settings → Connection → **Pull a page**: paste a page from your Canvas, or a path like `/courses/12/announcements`.
   A page on another site is refused with a message.
7. Pages that show "No data on this page" are hidden in that course, may need the tab to be visible to load part of
   their data (a background tab can load less than a foreground one: note which), or you were signed out.
8. **Linked pages**: a Sync now with **Essentials only** unticked also opens each assignment, page, discussion, quiz
   and file the captured data links to, round after round until nothing new turns up (no page limit). While some are
   left (for example after an **Essentials only** run), the **Extension** item shows "Pull N linked pages", and the
   panel offers **Pull linked pages** after a run that was not stopped; confirm it and the same rounds run. Then open an
   assignment in the app: its instructions and rubric should be filled in. If an item screen is still empty, open
   Settings → Connection → Everything captured, find that page's address, and note what shape the data has.
9. The popup's **Sync in Courseline** brings an open Courseline tab to the front and shows the plan there (no reload, so
   a run in progress is not lost); with no Courseline tab open it opens one on Settings → Connection with the plan ready
   to confirm.
10. In a course whose Canvas menu hides a tab (for example only Home, Announcements, Grades and People), open that
    course in the app: the **Extension** item lists that kind as "not in Canvas menu", its screen says it is not in this
    course's Canvas menu, and Sync now does not open that page.

## Messages
1. In the app, click **Messages** in the sidebar. "Updating messages from Canvas…" shows while your Canvas Settings
   page (`/profile/settings`) opens in a background tab and closes itself; then the inbox and sent conversations fill
   in. Reached by a reload instead of a click, Messages shows **Load latest messages** instead.
2. Open a conversation that is unread in Canvas: it is still unread in Canvas's own Inbox (threads are read with
   `auto_mark_as_read=false`).
3. Leave Messages and come back within two minutes: no tab opens.
4. Reply (Enter sends): a background tab opens and closes, and the reply shows in the thread at once and in Canvas's
   Inbox. With a file attached, the file also appears in your Canvas files under "conversation attachments".
5. **New message**: choose a course; its teachers and classmates are listed (from its People page: a course whose People
   page was never loaded says to open it or press Sync now). Send one to someone who expects it: it appears in Canvas's
   Sent folder.
6. Sign out of Canvas in this browser and press Send: Courseline says "You are not signed in to Canvas in this browser.
   Sign in to Canvas, then try again." and nothing is sent.

## Safety checks
- Visit a different Canvas-looking site or a plain site: nothing new appears in the popup.
- Save a different address in **Canvas address**: what was captured from the old one is cleared. Save it empty to
  stop capturing until you save one again (nothing is kept without a saved address).
- **Clear captured data** (click twice) empties the popup and the app goes back to the login page (**Your Canvas address**, **Connect and load my courses**), but your saved Canvas address and chosen courses stay.
- With no Canvas address saved, nothing is kept however Canvas-like a page looks: the popup says to save one.
- No send without a click: in the Courseline tab's console, a few seconds after your last click, run
  `addEventListener('message', (e) => e.data?.source === 'courseline-extension' && console.log(e.data))`, then
  `postMessage({ source: 'courseline-app', id: 't1', type: 'sendMessage', request: { kind: 'reply', conversationId: 1, body: 'test' } }, location.origin)`.
  The answer is `ok: false` with "A message is only sent from a click on Send in Courseline." and no tab opens.
- The API-token edition ignores the extension: on `main` (or `COURSELINE_EDITION=api npm run dev` on `dev`), with the
  extension still loaded, the login page shows only the token form, the sidebar has no **Extension** item, Settings has
  no extension setup, the page has no `<meta name="courseline-app">`, and
  `document.documentElement.dataset.courselineExtension` is `undefined`.
