# Testing the extension by hand

Unit tests cover the logic (`npm test`). These steps cover what only a real browser shows. Do them after any change to
`inject.js`, `relay.js`, `bridge.js`, `background.js` or the manifest.

## Load it
1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder (or the reload arrow if loaded).
2. The card's description ends with `[Updated <date time>]`. If it is older than your last change, Chrome has an old copy.
3. No **Errors** button on the card.

## Passive capture
1. Reload your Canvas tab, then open the dashboard, a course, its Assignments, Grades and Modules pages.
2. Click the extension icon. Type your school's address into **Canvas address** and press **Save** (it accepts
   `https://school.instructure.com/` or just `school.instructure.com`). The popup lists your pinned courses with data.
3. **Health** has no non-zero "Unexpected format" count.

## Signing in from the app
1. Open `http://localhost:5173` while signed out (log out, or use a private window).
2. The login page shows **Your Canvas address**. Type your school's address and press **Connect and load my courses**.
3. A panel appears at the bottom right of the page and shows each page loading in the background. No window opens.
   The app signs in by itself when the first data arrives.
4. Settings → **Connection** shows the checklist (extension, address, data, courses) and a Sync now button.
5. In Settings → Connection, try **Use an access token instead** and **Use the extension instead** and confirm each
   switches without a reload.

## The app connection
1. Open `http://localhost:5173` (a port in `bridge.js`'s list, and the page has `<meta name="courseline-app">`).
2. Log out if signed in with a token, then **Use the Courseline extension**.
3. The status bar shows "N of M courses synced", a freshness chip per kind of data, and **Sync now**.
4. Settings → Choose your courses → pick two courses. The popup shows "Courses chosen in Courseline: 2" and the
   courses list narrows to those two.
5. Another localhost page (for example `python3 -m http.server 8000`) gets no marker: in its console,
   `document.documentElement.dataset.courselineExtension` is `undefined`.

## Everything is captured
1. After a Sync now on **Everything** depth, open Settings → Connection → **Everything captured** in the app.
2. You see groups such as `GET /courses/:id/announcements` and `GET /courses/:id/discussion_topics`, each with a
   count; open one and click an address to read the raw JSON.
3. **Download everything (JSON)** (app) or **Export everything (JSON)** (popup) saves one file with every response.
4. Confirm no response from `/jwts` or a tokens endpoint is in it.

## Sync now, refresh and pull a page
1. In the app, press **Sync now** in the status bar. The panel shows the plan ("This will open N Canvas pages ...")
   with an **Essentials only** checkbox and **Start** / **Cancel**. Nothing opens until Start.
2. **Start**. Each page moves on to the next as soon as Canvas has finished loading it (fast pages go fast, slow
   ones are given up to 12 seconds). Pages load in background tabs of the current window (you may see them flash in the tab strip or
   sidebar, in Arc too) and each closes itself. The panel lists each page with how many responses it brought and a
   few item names.
3. **Stop** mid-run: it stops after the current page. Nothing else opens.
4. Click a freshness chip (for example "Grades: 3 days ago ↻"): one page loads at once, with no confirmation step.
5. On a course page, **Refresh this course** shows that course's plan to confirm.
6. Settings → Connection → **Pull a page**: paste a page from your Canvas, or a path like `/courses/12/announcements`.
   A page on another site is refused with a message.
7. Pages that show "No data on this page" are hidden in that course, may need the tab to be visible to load part of
   their data (a background tab can load less than a foreground one: note which), or you were signed out.
8. **Pull linked pages**: after a sync, the status bar shows "Pull N linked pages". Confirm it; each assignment,
   page, discussion, quiz and file the captured data links to opens in a background tab (80 per run). Then open an
   assignment in the app: its instructions and rubric should be filled in. If an item screen is still empty, open
   Settings → Connection → Everything captured, find that page's address, and note what shape the data has.
9. The popup's **Sync in Courseline** opens the app on Settings → Connection with the plan ready to confirm.

## Safety checks
- Visit a different Canvas-looking site or a plain site: nothing new appears in the popup.
- Save a different address in **Canvas address**: what was captured from the old one is cleared. Save it empty to
  stop capturing until you save one again (nothing is kept without a saved address).
- **Clear captured data** (click twice) empties the popup and the app shows the "not captured anything yet" message, but your saved Canvas address and chosen courses stay.
- With no Canvas address saved, nothing is kept however Canvas-like a page looks: the popup says to save one.
