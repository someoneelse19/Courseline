# Courseline — Developer Guide

The complete map of this project: what it does, how it is built, why it is built that way, and exactly where to
change things. Read this top to bottom once, then use the table of contents and the **Cookbook** (section 7) as a
reference.

**Audience:** any developer (or AI assistant) opening this codebase for the first time. No prior knowledge of Canvas
or of this project is assumed. Basic React + TypeScript is.

> Companion files: `README.md` has the short version (setup, token, Canvas API notes). Where the two disagree, this
> guide is newer. The browser extension (`dev` branch only) is described in `extension/README.md`, with manual checks in
> `extension/TESTING.md`. All of these are the same files on `main` and `dev`.

## Contents

1. [What this is](#1-what-this-is)
2. [Status: what works and what does not](#2-status-what-works-and-what-does-not)
3. [Run it](#3-run-it)
4. [How it fits together](#4-how-it-fits-together)
5. [File-by-file map](#5-file-by-file-map)
6. [Subsystems in depth](#6-subsystems-in-depth)
7. [Cookbook: how to change anything](#7-cookbook-how-to-change-anything)
8. [Canvas quirks reference](#8-canvas-quirks-reference)
9. [Security model](#9-security-model)
10. [Dependencies](#10-dependencies)
11. [Troubleshooting](#11-troubleshooting)
12. [Conventions](#12-conventions)
13. [Known gaps and ideas](#13-known-gaps-and-ideas)

---

## 1. What this is

Courseline is a **browser app that replaces the Canvas LMS student interface**. It is a React single-page app that
talks directly to your school's Canvas REST API (`https://<school>/api/v1/...`) using a personal access token, or, on the `dev` branch, from what the Courseline browser extension (`extension/`) saves
from Canvas's own pages in the student's browser. There is
**no backend of our own**: everything runs in the browser, and the only server is the Vite dev server during
development.

What it gives you over Canvas itself:

- A course page that shows **Pages and Modules as one list** (collapsible, reorderable), so it looks the same whether
  the teacher built the course from Pages or from Modules.
- An **in-app file viewer** for PDF, Word, Excel, PowerPoint, images and code, with page numbers, typed zoom and an
  explicit Download button. Nothing downloads unless you press that button.
- An **in-depth grades page** per course: grade over time, assignment groups, what-if scores, goal calculator, and an
  estimate of the class median grade.
- **Messages**: Canvas's Inbox as texting-style threads named by their subject, with replies, new messages to teachers
  and classmates, and attachments with previews.
- A **calendar** and an **All assignments** list across the selected courses, and an **AI export** tab per course (a zip
  of Markdown and file text).
- Dark mode, a **user-chosen accent color**, per-course colors and icons, and English, Spanish and Portuguese.
- (`dev` only) A **browser extension** as a second way in, for students who cannot get a token.

Stack: React 18, TypeScript (strict), Vite 6, Tailwind CSS 4, React Router 7. Tests: Vitest 5. No state library, no UI kit.

**Two editions, one codebase** (details in [Branches and editions](#branches-and-editions)): the `main` branch builds the
**API-token edition** (token sign-in only; the app never looks for or talks to the browser extension), and `dev` builds
the full app with the extension as a second way in. Only `edition.json` differs between the branches. This guide is the
same file on both, so anything that exists only on `dev` is marked so.

---

## 2. Status: what works and what does not

| Area | State |
|---|---|
| Login with Canvas token, logout | Works in both editions. Signing in with the extension instead is `dev` only (see the extension row); on `main` the login page shows only the token form (`LoginPage.apiOnly.test.tsx`) |
| Dashboard, Courses, All assignments, Calendar, per-course tabs (Pages, Assignments, Announcements, Files by unit, Grades, AI export) | Works. 12/24-hour times and the calendar's first weekday follow the computer's settings when the dev server runs on macOS (`lib/systemClock.ts`); elsewhere, and in a production build, the browser's region decides |
| Pages tab (pages + modules merged, collapse, reorder, saved per course) | Works |
| File viewer: PDF, DOCX, XLSX/XLS/CSV/ODS, PPTX, images, code | Works (tested in headless Chrome against a mock Canvas). `.xlsx`/`.xlsm` also show their own fills, fonts, borders and column widths (`lib/xlsxStyles.ts`, unit-tested in `xlsxStyles.test.ts` and `SheetTable.test.tsx`); `.xls`, `.ods` and `.csv` show their values; conditional formatting is not drawn |
| Old `.doc` / `.ppt` | Not previewable (no browser renderer exists): shows a message + Download button |
| Grades page, what-if, goal calculator, trend chart, class median estimate | Works (tested against a mock Canvas; maths unit-tested). The median is an estimate from each assignment's class median (`score_statistics`), since Canvas publishes no course median |
| Settings: language (English, Spanish, Portuguese), theme, accent color, course selection, course colors and icons | Works. The extension cards on the Connection tab are `dev` only |
| Assignment detail page, rubric, comments, **Reply box** | Works; in use by the author on real coursework; unit-tested |
| **Submitting text** | Works; in use by the author on real coursework; unit-tested |
| **Submitting files (upload)** | Implements Canvas's documented three-step flow; in use by the author on real coursework; tested in a real browser against a fake Canvas (three confirmation styles, CORS, retry). **File-storage hosts differ between schools**, so another school's Canvas may refuse browser uploads (the app says so and points to "Submit in Canvas") |
| **Messages** (Canvas Inbox as threads: reply, new message to teachers and classmates, attachments) | Works with a token: the sidebar shows the unread count (rechecked every 60 s while the tab is visible) and opening a conversation marks it read. On `dev`, also from the extension: opening Messages has it read the inbox, sending goes through a Canvas tab it opens in the background, and nothing is marked read. Endpoints, layout helpers (`lib/messages.ts`) and the extension's send checks (`extension/lib/message.js`) are unit-tested; the screen is not in the smoke test or the e2e |
| Browser extension (`dev` only: capture, background-tab sync, preview, link following, in-page data, sidebar status, sending messages) | Works, tested in a **real Chrome against a mock Canvas** (`npm run e2e`, 55 checks, including a restricted course; sending messages is not in it). **Tried against one real school's Canvas** (Oct 30, 2026): what differed from the mock is in the gotchas table ("Exceptions seen on one school") and now in the mock; other schools may differ again (see Pending) |
| API-token edition (`main`) | Works: the same app with the extension paths turned off (see [Branches and editions](#branches-and-editions)). CI builds it on every push to `main`; its login page is unit-tested with the switch mocked (`LoginPage.apiOnly.test.tsx`); every other test runs the full app |
| Announcements and discussions per course | Works in both modes (token: Canvas API; extension, on `dev`: from captured pages) |
| Automated tests | **~580 unit tests** (Vitest, in `src/` and `extension/`): API client, endpoints, grades, HTML sanitizing, cache, accent colors, the submission form, messages, spreadsheet formatting, the system clock, the API-token edition's login page, the extension's logic, the app's extension mode, and a smoke test that renders every screen except Messages against a fake Canvas. **`npm run e2e`** (`dev` only) drives a real Chrome with the unpacked extension through sign-in, sync, preview, stop, refresh, pull-a-page, linked pages, a restricted course, the popup, logout and signing back in, switching address and clearing captured data. CI runs typecheck, the unit tests and the build on every push to `main` and on pull requests, not on pushes to `dev` (the e2e needs a local Chrome, so it is run by hand) |
| Deployment | **Not supported** as-is (token lives in the browser; dev proxy is dev-only) |

The author uses the app day to day, with a token, against a real school's Canvas. The automated tests (`src/**/*.test.ts(x)`, `extension/**/*.test.js`, and `npm run e2e` with `e2e/mock-canvas.mjs`) use a fake
one. The screens and the file viewer were also checked in a real browser against a fake Canvas during development; those
browser scripts are **not part of this repository** (`App.test.tsx` covers the screens in a simulated browser, not pixels). Canvas installations differ a little from school to school, so on a
new school try a submission on a throwaway assignment first.

---

## 3. Run it

### Requirements

- **Node 22.13 or newer** (22 LTS recommended). `pdfjs-dist` declares `>=22.13 || >=24` and Vitest 5 needs
  `>=22.12`. Node 20 can still install, build and run the app (with an `EBADENGINE` warning) but **cannot run the tests**.
- A Canvas account and a personal access token, or, on `dev`, a Chrome-based browser with the extension in `extension/`
  loaded unpacked (see `extension/README.md`).
- For `npm run e2e` (`dev` only): Google Chrome (set `CHROME_PATH` if it is not in the usual macOS place).
- Internet during `npm install` (the spreadsheet library downloads from `cdn.sheetjs.com`, not from npm).

### Commands

```bash
npm install                # first time, and after package.json changes
cp .env.example .env       # then edit it (below)
npm run dev                # dev server, prints the URL (usually http://localhost:5173)
npm run typecheck          # tsc --noEmit  (strict; unused variables are errors)
npm test                   # run all tests once (Vitest); `npm run test:watch` re-runs on save
npm run build              # typecheck + production bundle in dist/
npm run preview            # serve dist/ locally
npm run e2e                # dev only: the extension end to end in a real Chrome (needs npm run dev on 5173)
./start-courseline.command # macOS: dev server on exactly 5173 (double-click works); OPEN=1 opens a tab, PORT=… another port
COURSELINE_EDITION=api npm run build   # the API-token edition, on any branch
```

If port 5173 is taken, Vite silently picks the next one (5174, ...). **Use the address printed in the terminal.** The
extension (`dev`) only talks to the app on ports 5173–5180 and 4173 (`ALLOWED_PORTS` in `extension/bridge.js`), and
`npm run e2e` expects 5173 (`APP_URL` overrides it). `start-courseline.command` uses `--strictPort`, so it stops instead
of moving. Its "already running" check looks for the page title `<title>Courseline</title>` (both editions have it) and
Vite's dev client.

### Environment variables (`.env`)

| Variable | Meaning |
|---|---|
| `VITE_CANVAS_BASE_URL` | Your school's Canvas address, e.g. `https://myschool.instructure.com`. Pre-fills the login form. **Also the dev proxy's target** — if you use the proxy, this must be correct. |
| `VITE_CANVAS_API_TOKEN` | Optional. If set (with the URL), skips the login screen. **Leave empty unless you understand the security note in [9](#9-security-model).** |
| `VITE_USE_DEV_PROXY` | `true` routes all Canvas calls through the Vite dev server (see [6.2](#62-the-api-client)). Needed when the school's Canvas blocks browser (CORS) requests, and **required for file previews at schools that do**. Restart `npm run dev` after changing. While it is on, every token-mode call goes to `VITE_CANVAS_BASE_URL`, **whatever address is typed on the login screen** (a sign-in to a fake Canvas still reaches the real one). The extension does not use it. |
| `COURSELINE_EDITION` | Optional. `api` makes `npm run dev` and `npm run build` the API-token edition on any branch (see [Branches and editions](#branches-and-editions)). Read only by `vite.config.ts`, from `.env` or the shell; not `VITE_`-prefixed, so it is not put in the bundle. Ignored when tests run. |

`.env` is git-ignored. `VITE_*` variables are **inlined into the built JavaScript** — never build for distribution
with a real token in `.env`.

### Getting a token

Canvas → Account → Settings → Approved Integrations → **+ New Access Token**. Set an expiry. Copy it immediately.
Some schools disable personal tokens; then use the browser extension on `dev` (README, "Use it without a token"), or
OAuth2, which is not implemented. The API-token edition on `main` has no way in without a token.

### Before you change anything

Run `npm run typecheck && npm test && npm run build` once so you know the starting point is green, and commit often.
All three also run in CI (`.github/workflows/ci.yml`) on every push to `main` and on every pull request; a push to `dev`
alone does not start it. When you change the extension or the screens it feeds, also run `npm run e2e` on `dev` (with
`npm run dev` running on 5173).

### Branches and editions

Two editions are built from this one codebase. The branches differ only in `edition.json`, and in what `main` leaves
out: the browser extension (`extension/`), its real-Chrome test (`e2e/`) and the `e2e` script in `package.json`.

| Branch | `edition.json` | What it builds |
|---|---|---|
| `dev` | `"apiOnly": false` | The full app: token sign-in **and** the browser extension (`extension/`) as a second way in. All work happens here. |
| `main` | `"apiOnly": true` | The **API-token edition**: sign-in by access token only, and the app never looks for or talks to the extension. `vite.config.ts` removes `<meta name="courseline-app">` from the page (so `extension/bridge.js` ignores it) and defines `__API_ONLY__`, which `src/edition.ts` exports as `API_ONLY` (see the `edition.json` row in [5](#5-file-by-file-map) for what it turns off). The browser extension's `extension/` folder, its `e2e/` test and the `e2e` script are removed (the app-side `src/extension/` stays: the app imports it, and `API_ONLY` keeps it switched off). |

The switch applies to `npm run dev` as well as `npm run build`. `COURSELINE_EDITION=api` makes either one API-only on any
branch. Tests always run the full app (Vite mode `test` ignores both switches), so every feature is tested on both
branches; `src/pages/LoginPage.apiOnly.test.tsx` mocks `API_ONLY` to test the API-token login page.

Release flow: work on `dev`, then merge `dev` into `main`.

```bash
git checkout dev        # commit here; git push origin dev (CI does not run for this push)
git checkout main
git merge --no-commit dev; git rm -r -q -f --ignore-unmatch extension e2e && git commit --no-edit
git push origin main    # starts CI: typecheck, tests, and a build of the API-token edition
git checkout dev
```

The middle line merges and then takes `extension/` and `e2e/` back out (`-f`, because the merge has just staged `dev`'s
changes there), so new or changed files there never land on `main`. When `dev` changed a file in one of them, the merge
stops with a "deleted in HEAD and modified in dev" conflict; the `git rm` resolves it. `main` also has no `e2e` line in
`package.json`'s scripts; if `dev` edits the lines next to it, that merge conflicts once: keep `main`'s scripts without
`e2e`. Any other conflict makes the
commit fail: fix it, `git add` it, and run `git commit --no-edit` again.

**Never edit `edition.json` on `dev`.** Then only `main` has changed it, and every merge keeps `main`'s version. If it
ever does change on `dev`, check after the merge that `git show main:edition.json` still says `"apiOnly": true`.

### Publishing to GitHub

`.gitignore` excludes `node_modules`, `dist`, `coverage`, `.env` (secrets), `.claude/` (local Claude Code settings), the
e2e test's generated files (`e2e/*.pem`, `e2e/.san.cnf`, `e2e/.profile/`, `e2e/screenshots/`) and editor/OS files.

The repository is on GitHub as `origin`, with both `main` and `dev` pushed. To put it in a new repository, push both
branches:

```bash
git status                              # read the list: no .env, no node_modules, no .claude
# create an EMPTY repository on github.com (start Private), then:
git remote set-url origin git@github.com:<you>/courseline.git
git push -u origin main dev
```

Checklist before making it public:

- `git ls-files | grep -E '^\.env$|\.claude|node_modules'` prints nothing.
- You have **no real token** in `.env.example` (it holds placeholders only).
- The `LICENSE` is PolyForm Noncommercial 1.0.0 (free for personal/noncommercial use; commercial use reserved to the
  copyright holder). Check the `Required Notice:` line at the top has the name you want shown publicly.
- Check the CI run for `main` goes green on GitHub (it runs on pushes to `main` and on pull requests, and installs with
  `npm ci`, which needs internet access to `cdn.sheetjs.com`).
- Remember the README's security note: this app is for personal use until the token is moved behind a backend.

---

## 4. How it fits together

### The one data path

Every piece of Canvas data follows the same route. Learn this and you can find anything.

```
 Page / component
      │  calls
      ▼
 hooks/useCanvasData.ts      one tiny hook per resource, e.g. useAssignmentGroups(courseId)
      │  calls
      ▼
 hooks/useQuery.ts           key + fetcher  →  { data, loading, error, refetch }
      │  asks
      ▼
 context/DataContext.tsx     keyed in-memory cache, 5-minute freshness, de-dupes in-flight requests,
      │                      re-renders only the components reading the key that changed
      │  calls the fetcher, which is
      ▼
 api/canvas.ts               one function per Canvas endpoint (typed with api/types.ts)
      │  calls
      ▼
 api/client.ts               fetch wrapper: auth header, pagination, rate-limit/error mapping, proxy
      │
      ▼                      (optional) Vite dev proxy  →  Canvas  https://<school>/api/v1/...
```

In extension mode (the `dev` branch only: the extension installed, no token saved) `AuthContext` builds the `api` object
with `src/extension/extensionApi.ts` (`createExtensionApi`) instead of `api/canvas.ts`. It has the same `CanvasApi` type
and answers from the snapshot that `src/extension/bridge.ts` loaded from the extension, so pages, hooks and the cache
stay the same. Calls that must reach Canvas (sending a message, loading the inbox, Sync now) are passed to the extension
through `bridge.ts`, and the extension opens Canvas pages in background tabs for them. See "Extension mode (app side)"
in [5](#5-file-by-file-map). The API-token edition (`main`) has only the token path drawn above.

Rules that keep this working:

- **Nothing outside `src/api/` calls Canvas with `fetch`.** Pages call hooks. (The file viewer's `fetch(fileUrl)` calls read *local* `blob:` copies, not Canvas.) In extension mode the app sends no API requests to Canvas: `src/extension/bridge.ts` asks the extension by `window.postMessage`.
- **API failures are returned, not thrown**: `useQuery` gives you `error`; render it with `<ErrorMessage>`. The
  `ErrorBoundary` only catches render crashes.
- **Cache keys must include every input** to the fetcher (`assignments:${courseId}`), otherwise two different requests
  share one cache slot.

### The provider stack (outermost first)

`main.tsx` → `ErrorBoundary` → `ThemeProvider` → `AuthProvider` → `BrowserRouter` → `LanguageProvider` → `PullProvider` → `App`.
Inside `App`, once logged in: `DataProvider` (with `RefreshOnNewData`) → `CourseFilterProvider` → `CourseStyleProvider` →
`FileViewerProvider` → `ExtensionPinnedSync` (left out of the API-token edition) → `Routes`.

`DataProvider` sits **inside** the auth gate on purpose: logging out unmounts it, which discards every cached response.
It is also keyed by `source:baseUrl`, so switching between the extension and a token, or to another Canvas, starts
with an empty cache. New captured data does not rebuild it: `RefreshOnNewData` calls `refreshAll()` when `dataVersion`
changes, which reloads what is on screen in place.
`FileViewerProvider` renders the single shared file-viewer modal for the whole app. `PullProvider` renders the Sync now
panel (`PullPanel`) and sits outside the auth gate.

### Rendering instructor HTML

Canvas pages, assignment descriptions and submission bodies are HTML written by other people. They always go through
`components/HtmlContent.tsx` (DOMPurify). Never use `dangerouslySetInnerHTML` on Canvas content directly. Message
bodies are plain text: `lib/messages.ts` `linkify` splits them into text and http(s) links, rendered as text and `<a>`
elements, never as HTML. Spreadsheets are drawn cell by cell as elements (`SheetTable` in `components/FileViewer.tsx`),
never as injected HTML.

### Opening files

Every Canvas file link, anywhere, calls `useFileViewer().openFile(url, name)`. The viewer looks the file up through
the API, downloads it into memory, and renders that local copy. See [6.9](#69-the-file-viewer). In extension mode there
is no token to download with, so `openFile` opens the file in Canvas in a new tab instead (`dev` only).

---

## 5. File-by-file map

The app lives in `src/` (about 13,200 lines of app code, plus about 4,400 lines of tests next to it). The browser
extension is in `extension/` (about 3,800 lines of plain JS, including its tests) and its end-to-end test in `e2e/`.
Config files sit in the project root.

### Root

| File | Purpose |
|---|---|
| `index.html` | HTML shell. Carries `<meta name="courseline-app">`, which tells the extension's `bridge.js` that this page is the app (the API-token build removes it). Contains an **inline script** that applies the saved dark mode and accent color *before first paint* (prevents a flash), after moving settings saved under the app's old name (`better-canvas.*` keys) to `courseline.*`. Keep it in sync with `ThemeContext.tsx`. |
| `edition.json`, `src/edition.ts` | The edition switch. `"apiOnly": true` (the `main` branch), or `COURSELINE_EDITION=api` at build time, makes the API-token edition: `vite.config.ts` defines `__API_ONLY__`, drops `<meta name="courseline-app">` (so `extension/bridge.js` ignores the page), and `API_ONLY` turns off `extensionInstalled()`, the extension sign-in, the sidebar status, the pinned-course sync, the extension's "open the plan" request and the Settings extension cards. Tests always run the full app (`mode === 'test'`); `LoginPage.apiOnly.test.tsx` mocks the switch. Keep `edition.json` out of `dev` → `main` merges' conflicts by never editing it on `dev`. |
| `vite.config.ts` | Vite + React + Tailwind plugins, and the Vitest config (jsdom; runs `src/**/*.test.{ts,tsx}` and `extension/**/*.test.js`). Defines the optional **dev proxy** (`/canvas-proxy` → `VITE_CANVAS_BASE_URL`, with `followRedirects`; only when `VITE_USE_DEV_PROXY=true`), the CSP meta tag (from `lib/csp.ts`), the `courseline-clock` meta tag (dev server only: the Mac's time settings, from `lib/systemClockServer.ts`), and the edition: `__API_ONLY__`, plus removing `<meta name="courseline-app">` in the API-token edition (see `edition.json`). Raises the chunk-size warning to 1,400 KB because the file viewers are separate, lazily loaded chunks. |
| *(no `tailwind.config.js`)* | Tailwind 4 is configured in CSS, in `src/index.css` (`@theme`, `@custom-variant`, `@source`), and runs as a Vite plugin. There is no PostCSS config either. |
| `tsconfig.json` | Strict TypeScript, **`noUnusedLocals` and `noUnusedParameters` on** (an unused import fails the build). |
| `.env`, `.env.example` | Environment (see [3](#3-run-it)). |
| `package.json`, `package-lock.json` | Scripts (`dev`, `build`, `preview`, `typecheck`, `test`, `test:watch`, and `e2e` on `dev` only), dependencies, and Node 22.13 or newer (`engines`). The lock file pins the exact versions `npm ci` installs. |
| `start-courseline.command` | macOS launcher (double-click it, or `./start-courseline.command`). Finds Node 22.13 or newer (on `PATH`, then nvm, Volta, fnm, Homebrew, `/usr/local` and Raycast's bundled Node), says so and stops if Courseline is already running on the port (the page has the title `<title>Courseline</title>`, which both editions have, and Vite's client answers), stops if something else holds the port, and starts Vite on 5173 with `--strictPort` (the extension only talks to 5173-5180 and 4173). `PORT=` picks another port; `OPEN=1` also opens a browser tab. Gives Vite an input that stays open when there is no terminal. It runs whichever edition the checked-out branch has. |
| `e2e/` | End-to-end test of the extension in a real Chrome (`npm run e2e`, with `npm run dev` already running; `CHROME_PATH` if Chrome is not in the usual macOS place). `run.mjs` holds the checks, `harness.mjs` starts Chrome with the unpacked extension and drives it, `cdp.mjs` is a dependency-free DevTools Protocol client, and `mock-canvas.mjs` is a fake Canvas over HTTPS. The certificate, browser profile and screenshots it makes are git-ignored. `dev` only: `main` has no `e2e/` (nor the extension it tests). |
| `public/favicon.svg` | The browser-tab icon (`index.html` links it). |
| `DEVELOPER_GUIDE.md` | This guide: architecture, every file, how to change things, Canvas quirks, the security model and known gaps. The same file on `main` and `dev`. |
| `README.md` | The public overview: the two editions (`main` is API-token only, `dev` adds the extension), what it does, screenshots, using it without a token (`dev` only), setup, security, status, Canvas API notes, license and contributing. |
| `.github/workflows/ci.yml` | CI: `npm ci`, typecheck, tests, build on Node 22, on pushes to `main` and on every pull request (a push to `dev` alone does not run it). The build step builds whichever edition the branch's `edition.json` says; the tests always run the full app. |
| `.gitignore` | Keeps `.env` (and `.env.local` variants), `node_modules`, `dist`, `coverage`, `.claude/`, logs, OS/editor files and the e2e test's generated certificate, browser profile and screenshots out of Git. |
| `.claude/` | Claude Code settings for this folder (git-ignored; not part of the app). |
| `docs/screenshots/` | The README's images. They were taken from a fake Canvas with made-up course data. |
| `LICENSE` | PolyForm Noncommercial 1.0.0. |

### `src/api/` — talking to Canvas (no React in here)

| File | Purpose |
|---|---|
| `client.ts` | Low-level HTTP: `get`, `getAll` (pagination), `send` (POST/PUT/DELETE), `getBlob` (file bytes), `uploadFile` (Canvas's three-step upload, with optional extra fields such as the attachments folder), error classification (`CanvasApiError`; kind `hidden` is used only by the extension's API), `normalizeBaseUrl` (also upgrades `http://` to `https://`, except localhost), `isCanvasOrigin` (the token is only sent to the Canvas address), `downloadTarget`. |
| `canvas.ts` | One function per endpoint, collected in `createCanvasApi()`. **Add new endpoints here.** Contains the long comments on Canvas quirks, and the inbox endpoints (see [6.3](#63-endpoints-in-use)). `CanvasApi` is its return type. `src/extension/extensionApi.ts` implements the same type, so a new endpoint has to be added there too or the type check fails (on both branches, since the code is shared). |
| `types.ts` | TypeScript types for the Canvas responses we use (only the fields we read), including the inbox: `Conversation`, `ConversationMessage`, `MessageAttachment`, `ConversationParticipant`, `MailScope`, `Recipient`, and `NewMessage` (what the compose form sends). |

### `src/context/` — app-wide state

| File | Purpose |
|---|---|
| `AuthContext.tsx` | Sign-in and where data comes from; builds the `api` object. With a token: credentials in localStorage (`courseline.credentials`, else the `.env` values), the profile check, `createCanvasApi`, and logout on any 401. With the extension installed, no token saved and the extension not skipped (`dev` only): the extension's snapshot through `src/extension/bridge.ts`, loaded again 1.5 s after the extension reports a change, and `createExtensionApi` (see "Extension mode (app side)" below). Exposes `source` (`'token'` or `'extension'`), `snapshot`, `dataVersion` (changes with each new snapshot), `extensionAvailable` and `enableExtension()`. `useAuth()`, `useApi()`. In the API-token edition `extensionInstalled()` is always false, so only the token path runs. |
| `DataContext.tsx` | The keyed response cache behind `useQuery` (`QueryStore`; freshness, `ensure` and `prime` in [6.4](#64-cache-and-hooks)). `refreshAll()` marks everything stale, then reloads what is on screen in place, for when the extension captured something new. `useQueryStore()`. |
| `ThemeContext.tsx` | Dark/light mode **and** custom accent color. `useTheme()`. |
| `CourseStyleContext.tsx` | The user's own color and icon per course (Settings → Course colors and icons, which lists only the courses selected under Choose your courses), saved in localStorage. `useCourseStyles()`; read through `useCourseColors()` / `useCourseIcons()`. |
| `LanguageContext.tsx` | The app language (English, Spanish or Brazilian Portuguese): saved choice, else the browser's. `useLanguage()`. Changing it remounts the tree so every `t()` call re-renders. |
| `src/i18n/index.ts`, `src/i18n/es.ts`, `src/i18n/pt.ts` (not in `context/`) | `t('English text', { vars })` and the Spanish and Brazilian Portuguese dictionaries; `getLocale()` gives the date/number locale (`pt-BR` for Portuguese). English text is the key; a missing key falls back to English. |
| `CourseFilterContext.tsx` | Which courses to show (Settings → Choose your courses), saved as `courseline.selected-courses`. `useCourseFilter()`; `useOptionalCourseFilter()` returns null outside the provider (the login page). In extension mode `components/ExtensionPinnedSync.tsx` sends the same choice to the extension, and Sync now plans only those courses (not in the API-token edition). |
| `FileViewerContext.tsx` | The shared viewer modal. `useFileViewer().openFile(...)`. In extension mode (no token, so no download) it opens the file in Canvas in a new tab instead. |
| `PullContext.tsx` | Sync now, for the extension (`dev` only). Every request that makes the extension open Canvas pages goes through it: `requestSync` (the chosen courses; with "everything" it then opens the pages they link to, round after round, until nothing new turns up), `requestDeepSync` (Pull linked pages), `refreshCourse`, `refreshKind` (one kind of data) and `pullAddress` (one address typed in Settings). Shows the plan, Start, the live preview and Stop in `components/PullPanel.tsx`; plans come from `extension/pullPlan.ts` and `extension/linkDiscovery.ts`. `usePull()`. Mounted in `main.tsx` outside the auth gate. In the API-token edition the buttons that open it are hidden and it ignores the extension's "open the plan" request, but Settings → Connection with `?sync=1` still calls `requestSync`. |

### `src/hooks/`

| File | Purpose |
|---|---|
| `useQuery.ts` | Generic fetch-and-cache hook. |
| `useCanvasData.ts` | One-line hooks per resource: `useCourses`, `useVisibleCourses`, `useCourse`, `useAssignments`, `useAllAssignments`, `useAssignment`, `useMySubmission`, `useModules`, `useModuleItems`, `usePage`, `usePages`, `useCourseFiles`, `useAssignmentGroups`, `useUpcoming`, `useAnnouncements`, `useDiscussions`, and for Messages `useConversations(scope)`, `useConversation`, `useUnreadCount`, `useCourseRecipients`. Also `useCourseColors()` / `useCourseIcons()`. |

### `src/lib/` — pure logic (no React)

| File | Purpose |
|---|---|
| `grades.ts` | The grade maths (group weights, drop rules, what-if, trend, goal solver, and `medianComparison`, the class median estimate) and `toModel` (Canvas assignment groups → the model). See [6.10](#610-grades). Fully unit-testable. |
| `accent.ts` | Accent presets and the function that turns one hex color into a full 11-step palette. |
| `pptxFix.ts` | `applyMasterBodyStyles()`: before a PowerPoint file is previewed, copies the master's body text style (bullets, sizes) into empty body placeholders and top-anchors them, because pptx-preview never reads `<p:bodyStyle>` (it only does titles). Returns the original bytes if there is nothing to do or the file can't be read. |
| `htmlToMarkdown.ts` | Canvas HTML → Markdown (headings, lists, tables, links, equations as LaTeX, image descriptions). |
| `extractText.ts` | Text out of downloaded files: plain/code/HTML, PDF (pdf.js), Word and PowerPoint (zip + XML, including speaker notes), spreadsheets. Returns null when there is none. |
| `courseExport.ts` | Pure: turns the gathered course data into the export's documents (README, ALL_TEXT, syllabus, units, pages, assignments, file text, manifest) and rewrites Canvas links to the local copies. |
| `courseExportRunner.ts` | `scanCourse()` reads the course from Canvas; `packExport()`/`buildExportZip()` download files, extract text and zip. Cancellable, 3 downloads at a time. |
| `format.ts` | Dates (in the app language, with the computer's 12/24-hour clock through `withClock`), relative times (`formatAgo`, and `formatAgoShort` for narrow columns), grades, byte sizes, `courseIdFromContext`. |
| `systemClock.ts`, `systemClockServer.ts` | The computer's 12/24-hour clock and first weekday. Browsers don't expose them (Chrome on a Mac ignores the 24-hour switch), so the dev server reads them with `defaults read -g` (macOS only) into `<meta name="courseline-clock">` on every page load; elsewhere, or in a production build, the browser's region decides. `withClock(options)` adds the `hourCycle` to any format that shows the hour; `weekStartDay()` sets the calendar's first column. |
| `courseIcons.ts` | The icon keys/names a course can use (drawings are in `components/icons.tsx`). |
| `courseColor.ts` | Unique per-course colors: handed out by a course's position among all the user's courses (12 curated, then generated), so no two courses share one. Read through the `useCourseColors()` hook; used by course cards, the sidebar, the calendar and multi-course assignment lists. |
| `html.ts` | Reading Canvas HTML without rendering it: `linkedFiles` (file links in a description or page), `fileLinkName`, `htmlText`. |
| `assignmentState.ts` | The one color scheme for assignments: `assignmentTone` and `TONE_CLASSES` (red missing, blue to do, green handed in), `isDone`, `isFaded` (finished work that is past due or undated), `assignmentDate` (due date, else when it was handed in, else when it was posted), and `sortAssignments` (upcoming soonest first, then past most recent first, fully undated last). Used by the calendar, the grades page and assignment lists. |
| `calendar.ts` | `monthGrid(year, month, weekStart)`: the whole weeks a month view shows, starting on the given weekday (the calendar passes `weekStartDay()`). `dateKey()`: a local-time `YYYY-MM-DD` key, never UTC. |
| `csp.ts` | `contentSecurityPolicy(dev)`: the Content-Security-Policy that `vite.config.ts` puts first in `<head>`, plus the reasons for what it cannot block (`'unsafe-inline'` scripts, `connect-src https:`). Loosen it here if a viewer breaks. |
| `messages.ts` | Pure helpers for Messages: `mergeFolders` (inbox and sent in one list, each conversation once, newest first, unread if the inbox says so), `threadDays` (bubbles grouped by day, runs by one person split after 10 minutes), `chatName` / `peopleLabel` / `otherPeople` (a conversation is named by its subject, else by who it is with), `attachmentKind` (icon and preview type), `linkify` (plain text and http(s) links; bodies are never HTML), `listTime` / `dayHeading` / `timeOf`, and `composeTarget` (reads Canvas's `/conversations?context_id=…&user_id=…` compose link). |
| `xlsxStyles.ts` | `readWorkbookStyles`: the spreadsheet formatting SheetJS's free edition does not read, from an .xlsx/.xlsm file's `xl/styles.xml`, theme and sheet XML (what it covers: [6.9](#69-the-file-viewer)). Returns null when the file is not such a zip, so .xls, .ods and .csv show values only. Drawn by `SheetTable` in `components/FileViewer.tsx`. |

### `src/pages/` — one file per screen (routes in `App.tsx`)

| File | Screen |
|---|---|
| `MessagesPage.tsx` | Messages (`/messages`, `/messages/:id`, `/messages/new`; Canvas's `/conversations?context_id=…&user_id=…` compose link redirects here). One conversation list, received and sent together like a texting app (`mergeFolders`: Canvas's inbox and sent folder, each conversation once, newest activity first), the thread as bubbles (yours on the right, day separators, runs by one person), a reply box that sends on Enter (Shift+Enter for a new line) with a paperclip for attachments (up to 10 files, 25 MB in all), and New message (course → its teachers and classmates, with a search for classmates → subject → message). A conversation is named by its subject, like a group chat (`chatName`), with who it is with underneath. Shown full-bleed (`Layout` drops the page padding for it). Opening an unread conversation marks it read, with a token only (the extension version leaves read state to Canvas). Attached images that have a link show as thumbnails and every other attachment as a file card, both opened through `openFile` (the viewer with a token, Canvas in a new tab in extension mode); a card with no file link (the extension version leaves those out) opens the Canvas Inbox. In extension mode, opening Messages first has the extension read the inbox (see "Messages (extension mode)" below). Layout helpers in `lib/messages.ts`. |
| `DashboardPage.tsx` | `/` — welcome, upcoming assignments, first four courses, grades card. |
| `CoursesPage.tsx` | `/courses` — all visible courses as cards. |
| `AssignmentsPage.tsx` | `/assignments` — pending/done tabs across all visible courses. |
| `CourseExportPage.tsx` | `/courses/:id/export` — the **AI export** tab: scan the course, choose options (file text, original files, size limit), build and download a zip. All in the browser; nothing is uploaded. |
| `CalendarPage.tsx` | `/calendar` — month grid of assignments due across the visible courses (via `useAllAssignments`); click a day to list it. Weeks start on the computer's first weekday (`weekStartDay()` in `lib/systemClock.ts`), else the region's; if neither is known, Monday in Spanish and Sunday otherwise. Pure date maths in `lib/calendar.ts`; item colors come from `lib/assignmentState.ts` (red = missing, pastel blue = to do, pastel green = submitted/graded/excused; submitted work past its due date is faded). Lists are ordered by `sortAssignments()` (upcoming soonest first, then past most recent first; an undated assignment is placed by its post date, one handed in with no due date by when it was handed in and shown grayed out, fully undated ones last). The same scheme colors the status badges in every assignment list and the per-course grades table. |
| `SettingsPage.tsx` | `/settings` — tabs (open one kept in `?tab=`): **Connection** (how data arrives, **Use the extension instead** and **Log out**; the **Browser extension** card, `components/CanvasConnection.tsx`: without the extension the install steps, with it the checklist, Canvas address, Sync now and the courses to sync; with the extension installed, **Pull a page** (one pasted Canvas address, `PullContext.pullAddress`) and **Everything captured** (`components/CapturedDataBrowser.tsx`); in extension mode, **Use an access token instead**; the default tab when the extension is installed; in the API-token edition only the first card, with the token's Canvas host and Log out), **Appearance** (Language, Theme, Accent color) and **Courses** (course colors and icons, then course selection). Add a section to a tab, or a tab to `TABS`. |
| `LoginPage.tsx` | Shown whenever there are no valid credentials. With the extension installed it leads with **Your Canvas address → Connect** (saves the address, switches to the extension, loads the essentials in background tabs with a preview in the page when nothing is captured, and signs in by itself when data arrives); the token form is one click below. Without the extension it leads with the token form, with **No access token? Use the browser extension** (the install steps) folded below. In the API-token edition (`API_ONLY`) it shows the token form only, even when the extension is installed. Both use `components/CanvasConnection.tsx` and `components/TokenForm.tsx`. |
| `CoursePagesPage.tsx` | `/courses/:id` (default tab, "Pages") — pages and modules merged. |
| `CourseDetailPage.tsx` | `/courses/:id/assignments` — the "Assignments" tab. |
| `CourseAnnouncementsPage.tsx` | `/courses/:id/announcements` — the "Announcements" tab: the course's announcements, then its discussions, each a collapsible item with a short preview, the instructor's HTML (through `HtmlContent`), the reply count and "Open in Canvas ↗" (replies are not loaded here). |
| `CourseFilesPage.tsx` | `/courses/:id/files` — "Files by unit"; also exports `UnitItems`, reused by the Pages tab. |
| `CourseGradesPage.tsx` | `/courses/:id/grades` — the in-depth grades page. |
| `AssignmentDetailPage.tsx` | `/courses/:id/assignments/:aid` — instructions, files, details, submission form, your submission, feedback + reply, rubric. |
| `SubmissionViewPage.tsx` | `/courses/:id/assignments/:aid/submission` — full view of your submission. |

### `src/components/`

| File | Purpose |
|---|---|
| `Layout.tsx` | App shell (header, sidebar, routed page). **The only place page padding lives.** Messages (`/messages…`) gets none: it is shown full-bleed and its panes scroll on their own. |
| `icons.tsx` | Shared inline-SVG icons: `navIcons` for the sidebar, the course icon set, `<CourseIcon courseId>` (the chosen icon in the chosen color). Add a course icon: key in `lib/courseIcons.ts`, drawing here. |
| `Header.tsx`, `Sidebar.tsx` | Top bar (menu, user, log out); left navigation: Dashboard, All assignments, Calendar and Messages (with an unread badge, up to "99+", refetched every 60 s while the tab is visible and when it becomes visible again: Canvas's unread count with a token, the captured unread inbox conversations in extension mode), the chosen courses, `ExtensionStatus` under them (left out of the API-token edition), and Settings at the bottom. Sidebar icons are inline SVGs in `navIcons` in `components/icons.tsx` (no icon library); add one there for a new item. The dark/light toggle lives only on the Settings page. |
| `CourseLayout.tsx`, `CourseTabs.tsx` | Per-course title/grade header and the tab strip. **Add course tabs in `CourseTabs.tsx`.** |
| `CourseCard.tsx`, `GradeSummary.tsx`, `AssignmentList.tsx` | Reusable list/card pieces. `AssignmentList` also exports `assignmentStatus()`. |
| `HtmlContent.tsx` | Sanitized rendering of Canvas HTML; intercepts file links. |
| `FileViewer.tsx` | The viewer: all file-type renderers, zoom, page tracking (~1,000 lines; only `src/extension/extensionApi.ts` is longer). Also exports `SheetTable`, the spreadsheet grid (see [6.9](#69-the-file-viewer)). |
| `FileViewerModal.tsx` | The overlay around the viewer (Esc, click-outside, body scroll lock). Loads `FileViewer` the first time a file is opened. |
| `GradeTrendChart.tsx` | The SVG line chart on the grades page. |
| `SubmissionForm.tsx` | Text / file submission UI. Uploads every file, then submits all their ids together. The text tab uses `RichTextEditor`. |
| `RichTextEditor.tsx` | Dependency-free rich text box (contentEditable + `execCommand`): bold/italic/underline, lists, quote, link. Pastes as plain text. Exports `cleanEditorHtml()` (DOMPurify allow-list; always run output through it) and `isEditorEmpty()`. |
| `ErrorBoundary.tsx` | Catches render crashes. |
| `ui.tsx` | `Spinner`, `ErrorMessage` (shows a `CanvasApiError` of kind `hidden`, a tab missing from Canvas's course menu, as a neutral note, not an error), `Card`, `EmptyState`, `PageTitle`. |
| `TokenForm.tsx` | Sign in with a Canvas URL (prefilled from `VITE_CANVAS_BASE_URL`) and an access token (`login()`), with the localStorage warning. Used on the login page and in Settings → Connection. |
| `CanvasConnection.tsx` | Getting data in through the extension. Without it: the install steps. `variant="login"`: **Your Canvas address → Connect** (saves the address, switches to the extension, loads the essentials in background tabs when nothing is captured, signs straight in when data is already there). `variant="settings"`: a checklist (extension connected, Canvas address with Save address, your Canvas data with Sync now, the courses to sync). Not shown in the API-token edition. |
| `PullPanel.tsx` | The Sync now panel, bottom right, never blocking the page; rendered by `PullProvider` (`context/PullContext.tsx`). Phases: confirm (the plan, **Essentials only**, Start, Cancel), running (a line per page with sample names, Stop), done (what happened). |
| `ExtensionStatus.tsx` | The sidebar item described under "Extension mode (app side)" below: collapsed, a status dot and words; opened, coverage, Sync now, **Pull N linked pages**, per-kind freshness chips (each refreshes its page), this course and warnings. Renders nothing unless the data comes from the extension. |
| `ExtensionPinnedSync.tsx` | Renders nothing. In extension mode, sends the courses chosen in Settings → Choose your courses to the extension (`setPinnedCourses`) whenever they differ from its `appPinned`. Not mounted in the API-token edition. |
| `CapturedDataBrowser.tsx` | Settings → Connection → Everything captured: every captured response grouped by kind, or by address shape when there is no reader (`groupCaptured`), the raw JSON of each one click away (`previewJson`, cut at 20,000 characters), and **Download everything (JSON)** (`buildCaptureExport`). |

### `extension/` — the browser extension (plain JS, no build step; load unpacked in Chrome)

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest. Permissions: `storage` and `unlimitedStorage` only; host permissions for `localhost`/`127.0.0.1` only. Capture scripts run on every https page and decide for themselves whether it is Canvas; `bridge.js` runs only on localhost. `lib/pullRunner.js` and `lib/message.js` are web-accessible to localhost pages, because `bridge.js` imports them. The description says it also reads and sends your messages when you use Messages in Courseline, and ends with the time it was last changed, to tell which copy Chrome loaded. |
| `inject.js` (page world) / `relay.js` | Passive capture: wraps `fetch`/XHR, keeps every Canvas `/api/` read (REST and GraphQL, through `fetch(url)`, `fetch(Request)` or XHR in text or JSON mode; never a write, and never a GraphQL mutation: recognised by its query text, or for a persisted query with no text, by a name that reads like a change) the page itself asked for, buffers them until the page is recognised as Canvas (body class `ic-app` or an `ENV` object), then forwards. Requests to anything else (another site, or a non-`/api/` address) are only counted for the idle signal: their bodies are never copied or parsed, and their responses never cloned. Reads no cookies, and while capturing it starts no requests. The only requests it makes are for two Messages commands `relay.js` passes it from `background.js`, in a Canvas tab the extension opened: `mail` (GETs only) and `send` (one reply or new message, to the two conversation endpoints only; attachments uploaded first); see "Messages (extension mode)" below. Both answer with `where` (the page's host and path), so the background can tell its Canvas page from a login screen. **It also reads what Canvas builds into the page itself** (`readPage`), because some data never crosses `/api/`: the student Grades page fetches no assignments or scores (they are in `window.ENV.assignment_groups` / `ENV.submissions`, the assignment and group names only in the `#grades_summary` table), the course home's front page is `ENV.WIKI_PAGE`, the syllabus is `ENV.SYLLABUS_BODY`, the Modules page draws its modules into the HTML (`#context_modules`; each item's `<CanvasModel>_<contentId>` class gives its type and content id), which tabs the course menu shows is only in `#section-tabs`, an assignment's own page is drawn on the server (it makes no API call for the assignment), and who is signed in is `ENV.current_user`. These are sent with a `page` field, one of eight kinds (`PAGE_KINDS` in `lib/capture.js`): `gradesPage`, `wikiPage`, `syllabus`, `modulesPage`, `courseNav`, `assignmentPage` and `listPage` at `https://<host>/courses/<id>#page:<kind>`, and `currentUser` (only the id and display name) at `https://<host>/#page:currentUser`. `gradesPage` also carries `group_weighting_scheme` (from ENV) and `canvas_total`: the "Total" row's text (`#submission_final-grade .grade`) read with `parseShownNumber`, only when it holds a `%` and exactly one number, between 0 and 1000; a hidden total or a points-only display gives nothing. Canvas's own JavaScript fills that cell in from ready handlers that run after `readPage` (which runs at `DOMContentLoaded`), so `readLatePage` reads the total again on the load event and when the page goes quiet, and sends the whole `gradesPage` again when the total appeared or changed (`readLateTotal`). `assignmentPage` (`/courses/<id>/assignments/<aid>`, only when `ENV.ASSIGNMENT_ID` and `ENV.COURSE_ID` match the address and `#assignment_show` is there): the id, the title (`h1.title`), the instructions HTML (`.description.user_content`, without Canvas's screen-reader text; `''` when empty, left out when the element is missing), the points from `ENV.ASSIGNMENT_POINTS_POSSIBLE` and the rubric from `ENV.assigned_rubric` (its `criteria` or `data`, in the API's rubric shape; one it cannot read is sent as `rubric_unreadable: true`). Never the localized date text (`.display_date`, `.display_time`, `.date_text`, `.student-assignment-overview`) and never a date: due dates come from the Grades page's ENV and planner items. Filed one per assignment (key `:a<id>`). `listPage` (`{ path }`, `announcements` or `discussion_topics`) is sent only when the page that landed really is that list (`location.pathname`), so a redirect to the course home never counts; the extension cannot see where a tab landed otherwise (`visited` keeps the address it asked for). The Grades page is read only when it is the signed-in student's own (`/courses/<id>/grades`, or `/grades/<their id>`; never an observer's view), with the grading period it showed; the class statistics under each assignment (`table#score_details_<id>`) are read by position, each number by its own shape (a Spanish page still writes `6.88`, so the page's language is not used), and the app keeps them only when they are in order (`sensibleStatistics`). Still passive: what is already on the page, once it is known to be Canvas. `relay.js` (isolated world) forwards captures, `idle` (as `pageIdle`), `mailResult` and `sendResult` to `background.js`, accepting only messages this window posted on its own origin, and passes `courseline-send` / `courseline-mail` from the background to the page script. |
| `background.js` | Classifies each response (`lib/capture.js`), stores it as `cap:<key>` in `chrome.storage.local` (a route Courseline reads keeps its `kind`; every other one is saved in full as kind `other` with its `route`; a known route that came back in an unexpected format is kept raw too, as `cap:rejected:<key>` with `rejectedAs`, so it never replaces a good copy and is never lost (the app never reads it: `usableSnapshot` in `extensionApi.ts` and `discoverLinks` leave out every record with `rejectedAs`, as the popup tells the student); a response over 3 MB is counted in `skippedLarge`, which the popup shows), counts unexpected shapes in `health`, and notes the address shapes in `unmapped`/`shapes`. Credential endpoints are never saved. Page data (a `page` field from `relay.js`) goes through `classifyPage` instead of `classify`: a fixed list of kinds with their own shape checks, one record per course and kind (a wiki page is filed as `frontPage` or `page`, the API's own kinds; the Grades page once per grading period it showed (`:gp<id>`); assignment pages once per assignment (`:a<id>`); list pages once per path (`:announcements` / `:discussion_topics`)). `/api/v1/folders/:id/all` (the Files page, folder by folder) is the `folderContents` kind; it has no course in its address, so each file's `context_asset_string` says whose it is. Commands meant for the app (`setCanvasHost`, `openPage`, `cancelPull`, `setPinned`, `sendMessage`, `refreshMail`) are accepted only from a localhost tab. `sendMessage` and `refreshMail` run `sendViaTab` and `refreshMailViaTab` (see "Messages (extension mode)" below). `openPage` records each page that really loaded in `visited`. Saved responses older than 90 days are deleted, and beyond 6,000 the oldest go (`MAX_RECORDS`), checked at most once an hour; the prune check keeps its clock in memory, so a capture does not read storage just to learn it is not time. |
| `lib/capture.js`, `lib/readers.js`, `lib/summary.js`, `lib/shape.js`, `lib/pullRunner.js`, `lib/peek.js` | Pure logic with tests: routes and shape checks, readers (course lists), popup summary, value-free response skeletons, the page runner (`concurrency` pages at a time, `CONCURRENCY` = 4 in every run `bridge.js` starts, with the pause and idle limits; no hourly cap and no page limit), and the short name samples shown in the preview. |
| `lib/canvasAddress.js`, `lib/pinned.js`, `lib/message.js`, `lib/exportAll.js` | Pure logic with tests: the Canvas address typed in the popup or the app (`parseCanvasAddress`, https only; `applyCanvasAddress` saves it and clears what came from another address); which courses count as pinned (`effectivePinnedIds`, `pinnedList`: the app's choice, else the dashboard); what a message request may look like (`cleanSendRequest`: a reply, or a new message to up to 50 Canvas user ids, plain text up to 20,000 characters, a subject up to 255, up to 10 files and 25 MB in all; `sendRequestFor` maps it to Canvas's endpoint); and the popup's export JSON (`buildExport`). |
| `popup.html/js` | The Canvas address field (Save, through `applyCanvasAddress`), per-course freshness, "N of M current courses synced", health, unread addresses ("Also saved"), **Sync in Courseline** (brings an open app tab forward and has `bridge.js` pass it `openPlan`, or opens `/settings?tab=connection&sync=1`), **Export everything (JSON)**, **Copy response shapes**, **Clear captured data**. |
| *(linked pages)* | **Pull linked pages** follows internal links. `src/extension/linkDiscovery.ts` scans everything captured (including HTML inside bodies and every `html_url`) for links to assignments, pages, discussions, announcements, quizzes, files, module items and the syllabus on the student's own Canvas and chosen courses. It also opens every assignment the Grades page's ENV (`assignment_groups[].assignments[].id`) or a planner item (`plannable_type 'assignment'`) names by id, link or not (`dev` only): where the school hides the Assignments tab, an assignment's own page is the only place its instructions and rubric show (`assignmentPage`), and it still opens. A row link and the same id give one page. `pendingLinks` skips pages opened in the last day (the extension keeps `visited`), and `PullContext.requestDeepSync` opens them all in one run (no batch or hourly cap, by the owner's decision of Oct 27, 2026; Stop still works between pages). It also opens every subfolder a captured folder listing names (`/courses/<id>/files/folder/<path>`), because the Files page only loads the folder it shows. `extensionApi.ts` finds an opened assignment again by id in Canvas's newer GraphQL form (`assignmentFromObjects`) so instructions and rubrics fill in without a reader per query. |
| *(one pass)* | One click on **Sync now** (with "everything") opens the planned pages, then every page linked from what came back, then the pages linked from those, round after round until a round finds nothing new (`PullBuild.more`, asked after every run; `attempted` keeps any address from being opened twice in a pass, so it always ends). **Pull linked pages** chains the same way. Each round is a continuation of the run that just ended (`continueFrom`): `bridge.js` accepts it only from that run, within 2 minutes, and never after Stop (Stop clears the chain even between rounds, and the app sends `endChain` when the pass is over). "Essentials only" does not follow links. Opened pages are remembered in `visited` for a day (the same day `pendingLinks` waits), pruned by age, not by count, so a long pass never forgets its own pages. Class statistics read from the page must also fit the assignment's points (`sensibleStatistics(stats, points)`). |
| *(what Sync now opens)* | Per course: the home page (front page and course menu), Assignments, Grades, Modules, Pages and Files (Files by unit needs both the units and the file list); with "everything" also Announcements, Discussions, Quizzes, Syllabus and People, plus the account pages once (`src/extension/pullPlan.ts`). **Tabs the school hides are skipped**: Canvas only redirects them to the course home. Which ones are hidden comes from the captured course menu (`hiddenSections`), so the first run of a course still tries them all. Discussions is the exception (`ALWAYS_TRIED`): one school serves it although its menu leaves it out, so "everything" tries it anyway (one page per course), and the landed page says whether it opened (`listPage`). With "everything", the linked-page rounds also open each assignment named by id in the Grades page's ENV or planner items (see "(linked pages)"); "Essentials only" follows no links. |
| *(no sync window)* | Sync now has no extension window. The plan, **Start**, the live preview and **Stop** are in the app (`context/PullContext.tsx`, `components/PullPanel.tsx`). `bridge.js` runs the page-by-page loop in the app's own tab, and `background.js` opens each page in a **background tab** of the same window (`openPage`), 4 at a time (`CONCURRENCY`), waits for it, closes it, and reports what it brought in (captures are credited to the tab that sent them, so parallel pages do not mix). It moves to the next page as soon as the page reports it has gone quiet (`inject.js` counts requests in flight; the load event has fired and none has been pending for 0.7 s), cut off at 12 s, with a 0.4 s pause between pages. See "Deviations from the design doc". |
| `bridge.js` | Lets the app read the captured data and tell the extension which courses it chose (see below), runs the Sync now loop (above), and passes `sendMessage` and `refreshMail` on to `background.js` only during a real click in the app (`navigator.userActivation`; a message only after `cleanSendRequest`). Passes the popup's `openPlan` to the app page. Answers only a page on an allowed port (5173–5180, 4173) that declares `<meta name="courseline-app">`; the API-token edition's build leaves that tag out, so there it answers nothing. Sends `changed` only when something a snapshot carries changed (`cap:*`, `health`, `appPinned`, `canvasHost`, `visited` in local storage), not for pull bookkeeping in session storage, so a sync does not make the app reload the whole store after every page. |
| `README.md`, `TESTING.md` | The extension's own short README (install, what it does, files, tests) and the manual checks to run in a real browser after changing `inject.js`, `relay.js`, `bridge.js`, `background.js`, `popup.*` or the manifest. |

**Extension mode (app side).** Full app only: in the API-token edition `extensionInstalled()` is always false, so none of this runs. With no saved token and the extension installed (it sets `data-courselineExtension` on
`<html>`), `AuthContext` loads a snapshot through `src/extension/bridge.ts` and builds the API from it with
`src/extension/extensionApi.ts` (`createExtensionApi` returns the same `CanvasApi` type as `createCanvasApi`, so pages
do not change). Differences: ids are normalised to numbers; the course total is Canvas's own when the course record
carried it or the Grades page showed it (`canvas_total`, read from the "Total" row when it is a percentage, for the
whole course: no grading period chosen, or "All grading periods" (`grading_period_id` `"0"`); and only when that
Grades page capture is at least as new as every capture carrying a score for the course (`newestScoreAt`: the
submissions list, a submission, gradebook groups, an assignment list or detail that embed a submission, any Grades
page), since a newer score makes its total stale; `dev` only), otherwise worked out by `lib/grades.ts` from captured scores and marked
`estimated: true` on the enrollment, and whether groups are weighted falls back to the Grades page's
`ENV.group_weighting_scheme` (`"percent"`) when the course record does not say; lists for courses that were never visited are empty, not an
error; submitting work, comments, marking a unit item read, and reading or downloading a file reject with "needs a Canvas access token" (a file opens in Canvas in a new tab instead of the viewer, `FileViewerContext`); messages are sent through the extension (see "Messages (extension mode)" below), and marking a conversation read does nothing (Canvas keeps its own read state). A
section missing from Canvas's course menu (`hiddenSections`: assignments, modules, pages, files, syllabus, announcements,
discussions, quizzes, people) rejects with a `CanvasApiError` of kind `hidden` ("… is not in this course's Canvas menu")
when nothing was captured for it, because no Canvas page will ever load it; only a token (the API ignores the course
menu) can show it. The menu alone cannot tell "the school hides it" from "the course does not use it" (Canvas leaves
empty tabs out too), so the message says both, and `ErrorMessage` shows kind `hidden` as a neutral note, not an error.
Files: a hidden Files area returns `null` (as the API does); a Files tab in the menu that was never opened rejects
`not_found`, and the Files screen then still lists the files in units with a "not synced yet" note. Files come from the
API list or the `folderContents` listings, units from the API or the `modulesPage` capture (`modulesFromPage`; a wiki
page item's slug is found from the captured pages by page id). Upcoming work uses the API's window (due within the next week). To read like the API: courses are listed by name,
files newest first, and pages with the front page first, then in the order the front page links them (a course
index usually lists its sections in unit order). A Discussions or Announcements page that was opened but loaded no
topics means the course has none (Canvas sends no list when it is empty). "Opened" is a `listPage` capture for that
list (the landed page really was it), or, only when the course menu shows that tab, a `visited` entry for its address:
`visited` keeps the address asked for even after a redirect, so on its own it cannot tell an opened page from one that
landed on the course home. A redirected Discussions page in a course whose menu leaves it out keeps the hidden note;
one that opened reads "No discussions.", and both stay put as long as the captures do (90 days), not the day `visited`
lasts. Topics opened on their own come from the
`GetDiscussionQuery` GraphQL capture (course found from the author's link). Unit item titles leave out Canvas's
screen-reader text, and an item linked straight to another site keeps that address as its `external_url`. An assignment's posted date and Canvas's missing / late
flags also come from captured planner items when nothing better was captured. The Modules page is read again on the
page's load event and just before the page reports it has gone quiet, because Canvas draws module items late. Your name comes from `currentUser`; course names and code
from the dashboard card (`originalName`, `courseCode`). The term name comes from a term object first (the course record,
the `userCourses` list, then the `GetUserCourses` GraphQL list) and the card's `term` text last, because the card can
label the term differently from its name (`dev` only). In the Grades page's data a submission has
fewer fields than the API's, so it updates field by field; the row's pills add `missing` / `late`; each assignment counts
in one group only (the one its newest capture puts it in); and `never_drop` ids are compared as numbers (`toModel`). Assignments, groups and
scores also come from the Grades page's own data (`gradesPageGroups` turns a `gradesPage` capture into
`assignment_groups`), so a course whose Assignments tab is hidden still has its gradebook and grade. Each assignment's
own page (`assignmentPage`, `dev` only) adds what the lists lack: in the lists (`groupsOf`, through `fillFromPage`) it
only fills empty fields (title, points, instructions, rubric, link), so a Grades row with no name gets the page's title
instead of "Assignment {id}"; an assignment only its page knows is listed too (due date from planner items, outside
every group, so never in the grade). On the assignment screen (`getAssignment`) the page's instructions and rubric win
over the API's detail when nothing else has them, when no API detail was captured, or when the page was read after it;
its title, points and link only fill gaps; it never carries dates, so the due date from the Grades page's ENV or the
API stays. When no captured source has a `description` key at all, the assignment carries `instructions_unknown: true`
and the screen says "Instructions have not been synced yet…" instead of "No instructions provided." (which stays for a
source that said there are none, such as an empty instructions element). Assignment pages count as assignments data in
the freshness chips, and `listPage` as announcements data. **Values that do not add up** (`dev` only, `valueChecks.ts`):
every date is normalised to UTC "Z" as it is read (Grades page ENV and GraphQL write an offset, "+01:00", which sorts
wrong against the API's "Z" strings): due, unlock, lock and created dates, announcement posted dates, and message
dates; a date with no time zone, a date-only or localized text, or a year outside 2000-2100 is dropped, and a due date
then comes from planner items. Points and Grades-page scores must be numbers (a dot-decimal string is converted, "8,5"
is dropped; '' and null stay unknown, never 0). Class statistics go through `sensibleStatistics`. An object found by id
in another capture fills an assignment only when `looksLikeAssignmentOf` accepts it (not a user, module, folder,
group, course, calendar event or another course's assignment). Each value dropped from a working course's newest
capture becomes a `ValueIssue` (`valueIssues(snapshot)`, once per snapshot), plus each assignment page whose rubric
could not be read. The syllabus comes
from a `syllabus` capture or a course record carrying `syllabus_body`. New captures
arrive as a `changed` message, `dataVersion` changes, and `RefreshOnNewData` in `App.tsx` reloads what is on screen in place (`refreshAll()`; `DataProvider` itself is rebuilt only when `source` or `baseUrl` changes). A snapshot can hold
thousands of records: to find the newest one, the Canvas host or the last capture time, use `newestRecord`,
`snapshotHost` and `lastUpdatedAt` from `extensionApi.ts` (one pass) rather than copying and sorting `records`. `ExtensionStatus` (in the sidebar, under the courses) is a collapsible item: collapsed, a status dot with the same status in words (green up to date, amber partly synced or out of date, amber "Needs attention" when values were left out because they did not add up, red an unexpected format, pulsing while syncing) and how long ago; opened (remembered in `courseline.extension-status-open`), coverage, Sync now, per-kind freshness, this course, and warnings: an unexpected format (red), and the values left out (`issueSummary`: one line per course and kind, at most four, then "and N more", with what to do). Freshness is shown per kind of
data (assignments, grades, units, pages, files, announcements, upcoming work, course info) through `freshnessByType`
in `extensionApi.ts`: scoped to the open course on a course page, and to the pinned courses elsewhere. A kind every
course should have but that was never captured reads "not synced yet", or "not in Canvas menu" (not a warning, and not
clickable) when that tab is missing from the course's menu; anything older than a day is marked stale. Units count the
`modulesPage` capture and files the folder listings of that course. A chip whose own tab is hidden refreshes from the
page that still carries it (`KIND_PAGES` in `pullPlan.ts`: assignments from Grades, pages from the course home). Logging out of extension mode
sets `courseline.skip-extension` so the token form shows. `enableExtension()` (Connect, and Settings → Use the extension
instead) clears the skip flag **and any saved token**, then loads the extension's data. The Canvas address is typed in
the app (`CanvasConnection`) or the popup; both go through `applyCanvasAddress` in `extension/lib/canvasAddress.js`
(the app sends a `setCanvasHost` bridge message, which `background.js` answers).

**Messages (extension mode).** Canvas's Inbox loads its list through GraphQL (`GetConversationsQuery`: each
conversation with its subject, read state, participants and newest message; the inbox and the sent folder differ only
in the query's variables, which GraphQL captures now keep as `record.variables`). `mailFrom` merges those, any thread a
query brought in, and REST-shaped records (kind `conversation`). Canvas loads a thread only when it is clicked in its
own Inbox (no address for it), so **opening Messages in the app** has the extension read the inbox, the sent folder
and every thread itself (owner's decision, Oct 29, 2026): `refreshMail` (bridge.ts) → `bridge.js` (needs a click;
opening Messages is one; otherwise the screen offers "Load latest messages") → `background.js` `refreshMailViaTab`
(at most every two minutes; a background tab on `/profile/settings`) → `inject.js`, which makes GET requests only:
`/api/v1/conversations?scope=inbox|sent` and `/api/v1/conversations/:id?auto_mark_as_read=false` (nothing is marked
read). The answers are saved as `conversation` records keyed by list and by conversation. Not part of Sync now. Sending: the app's `sendMessage` (bridge.ts) → `bridge.js`
(needs a click; `cleanSendRequest`) → `background.js` `sendViaTab` (opens `https://<host>/profile/settings` in a
background tab: the Inbox page has no form token, the Settings page's forms do; a page that lands on the login screen
means the student is signed out, and says so) → `relay.js` → `inject.js`, which posts to `/api/v1/conversations/:id/add_message` or
`/api/v1/conversations` with the page's form token and sends the answer back (attachments, base64 in the
request, are uploaded first from the same tab with Canvas's three-step upload into the student's "conversation
attachments" folder, and their ids go with the message); the background saves it as a
`conversation` record (so the thread shows the message at once) and closes the tab. See risk 17.

**Pinned courses.** "Pinned" means the courses the student chose in the app (Settings → Choose your courses,
sent over the bridge as `appPinned`); until they have chosen, the courses on their Canvas dashboard (the latest
captured `dashboardCards`, stored as `pinned`). `ExtensionPinnedSync` keeps the extension's copy equal to the app's.
In the app, until the student chooses, `useVisibleCourses` shows only the captured (pinned) courses. Once a set is known, Sync now plans pages only for those courses, the popup and the app
count and list only those, and `background.js` stops keeping data for any other course (it remembers the set as
`pinned` in `chrome.storage.local`). Before a dashboard has been seen nothing is filtered. Data already stored for a
course that is later unpinned stays until **Clear captured data**, but nothing shows it. There is deliberately no
"include concluded courses" option for Sync now.

### `src/extension/` — the app's side of the extension

| File | Purpose |
|---|---|
| `bridge.ts` | The app's end of `extension/bridge.js`, over `window.postMessage`: `extensionInstalled()` (reads `data-courselineExtension`; always false in the API-token edition), `loadSnapshot`, `startPull` / `cancelPull` / `endChain` / `onPullEvent`, `sendMessage` and `refreshMail` (`filesForExtension` turns attachments into base64), `setCanvasAddress`, `setPinnedCourses`, `onOpenPlanRequest`, `onExtensionChange`. |
| `extensionApi.ts` | `createExtensionApi(snapshot)`: the `CanvasApi` built from captured records (see "Extension mode (app side)" above), plus summaries of the snapshot that the status bar, Sync now and the setup screens use (`coverage`, `freshnessByType`, `failingKinds`, `workingCourses`, `hiddenSections`, `newestRecord`, `snapshotHost`, `lastUpdatedAt`) and the readers for page data and messages (`gradesPageGroups`, `modulesFromPage`, `mailFrom`, `peopleFrom`, `sensibleStatistics`, `assignmentFromObjects`), and `valueIssues` (the values left out, for `ExtensionStatus`). `createExtensionApi(snapshot, onIssue?)` wraps `extensionInternals`, which `valueIssues` runs with a sink that collects. Snapshots never change once loaded, so each is indexed once (`datasetOf`, a `WeakMap` of `Dataset`s, shared by every helper above), and inside `extensionInternals` each course's groups, assignments, units, pages, topics and graded course, the mail and the profile are worked out once per language (`memo`). Those results are shared between calls: never change them. The longest file in the app (~1,330 lines). |
| `valueChecks.ts` | Checks on values that are well-formed but cannot be right (`dev` only): `normalizeInstant` / `checkedInstant` (ISO with "Z" or an offset, years 2000-2100, converted to UTC "Z"), `checkedNumber`, `sensibleStatistics` / `checkedStatistics`, `looksLikeAssignmentOf` (the guard on objects found by id), the `ValueIssue` each drop raises through an `IssueSink`, `dedupeIssues` and `issueSummary` (the lines `ExtensionStatus` shows). Pure; `extensionApi.ts` wires it in and `valueIssues(snapshot)` collects the issues. |
| `pullPlan.ts` | Which Canvas pages to open: `planSync` / `planCourse` (essentials or everything, hidden tabs skipped except `ALWAYS_TRIED`: Discussions), `stepsForKind` (`KIND_PAGES`, for one freshness chip), `stepForAddress` (Pull a page: the student's own Canvas, https only), `estimateSeconds`. |
| `linkDiscovery.ts` | `discoverLinks`, `pendingLinks`, `planLinks`: the linked pages, subfolders and assignments named by id (Grades page ENV, planner items) a pass opens next (see "(linked pages)" above). |
| `capturedData.ts` | `groupCaptured`, `buildCaptureExport`, `previewJson`: what Settings → Connection → Everything captured shows and downloads. |
| `useExtensionSetup.ts` | The hook the setup screens use: installed or not, the snapshot (reloaded 1 s after the last change notice), the saved Canvas address, record count, last capture time, `saveAddress`. |

### Tests (`*.test.ts` / `*.test.tsx` / `*.test.js`, next to the code they cover)

Paths are relative to `src/`, except rows marked *(root)*, which are relative to the project root.

| File | Covers |
|---|---|
| `api/client.test.ts` | Auth header, pagination (incl. the 50-page guard), proxy re-rooting, every error kind, `downloadTarget`, `getBlob`, and all variants of the three-step upload. |
| `api/canvas.test.ts` | Endpoint quirks: restricted-course filtering, `score_statistics` retry, hidden Files tab → `null`, >50-item modules, the Pages discovery chain and de-duplication, announcements from the course's own topic list, write payloads, the sent folder's newest message (`last_authored_message`), message attachments uploaded to "conversation attachments" before the reply, and marking a conversation read. |
| `lib/grades.test.ts` | Weights, current vs final, every drop rule, excused/omitted/extra credit, what-if, trend replay, goal solver, Canvas→model mapping (including never-drop ids sent as strings), and the class-median comparison (`medianComparison`). |
| `lib/accent.test.ts`, `lib/format.test.ts` | Palette generation and contrast rule, CSS variable application, grade/byte formatting. |
| `lib/html.test.ts` | File links found in Canvas HTML: names, `data-id`, duplicates, unnamed links. |
| `components/HtmlContent.test.ts` | Sanitizer: scripts/handlers/iframes removed, links made absolute, Canvas file links made inert. |
| `components/SubmissionForm.test.tsx` | Upload-then-submit order, failure submits nothing, retry skips already-uploaded files, allowed extensions, rich-text tab (HTML body, sanitizing, empty check, reset). |
| `context/DataContext.test.tsx` | Cache: single request per key, error capture, 5-minute freshness, refetch keeps old data visible, only the changed key re-renders, `ensure` and `prime`, and `refreshAll` (reloads what is on screen in place, marks the rest stale, and a reload that reads another key through `ensure` gets it fresh). |
| `context/CourseStyleContext.test.tsx` | Per-course color/icon: save, merge, reset, ignore invalid saved values. |
| `lib/courseColor.test.ts` | Colors are unique at any count, order-independent, and stable when a course is added. |
| `lib/assignmentState.test.ts` | The one color scheme for assignments (red missing / pastel blue to do / pastel green handed in), which finished work fades, that the list badges use it, and the list order from `sortAssignments` (including undated work and work handed in with no due date). |
| `lib/pptxFix.test.ts` | Body style copied onto masters and layouts, titles and placeholders with their own style untouched, top anchoring, same bytes back when nothing to do or on garbage. |
| `lib/htmlToMarkdown.test.ts`, `lib/extractText.test.ts`, `lib/courseExport.test.ts`, `lib/courseExportRunner.test.ts` | The AI export: Markdown conversion, text from Word/PowerPoint/plain files, the document set and link rewriting, scanning, packing, size limits, failures and cancelling (with a fake Canvas API). |
| `lib/calendar.test.ts` | Month grid (week start, whole weeks, year rollover) and local date keys. |
| `i18n/i18n.test.ts` | `t()` and `tn()` (plurals) in English, Spanish and Brazilian Portuguese (`pt-BR` dates), placeholders, saved-language detection, that both dictionaries keep every English `{placeholder}`, and that Portuguese translates exactly the same strings as Spanish. |
| `firstPaint.test.ts` | The inline script in `index.html`: old `better-canvas.*` keys move to `courseline.*` without overwriting newer ones; theme and accent apply. |
| `App.test.tsx` | Smoke test (with a token, against a fake Canvas): every route but Messages renders its data through the real providers, cache and lazy-loaded screens; Spanish as the saved language, and switching language in Settings; sidebar navigation; the Pages tab makes no per-page requests. |
| `lib/messages.test.ts` | The Messages helpers: day groups and runs by one person, who a conversation is with (the student left out), links in plain text, Canvas's compose link (`composeTarget`), the chat name, inbox and sent merged once each and newest first, attachment kinds. |
| `lib/systemClock.test.ts` | The computer's 12/24-hour clock wins over the language; the region's clock and first weekday as the fallback; options without an hour left alone; malformed settings dropped; macOS locales turned into region tags. |
| `lib/xlsxStyles.test.ts` | Fills (theme colors with tint, plain colors), fonts, borders and alignment; each sheet's cell styles, widths, row heights, hidden rows and columns, and gridlines; null for a file that is not `.xlsx`; Excel's tint and column letters. |
| `lib/csp.test.ts` | The Content-Security-Policy: no plugins, base-URL changes or eval, scripts only from the app and the Monaco CDN; only the dev policy allows the dev server's websocket. |
| `components/SheetTable.test.tsx` | The spreadsheet grid: each cell's own fill, font and alignment, numbers right-aligned, merged cells drawn once, hidden columns left out, no gridlines when the sheet hides them. |
| `components/CanvasConnection.test.tsx` | Install steps without the extension. Login: Connect saves the address, switches to the extension and loads the essentials when nothing is captured, signs straight in when data exists, shows the extension's error, never replaces the saved address from an untouched field, refuses an empty one. Settings: each step with its state, Save address and Sync now. |
| `components/ExtensionStatus.test.tsx` | Collapsed to one row with a status in words, opening remembered; per-kind freshness, stale and "not synced yet" marks; account-wide kinds off a course page; nothing outside extension mode; values left out listed by course with what to do, amber not red. |
| `components/ExtensionPinnedSync.test.tsx` | The app's course choice is sent when the extension's differs, nothing once both agree (in any order), an empty choice clears the extension's, nothing in token mode. |
| `context/AuthContext.extension.test.tsx`, `context/AuthContext.noReply.test.tsx` | Signing in from captured data with no token; the login page when nothing is captured or the extension is absent; a saved choice to use a token; switching to the extension forgets the token; Connect with nothing captured does not hang. A missing answer from the extension does not sign a student out, a real "nothing captured" answer does, and no answer at all on the first load shows the login page. |
| `context/FileViewerContext.test.tsx` | In extension mode a file opens in Canvas in a new tab instead of the viewer (web addresses only); with a token the viewer opens. |
| `context/PullContext.test.tsx` | Sync now in the app: the plan waits for Start and Cancel opens nothing; Essentials only; live rows and a summary; a single refresh with no confirmation; Pull a page (own Canvas only); the dashboard first when no courses are known; one run at a time, and Stop (also between stages); clear errors; linked pages in one run, no cap, skipped next time; the popup's request shown in the open page; one pass round after round until nothing new (not with Essentials only), then `endChain`. |
| `pages/LoginPage.test.tsx`, `pages/LoginPage.apiOnly.test.tsx` | What sign-in leads with, with and without the extension; and that the API-token edition (the `API_ONLY` switch mocked) offers only the token form and never sees the extension, even when it is installed. |
| `pages/extensionFlags.test.tsx` | The screen side of extension mode's flags: the Grades screen labels an `estimated` grade "Worked out by Courseline" and never treats it as Canvas's figure (no "Rebuilt here" note), while Canvas's own total is the headline; the assignment screen says "not been synced yet" for `instructions_unknown`, "No instructions provided." for an empty description, and that the instructions were not kept for `description_removed`. |
| `extension/bridge.test.ts`, `extension/capturedData.test.ts` | The app's bridge client: an absent extension known at once, snapshots, starting, cancelling and failing pulls, progress events, change notices, foreign messages ignored. The captured-data groups, the JSON export (oldest first, with bodies) and the cut preview. |
| `extension/extensionApi.test.ts` | Extension mode on fake captures: ids as numbers; courses, coverage and the pinned set; grades from captured scores; assignments and submissions (newest capture wins, each counted once); writes and downloads refused; modules and pages; freshness; assignment detail from REST or GraphQL; a restricted course's assignments read from their own pages (fill-only in the lists, page vs API detail by capture time, page-only assignments outside the grade, `instructions_unknown`); announcements and discussions (an opened `listPage`, a redirect, `visited` only when the menu shows the tab); the Grades and Modules page data and hidden tabs; class statistics that do not fit left out; the API's ordering and upcoming window; the inbox, threads and course people from captures; values that do not add up (offset dates in UTC, a due date from planner items, `valueIssues` for working courses and newest captures only, objects of another kind never filling an assignment, course 17 vs 174293, Canvas's own total vs an `estimated` one (period `"0"` counts as the whole course; a score captured after the Grades page makes its total stale), rejected responses never read (`rejectedAs`), message dates in UTC so GraphQL and REST messages sort together, `description_removed`, weighting and term fallbacks, an unreadable rubric). |
| `extension/valueChecks.test.ts` | Dates (UTC "Z" kept, offsets converted, unknown is not a problem, date-only / no zone / localized text / out-of-range years refused and reported), numbers ("8,5", NaN and Infinity refused; '' and null unknown), class statistics (extra credit kept, a misread factor reported), `looksLikeAssignmentOf`, and the summary lines. |
| `extension/linkDiscovery.test.ts`, `extension/pullPlan.test.ts` | Links found once each on the student's own Canvas and courses, recently opened pages dropped, steps ordered and labelled, subfolders by path, assignments named only by id in Grades page data or planner items. The sync plan (essentials, everything, hidden tabs skipped but Discussions still tried, account pages once), the page for each kind of data, pasted addresses (own Canvas, https only), the time estimate. |
| `extension/background.test.js` *(root)* | The background script with a fake `chrome`: the address the app sends; app-only commands refused from anywhere else; nothing kept before an address is saved, or from another host or origin; personal fields stripped; the pinned set (the app's choice over the dashboard); responses with no reader kept in full, credential endpoints never; background tabs on the saved https address only, closed after; Stop (also for tabs opened before a worker restart); unexpected formats kept raw; sending a message and reading messages from a Canvas tab (signed out detected, forged answers refused, two minutes between reads). |
| `extension/bridge.test.js` *(root)* | The page marker; a run only from a click, or as the continuation of the run that just ended (round after round, ended by Stop, between rounds or by `endChain`); a double click starts one run; the popup's `openPlan`; no answer on another localhost page; a message only from a click and only well-formed. |
| `extension/inject.test.js` *(root)* | Canvas recognised by body class or `ENV`, buffered until then and discarded otherwise; only same-origin `/api/` reads captured (fetch, `Request`, XHR in text and JSON mode), never a write or a GraphQL mutation (persisted queries named like a change too), no other response cloned; the "quiet" signal; page data (Grades page, front page, syllabus, the Modules page read again late, missing/late pills, class statistics, whose Grades page it is, decimals on a Spanish page, Canvas's own total (a percentage only, read again once the page's own JavaScript fills it in) and weighting scheme, screen-reader text dropped; an assignment page drawn on the server: title, instructions, points and rubric, never its localized dates, only when the address and `ENV` agree; a list page only when it really is that page); the `send` command (form token, attachments uploaded first, anything else refused) and the `mail` command (both folders and each thread, nothing marked read). |
| `extension/lib/*.test.js` *(root)* | One per `lib/` module: `capture` (routes, shape checks, GraphQL names, credential and capability URLs and the `verifier` scrub inside HTML, personal fields, the pinned filter, expiry, page kinds, assignment and list pages, grading periods, folder listings), `readers`, `summary`, `shape`, `pullRunner` (order, pause, cancel, failures, several at once), `peek`, `canvasAddress`, `pinned`, `message` (replies, new messages, up to 10 files and 25 MB) and `exportAll`. |
| `e2e/run.mjs` *(root)*, with `e2e/harness.mjs`, `e2e/cdp.mjs`, `e2e/mock-canvas.mjs` | `npm run e2e`, not part of `npm test` or CI: a real Chrome (`CHROME_PATH`) with the unpacked extension, a mock Canvas over HTTPS and the running dev app (`APP_URL`, default `http://localhost:5173/`). Covers sign-in, sync, the preview, Stop, pull a page, linked pages, a restricted course (course 4: hidden tabs that redirect home, assignment pages opened from Grades page data and read without their dates or `verifier`, a course sync on Everything opening Discussions though not in the menu while skipping hidden Quizzes, Canvas's own total read after the Grades page's JavaScript fills it in (72%, not the 70% Courseline would work out)), the popup, switching address, clearing, and no console or CSP errors; not Messages. Screenshots go to `e2e/screenshots/` (git-ignored). |
| `test/fakeFetch.ts` | Helper (not a test): replaces `fetch` with a router so tests never touch the network. |

**Not** covered by automated tests: how the screens look; the Messages screen (its helpers in `lib/messages.ts` are tested) and sending and reading messages through the extension in a real browser; and the file viewer apart from `SheetTable` (checked in a real browser during
development, but those scripts were not saved).

### Other

| File | Purpose |
|---|---|
| `src/main.tsx` | Entry point, provider stack. |
| `src/App.tsx` | The router and auth gate. |
| `src/index.css` | **Tailwind configuration** and global CSS: `@theme` (the `accent-*` colors), `@custom-variant dark`, `@source` (what Tailwind scans), two base fixes, the default accent CSS variables, and styles for rendered Canvas HTML (`.canvas-html`). |
| `src/vite-env.d.ts` | Types for `import.meta.env`, the `__API_ONLY__` constant `vite.config.ts` defines (read it through `src/edition.ts`), and the PDF.js legacy build imports. |

---

## 6. Subsystems in depth

### 6.1 Authentication and credentials

- Credentials `{ baseUrl, token }` are stored in `localStorage` under **`courseline.credentials`**.
- If `.env` has both `VITE_CANVAS_BASE_URL` and `VITE_CANVAS_API_TOKEN`, those are used when nothing is stored.
- **Two ways in, one `AuthProvider`.** With saved credentials (or the `.env` pair), data comes from Canvas's API
  (`source: 'token'`, `createCanvasApi`). With no credentials, the extension installed (`extensionInstalled()`: the
  bridge's `data-courselineExtension` attribute on `<html>`) and `courseline.skip-extension` not set, it loads the
  extension's snapshot instead (`source: 'extension'`, `createExtensionApi`; see "Extension mode (app side)" in
  [5](#5-file-by-file-map)). A saved token always wins over the extension.
- **API-token edition** (`API_ONLY` from `src/edition.ts`, the `main` branch): `extensionInstalled()` is always false,
  so only the token path exists, `LoginPage` shows only the token form, and nothing talks to the bridge.
- On start, `AuthProvider` calls `getProfile()` (`GET /users/self/profile` with a token; in extension mode the captured
  profile, else `currentUser`, else the user id on a captured course enrollment). Success → `authenticated`; failure →
  `unauthenticated` (login screen) with an error message. In extension mode an empty snapshot also means
  `unauthenticated` (the login page explains what to do and keeps listening, so the first capture signs the student
  in), and an extension that does not answer in time leaves a signed-in student signed in.
- `createCanvasApi` is given `onUnauthorized: logout`, so **any 401 about a bad token returns you to the login
  screen**. (A 401 whose message says "not authorized" is treated as a permission problem, not a bad token — see
  [8](#8-canvas-quirks-reference).)
- `useApi()` returns the API object (either kind; both have the `CanvasApi` type) and throws if called while logged out.
  `useAuth()` exposes `status`, `user`, `api`, `baseUrl`, `token`, `login`, `logout`, `error`, and for extension mode
  `source` (`'token'` or `'extension'`), `snapshot`, `dataVersion` (changes when new captured data arrives, see
  [6.4](#64-cache-and-hooks)), `extensionAvailable` (installed, but the student chose a token) and `enableExtension`.
  In extension mode `token` is null and `baseUrl` comes from the snapshot (`baseUrlOf`).
- **`login(baseUrl, token)`** normalizes the address (`normalizeBaseUrl`), trims the token, saves both and drops any
  snapshot. **`logout()`** deletes the saved credentials; when the extension is installed it also sets
  `courseline.skip-extension`, so the token form shows instead of signing straight back in with the extension.
  **`enableExtension()`** (Connect, and Settings → Use the extension instead) clears that flag **and the saved token**,
  then loads the snapshot.

### 6.2 The API client

`api/client.ts`. Key behavior:

- **Every request** sends `Authorization: Bearer <token>` and `credentials: 'omit'` (never Canvas cookies).
- **The token only goes to the Canvas address, over https.** `normalizeBaseUrl` upgrades a typed `http://` address to
  `https://` (only `localhost`/`127.0.0.1` keep http, for local mocks). `getAll` re-roots every `next` link on the
  Canvas origin, so a `Link` header cannot send the token elsewhere. Anything that may point at another host (file
  storage, an upload's confirm address) is fetched **without** the token; `isCanvasOrigin(url, baseUrl)` is the check.
- **`get(path, params)`** — one JSON resource. **`getAll(path, params)`** — a list: requests `per_page=100` and follows
  the `Link: rel="next"` header until there is none (max 50 pages as a runaway guard). **`send(method, path, body)`**
  — POST/PUT/DELETE with a JSON body. **`uploadFile(slotPath, file, extra)`** — Canvas's three-step upload (see
  [6.11](#611-assignments-and-submissions)); `extra` adds fields to the slot request (Messages passes
  `parent_folder_path: 'conversation attachments'`).
- **Array params** get Canvas's bracket form automatically: `include: ['a','b']` → `include[]=a&include[]=b`.
- **Errors** become `CanvasApiError` with a `kind`: `unauthorized`, `forbidden`, `rate_limit`, `not_found`, `network`,
  `server`, `unknown`, and `hidden`, which only extension mode raises (a section missing from the course's Canvas
  menu). Rate limiting is detected from a 403 whose body says "Rate Limit Exceeded" (Canvas does not use 429; a 429
  is treated the same way). A console warning appears when `X-Rate-Limit-Remaining` drops below 100.
- **`getBlob(url)`** downloads file bytes from a **pre-signed** URL (no auth header, because the URL carries its own
  verifier). **`downloadTarget(url, baseUrl, origin)`** decides where to fetch from: Canvas-origin URLs are re-rooted on
  `origin` (the real Canvas address, or `/canvas-proxy`), anything else is fetched as-is.
- **The dev proxy.** When `VITE_USE_DEV_PROXY=true`, `AuthContext` sets `proxyPrefix: '/canvas-proxy'`; the client sends
  every request to the Vite dev server, and `vite.config.ts` forwards it to Canvas. This avoids browser CORS blocking.
  It also sets **`followRedirects: true`**, because Canvas answers file downloads with a redirect to a different host
  (file storage), and following it server-side keeps the bytes same-origin. **The proxy exists only while
  `npm run dev` runs.** It does nothing in a built app.
- **Token mode only.** In extension mode nothing goes through this client: `createExtensionApi` answers from the
  snapshot (what the extension captured from Canvas pages), and reading and sending mail go through the extension, which
  makes those calls from Canvas tabs with the student's own session. In the API-token edition this client is the only
  way data arrives.

### 6.3 Endpoints in use

All paths are under `/api/v1`. Function names are in `api/canvas.ts`. `extension/extensionApi.ts` has a function of the
same name for each one, answering from captured data; the bracketed notes say where that data comes from when it is not
the same endpoint's captured answer. There, `getFile`, `downloadFile`, `markModuleItemRead`, `postSubmissionComment`,
`uploadSubmissionFile` and `submitAssignment` reject with "needs a Canvas access token"; sending a message is the one
write that works (through the extension).

| Function | Canvas endpoint | Used by |
|---|---|---|
| `getProfile` | `GET /users/self/profile` | login check, header name |
| `getCourses` | `GET /courses?enrollment_state=active&include[]=total_scores&include[]=term` | most pages (filters out restricted stubs) |
| `getCourse` | `GET /courses/:id` (same includes) | course header, grades page |
| `getCourseSyllabus` | `GET /courses/:id?include[]=syllabus_body&include[]=term` (extension mode: the syllabus page's `ENV.SYLLABUS_BODY`) | AI export |
| `getConversations(scope)` / `getConversation(id)` / `getUnreadCount` | `GET /conversations?scope=inbox\|sent&per_page=50`, `GET /conversations/:id` (Canvas marks it read when it answers), `GET /conversations/unread_count` (extension mode: the captured mail, `mailFrom`: Canvas's Inbox GraphQL plus the lists and threads the extension read; the count is the captured inbox's unread conversations) | Messages, sidebar badge (refetched every 60 s while the tab is visible) |
| `markConversationRead` | `PUT /conversations/:id` (`conversation: { workflow_state: 'read' }`) (extension mode: does nothing) | opening an unread conversation (token mode only) |
| `replyToConversation` / `createConversation` | `POST /conversations/:id/add_message`, `POST /conversations` (`group_conversation: true`, `context_code`, `attachment_ids` after uploading each file, one at a time, with the three-step upload to `POST /users/self/files`, `parent_folder_path: conversation attachments`) (extension mode: sent by the extension from a background Canvas tab, `sendMessage` in `bridge.ts`; see "Messages (extension mode)" in [5](#5-file-by-file-map)) | Messages |
| `getCourseRecipients` | `GET /courses/:id/users?enrollment_type[]=teacher&enrollment_type[]=ta&enrollment_type[]=student&include[]=enrollments` (extension mode: the People page's class list, `peopleFrom`) | New message (teachers and classmates) |
| `getAssignments` | `GET /courses/:id/assignments?include[]=submission&order_by=due_at` | Assignments tab, All assignments page, Calendar |
| `getAssignment` | `GET /courses/:id/assignments/:aid?include[]=submission` | assignment page |
| `getMySubmission` | `GET /courses/:id/assignments/:aid/submissions/self` (+ comments, rubric includes) | assignment page, submission page |
| `getAssignmentGroups` | `GET /courses/:id/assignment_groups?include[]=assignments&include[]=submission&include[]=score_statistics&scope_assignments_to_student=true` (retries without `score_statistics` on a plain 400) | grades page |
| `getModules` / `getModuleItems` | `GET /courses/:id/modules?include[]=items&include[]=content_details` / `.../modules/:mid/items` | Pages tab, Files tab |
| `getPages` / `getPage` | `GET /courses/:id/pages?include[]=body`, `.../pages/:slug` (only for pages listed without a body), `.../front_page` | Pages tab, Files tab |
| `getCourseFiles` | `GET /courses/:id/files` (returns `null` if the Files tab is hidden) | Files tab |
| `getFile` | `GET /files/:id` (gives the pre-signed `url`) | file viewer |
| `downloadFile` | fetches that signed URL's bytes | file viewer |
| `markModuleItemRead` | `POST /courses/:id/modules/:mid/items/:iid/mark_read` | opening a file from a module row |
| `postSubmissionComment` | `PUT /courses/:id/assignments/:aid/submissions/:userId` | Reply box |
| `uploadSubmissionFile` | `POST /courses/:id/assignments/:aid/submissions/self/files`, then the returned upload URL, then the confirmation URL | submission form |
| `submitAssignment` | `POST /courses/:id/assignments/:aid/submissions` (JSON `{ submission: { submission_type, body \| file_ids } }`) | submission form |
| `getUpcoming` | `GET /users/self/upcoming_events` | dashboard |
| `getAnnouncements` | `GET /courses/:id/discussion_topics?only_announcements=true&order_by=recent_activity` (not the account-wide `/announcements`, which only returns a window around today) | Announcements tab |
| `getDiscussions` | `GET /courses/:id/discussion_topics?order_by=recent_activity` | Announcements tab (Discussions section) |

### 6.4 Cache and hooks

- `DataContext` provides a `QueryStore` holding `{ data, loading, error, fetchedAt }` per key. `useQuery` subscribes to
  its own key (`useSyncExternalStore`), so a response re-renders only the components that read that key.
- **`STALE_MS = 5 minutes`.** Mounting a hook with fresh data does not refetch. Older data is shown immediately and
  refetched in the background (`loading` is true during that, `data` stays — check `data` to tell first load from
  refresh).
- A request already in flight for a key is not duplicated.
- `refetch()` forces a reload. `store.load(key, fetcher, true)` does the same from outside the hook: after sending or
  marking read, `useMailRefresh` in `MessagesPage` reloads `conversations:inbox`, `conversations:sent`,
  `conversations:unread` and the thread that way. `Sidebar` refetches `conversations:unread` every 60 s while the tab is visible, and when it becomes visible again.
- **When the cache starts over.** `DataProvider` sits inside the auth gate in `App.tsx`, so logging out empties it, and
  it is keyed on `` `${source}:${baseUrl}` ``, so switching between token and extension, or to another Canvas address,
  starts an empty cache. New captured data does not: `dataVersion` changes, `RefreshOnNewData` calls
  `store.refreshAll()`, which marks every key stale and then reloads the ones on screen in place (old data stays
  visible, forms keep their state). Everything is marked first so that a reload reading another key through `ensure`
  gets that key fresh, not its old copy. A key told to refresh while its request is running is loaded again once that
  request ends.
- Inside a fetcher, `store.ensure(key, fetcher)` reuses another query's fresh or in-flight data (it returns a promise that
  rejects on failure), and `store.prime(key, data)` fills a slot from a response that already carries it. `usePages`
  uses both: discovery shares the `modules:<id>` request, and each page lands in `page:<id>:<slug>`, so the module rows
  on the Pages tab never fetch a page again. `useAllAssignments` loads each course through `assignments:<id>` the same way,
  so All assignments, the Calendar and a course's Assignments tab share one copy per course. Use the same key **and**
  fetcher as the hook that owns the key.
- **Cache keys in use:** `courses`, `course:<id>`, `assignments:<id>`, `assignments:all:<id,id,…>`,
  `assignment:<cid>:<aid>`, `submission:<cid>:<aid>`, `modules:<id>`, `moduleItems:<cid>:<mid>`, `page:<id>:<slug>`,
  `pages:<id>`, `files:<id>`, `assignmentGroups:<id>`, `upcoming`, `announcements:<id>`, `discussions:<id>`,
  `conversations:inbox`, `conversations:sent`, `conversation:<id>`, `conversations:unread`, `recipients:<id>`
  (`recipients:none` before a course is chosen).
- Upgrade path (noted in the code): replace `DataContext` with TanStack Query or Zustand; `useQuery`'s signature can
  stay.

### 6.5 Routing

Defined in `App.tsx`. Unauthenticated users always get `LoginPage`. The dashboard, course list and course header are
bundled with the app; every other screen is `lazyPage(...)`, a chunk fetched on first visit. Navigation runs in a
transition (React Router 7), so the current screen stays up while the next one loads; `Suspense` in `Layout` and
`CourseLayout` shows a spinner on a direct load.

| URL | Component | Notes |
|---|---|---|
| `/` | `DashboardPage` | |
| `/courses` | `CoursesPage` | |
| `/courses/:courseId` | `CoursePagesPage` | Default tab ("Pages"). Inside `CourseLayout`. |
| `/courses/:courseId/pages` | redirect → `/courses/:courseId` | Old URL kept working. |
| `/courses/:courseId/assignments` | `CourseDetailPage` | |
| `/courses/:courseId/announcements` | `CourseAnnouncementsPage` | Announcements, then discussions. |
| `/courses/:courseId/files` | `CourseFilesPage` | |
| `/courses/:courseId/grades` | `CourseGradesPage` | |
| `/courses/:courseId/assignments/:assignmentId` | `AssignmentDetailPage` | Keeps the Assignments tab highlighted. |
| `/courses/:courseId/assignments/:assignmentId/submission` | `SubmissionViewPage` | |
| `/assignments` | `AssignmentsPage` | |
| `/courses/:courseId/export` | `CourseExportPage` | |
| `/calendar` | `CalendarPage` | |
| `/messages` | `MessagesPage` | Conversation list (and an empty pane on wide screens). Full-bleed: `Layout` adds no padding. See [6.14](#614-messages-messagespagetsx-libmessagests). |
| `/messages/new` | `MessagesPage` | New message. `?context_id=course_<id>&user_id=<id>&user_name=…` (or `course`, `to`, `name`) fills in the course and person (`composeTarget`). |
| `/messages/:conversationId` | `MessagesPage` | One conversation; on a phone the list is hidden while it is open. |
| `/conversations` | redirect → `/messages` (`/messages/new` when the query has `user_id`; the query is kept) | Canvas's own Inbox and "message the teacher" links (`ComposeRedirect`). |
| `/settings` | `SettingsPage` | |
| `*` | "Page not found" | |

### 6.6 Settings, theme, accent, and what is stored

Everything the app itself remembers lives in `localStorage` (what the extension captured is kept by the extension in
`chrome.storage.local` and only held in memory by the app):

| Key | Holds | Written by |
|---|---|---|
| `courseline.credentials` | `{baseUrl, token}` | `AuthContext` |
| `courseline.selected-courses` | JSON array of course ids (absent = show all) | `CourseFilterContext` |
| `theme` | `"light"` or `"dark"` (absent = follow the system) | `ThemeContext` |
| `courseline.accent` | custom accent `#rrggbb` (absent = default) | `ThemeContext` |
| `courseline.accent-vars` | the computed palette, so `index.html` can apply it before first paint | `ThemeContext` |
| `courseline.pages.<courseId>` | `{order: string[], collapsed: string[]}` for the Pages tab | `CoursePagesPage` |
| `courseline.course-styles` | `{ [courseId]: { color?: "#rrggbb", icon?: <key> } }` (Settings → Course colors and icons; absent = automatic) | `CourseStyleContext` |
| `courseline.language` | `"en"`, `"es"` or `"pt"` (absent = the browser's language) | `LanguageContext` (`saveLanguage` in `i18n/index.ts`) |
| `courseline.skip-extension` | `"1"` after logging out of extension mode, so the token form shows; removed by `enableExtension()`. Never written in the API-token edition | `AuthContext` |
| `courseline.extension-status-open` | `"1"` / `"0"`: whether the sidebar's extension status is opened (full edition only) | `ExtensionStatus` |

All reads/writes are wrapped in `try/catch` (storage can be blocked in private windows). Nothing is synced between
browsers or devices. The app used to be called Better Canvas: on load, the inline script in `index.html` moves any
`better-canvas.*` key to its `courseline.*` name (unless that already exists) and deletes the old one, so nobody is
signed out by the rename.

**Dark mode:** class-based: `@custom-variant dark (&:where(.dark, .dark *))` in `src/index.css` makes every `dark:` utility follow the `.dark` class (not the OS setting). `ThemeContext` toggles the `dark` class on `<html>`. `index.html` applies the
saved/system choice before React loads.

**Accent color:** `@theme` in `src/index.css` maps `--color-accent-50 … --color-accent-950` to the CSS variables `--accent-50 … --accent-950` (space-separated RGB), so every `accent-*` class follows the chosen color. The defaults (Tailwind's blue) are in `:root` in the same file. `lib/accent.ts` generates all 11 steps from one hex (that hex is shade 600; if it is too light for white text it is darkened until contrast ≥ 3), and `ThemeContext` writes the variables onto `<html>`.

**Course filter:** `selected === null` means "show everything". Once the user picks courses, courses added to Canvas
later stay hidden until re-selected (documented in the file).

### 6.7 The Pages tab (`CoursePagesPage.tsx`)

Shows **modules and wiki pages as one list** of collapsible, reorderable cards, so a teacher's choice of structure is
invisible.

- Sections = every module with items (rendered with `UnitItems`, shared with the Files tab) + every wiki page
  (rendered with `HtmlContent`).
- Default order: modules first, then pages; the user's saved order (`courseline.pages.<courseId>`) wins.
- **Page discovery fallback chain** (`getPages` in `canvas.ts`): the index is asked for bodies (`include[]=body`), so
  normally the whole tab is one request; pages that come back without a body (block-editor pages) are fetched one by
  one. Many schools hide the Pages tab, which makes the `/pages` index fail (404 "disabled for this course") even
  though individual pages load. So: try the index; if it is refused, **discover slugs** from module items of type
  `Page` (`item.page_url`) plus links found in the course front page (both loaded in parallel; the front page itself is
  reused, not refetched), fetch each, and **de-duplicate** (different slugs can resolve to the same page).
- Either source may legitimately be unavailable; the tab only errors if both fail.

### 6.8 Files by unit (`CourseFilesPage.tsx`)

Shows each module with its items. A search box filters by title, and a menu picks **Files only** (the default: file
items, and pages with the files found inside their HTML; units with neither are hidden, with a count) or **Everything in
each unit** (also assignments, linking to the in-app page, quizzes, discussions, links and tools). In Files only, files
in the course's Files area that no unit links to are listed last under "Not in a unit". In extension mode, units missing
from the course's Canvas menu (kind `hidden`) or a Files list not synced yet (kind `not_found`) do not stop the other
part from showing. Modules with more than 50 items come back from Canvas **without** `items`; `getModules` refetches
those separately. If the course's Files tab is disabled, the loose-files section is skipped (`getCourseFiles` returns
`null`) — files are still reachable through modules.

### 6.9 The file viewer

**Principle: nothing downloads unless the user presses a Download button.** Canvas file links in this app never
navigate. They open the viewer, and so do message attachments.

**Extension mode has no viewer.** Without a token a file cannot be looked up or downloaded (`getFile` and
`downloadFile` reject), so `openFile()` in `FileViewerContext` opens the address (http/https only) in Canvas in a new
tab, where the student is signed in, instead of showing the viewer. In the API-token edition there is always a token,
so the viewer is always used.

**How a file opens**

1. A link is clicked. `HtmlContent` rewrites Canvas file links to `href="#"` with the real URL in `data-canvas-file`
   (and strips any `download` attribute), then intercepts the click. Buttons elsewhere call `openFile()` directly.
2. `FileViewer` extracts the file id from the URL (`/files/<id>`), calls `GET /files/:id` (token auth) to get the
   file's real name, content type and a **pre-signed download URL**.
3. It downloads the bytes with `getBlob` and makes a local `blob:` URL. **Everything after this reads the local copy.**
4. The file's category is chosen from its extension/content type (`getFileTypeCategory`) and the matching viewer
   renders it. If lookup or download fails, an error panel explains why (CORS, denied, not found); if the signed link is
   known it offers an explicit **Download file** button.

**Viewers**

| Type | How | Notes |
|---|---|---|
| PDF | **PDF.js** (`pdfjs-dist`, the *legacy* build) draws each page to a `<canvas>` | Only pages within 1,200 px of the view are drawn; pages further away are released (each drawn page is ~13 MB at 100% on a 2x screen) and redrawn on return. Canvas capped at ~16 megapixels. If the background worker does not answer within 10 s it **falls back to main-thread parsing** (and remembers that for the session). 60 s overall limit. Verifies the bytes start with `%PDF-`. |
| DOCX | `docx-preview` | Hyperlinks restricted to http/https/mailto. |
| XLSX / XLSM / XLS / XLSB / CSV / TSV / ODS | SheetJS (`xlsx` 0.20.3) for the values (`cell.w`, the text as Excel shows it) + `lib/xlsxStyles.ts` for the formatting SheetJS's free edition does not read (fills with theme colors and tint, fonts, borders, alignment, column widths, row heights, hidden rows and columns, gridlines, from `xl/styles.xml`, the theme and each sheet's XML) → `SheetTable`, drawn as elements (never injected HTML) on a white page in light and dark mode, with column letters and row numbers | Sheet tabs; hidden sheets skipped; merged cells; **max 2,000 rows and 200 columns per sheet** (`MAX_SHEET_ROWS`, `MAX_SHEET_COLS`; a longer sheet says "Showing the first 2,000 of N rows"). 30 s limit (`OFFICE_TIMEOUT_MS`) to read the values, and again for the formatting. Formatting is .xlsx/.xlsm only; .xls, .xlsb, .ods, .csv and .tsv show their values, and so does a file whose formatting cannot be read (`[file viewer] spreadsheet formatting skipped` in the console). Conditional formatting is not drawn. Cell hyperlinks (http/https only) open in a new tab. |
| PPTX | `pptx-preview` | Slides stacked in one scroll area; slide shape read from `ppt/presentation.xml`. A chart with no title in its file shows no title (the library would draw a Chinese placeholder; the viewer blanks it). |
| Images | `<img>` at natural size | 100% = fit to width, never upscaled. |
| Code | Monaco editor (read-only) | Language from extension (`getMonacoLanguage`). Zoom = font size. Monaco loads its assets from a CDN. |
| `.doc`, `.ppt`, anything else | Message + Download button | No browser renderer exists for the old binary formats. |

**Toolbar:** page/slide indicator (PDF, DOCX, PPTX) with type-to-jump; zoom `− [100]% +` (type 25–500, Enter);
Download. Keys: `+`/`-` zoom, `0` resets, `Esc` closes (or cancels an edit in a field). Shortcuts are ignored while
typing in an input.

**Zoom mechanics:** PDF re-renders at the new width (sharp); DOCX/PPTX/XLSX use CSS `zoom` (needs Firefox ≥ 126);
images scale their width; code changes font size. Zooming keeps the page you are reading (anchored on the middle of
the view).

**Page tracking (`usePagination`):** finds "page" elements inside the viewer's `[data-scroll-frame]` using
`PAGE_SELECTOR` (`[data-pdf-page]`, `.docx-wrapper > section`, `.pptx-preview-slide-wrapper`), and treats the most
visible one as current. It re-measures on scroll, resize, zoom and DOM changes.

**Constants worth knowing:** `ZOOM_PRESETS` (0.25–5), `PDF_TIMEOUT_MS` (60 s), `WORKER_OPEN_MS` (10 s),
`OFFICE_TIMEOUT_MS` (30 s), `MAX_SHEET_ROWS` (2,000), `MAX_SHEET_COLS` (200), PDF base width 800 px (`PdfViewer`).

### 6.10 Grades

**Engine — `lib/grades.ts`** (pure, no React). It mirrors how Canvas computes a course total:

- *Current grade* counts **graded work only**; *final grade* counts **ungraded work as 0**.
- Weighted course: `Σ(weight × group %) / Σ(weights of groups that have counted work)`.
  Plain course: `Σ points earned / Σ points possible`. A "weighted" course whose weights are all 0 falls back to the
  plain total.
- Per group: **drop rules** (lowest N, highest N, never-drop list) apply by *percentage*; the last remaining item is
  never dropped. Excused and "omit from final grade" items are ignored. Extra credit (0-point assignment with a score)
  adds to earned only.
- Functions: `toModel` (Canvas JSON → model), `computeGrade` (current, final, per-group stats, supports what-if
  `overrides` and `onlyGraded`), `gradeTrend` (replays the grade assignment by assignment in grading order),
  `neededAverage` (binary search for the average score needed on remaining work to reach a target),
  `medianComparison` (your graded work re-scored at each assignment's class median; see below).

**Page — `CourseGradesPage.tsx`:** headline tiles (current / "if the rest were zero" / points / work status), grade
over time (`GradeTrendChart`), group breakdown bars, goal calculator, assignment table with filters and per-row what-if
inputs. **The headline numbers are Canvas's own** (`computed_current_score`, `computed_final_score`); our engine is used
for everything else. If our current grade differs from Canvas's by more than 0.6 points, the page shows a
"Rebuilt here from your scores: X%" note rather than hiding the discrepancy. In extension mode the totals are Canvas's
own when the captured course data carried them or the Grades page showed its total (`dev` only); otherwise
`extensionApi.ts` works them out with this same engine from the captured scores and sets `estimated: true` on the
enrollment. The page then treats them as not Canvas's (no mismatch note, which would compare the engine with itself)
and says "Worked out by Courseline from the scores it has seen" under the current grade. Token mode never sets
`estimated`. What-if scores live only in component
state — they are never sent to Canvas.

**Class median grade (estimate).** When any graded assignment has `score_statistics`, a tile after "If the rest were
zero" shows the grade you would have if every graded assignment had scored exactly its class median, and how many
points you are above or below it. The assignment table then also gets a **Class median** column (wide screens) with
each median and your difference. With a token the statistics come from `include[]=score_statistics` (absent when the
instructor hides distributions or the school's Canvas rejects the include). With the extension they are read from the
Grades page's statistics table and kept only when `sensibleStatistics(stats, points)` accepts them (every number in
order, the mean in range, and when the assignment has points, the median at most 5 times them and the high at most
10 times them: a misread is off by a factor of 10, 100 or 1000, while real extra credit on a small bonus item is not). Canvas publishes no course-level median, so this is the median *of each assignment*, not of the students'
totals: an estimate, labelled as one. In extension mode a median can differ slightly from the token version's,
because the Grades page shows statistics rounded to two decimals; that rounding cannot be undone. Both numbers use only the graded assignments that have statistics (the tile
says "Based on N of M" when some do not), so the comparison is like for like.

**Chart — `GradeTrendChart.tsx`:** hand-written SVG (no chart library). One series, 2 px line, 10% area wash, end
label, crosshair that snaps to the nearest point, keyboard (arrow keys / Home / End), and a "Table view" twin.

### 6.11 Assignments and submissions

- `AssignmentDetailPage`: instructions (sanitized), files found in the instructions (opened in the viewer), details,
  `SubmissionForm`, your submission (long text/many attachments truncate with a link to `SubmissionViewPage`), feedback
  comments with a **Reply** box (`postSubmissionComment`), and the rubric. In extension mode (`readOnly`) the
  submission form and the Reply box are replaced by a note that submitting and replying need an access token, and the
  Details card's "Submit in Canvas" button does it in Canvas.
- **`SubmissionForm`** shows a File-upload tab and/or a Text-entry tab depending on the assignment's
  `submission_types`. For files: pick several, see each with its size, remove any; files whose extension is not in the
  assignment's `allowed_extensions` are flagged and block the submit. On Submit it uploads the files one at a time,
  and **only if every upload succeeded** posts one submission with all their ids. If one fails nothing is submitted;
  files that already uploaded keep their id, so a retry only re-uploads the failed ones.
- **The upload itself (`client.uploadFile`)** follows Canvas's three steps: (1) ask for an upload slot, (2) POST the
  slot's fields plus the file (as the **last** form field) to the storage URL, with no token, (3) confirm. Because a
  browser cannot read a redirect's `Location` from another host, step 3 relies on the browser following the redirect
  and, if that lands on a Canvas URL answering 401/403, repeats the GET with the token; it also accepts a direct JSON
  answer or a `Location` header. A confirm address on any host other than Canvas is fetched without the token. If the storage host refuses the browser (CORS) the message says to use "Submit in
  Canvas" (the button in the Details card).

### 6.12 HTML sanitization and file links (`HtmlContent.tsx`)

`sanitize(html, baseUrl)` runs DOMPurify with the HTML profile (this removes scripts, event handlers, iframes,
`javascript:` URLs). A post-sanitize hook then:

- makes relative URLs absolute (Canvas uses root-relative links that would otherwise resolve against *our* origin);
- removes `download` attributes;
- turns links to Canvas files into `href="#"` + `data-canvas-file` (so they cannot navigate or download);
- opens other links in a new tab with `rel="noopener noreferrer"`.

`HtmlContent`'s click handler then sends file links to the viewer. **If you render Canvas HTML anywhere, use this
component.**

### 6.13 Styling system

- **Tailwind 4 only**, no CSS modules. Everything global lives in `src/index.css`. Tailwind scans only `index.html` and
  `src/**/*.{ts,tsx}` (the `@source` lines), so write **complete class names** in source; names assembled from pieces
  (`` `bg-${color}-600` ``) are never generated.
- **Tailwind 4 differences worth knowing** (the project migrated from 3): borders default to `currentColor`, so always give
  a border its color (`border border-neutral-200`); utilities were renamed (`shadow-sm`→`shadow-xs`, `shadow`→`shadow-sm`,
  `rounded`→`rounded-sm`, `outline-none`→`outline-hidden`); buttons no longer get a pointer cursor and placeholders no longer
  get a gray color, so two small rules in `@layer base` restore both. `@apply` only works inside `src/index.css`.
- **Grays are Tailwind `neutral-*`** (true gray). Do not use `slate`/`gray`/`zinc` — the UI is deliberately
  color-neutral so the accent is the only brand color.
- **Brand color is `accent-*`** (never `indigo`/`blue` directly).
- **Status colors** (`green`, `amber`, `red`, `blue` badges) carry meaning and are intentionally *not* tied to the
  accent. Always pair a status color with a text label.
- **Dark mode:** every colored class needs a `dark:` twin. One deliberate exception: the viewer's spreadsheet page is
  white in both modes (`bg-white text-black`, `color-scheme: light`), so a file's own colors read as they were made.
- **Layout rule:** only `Layout.tsx` adds outer page padding; pages and tabs must not. The exception is Messages
  (`/messages` and below): `Layout` gives it no padding and no page scroll (`fullBleed`), because its list and thread
  panes scroll on their own.
- Responsive: mobile-first; the sidebar is a drawer below `md`.

### 6.14 Messages (`MessagesPage.tsx`, `lib/messages.ts`)

Canvas's Inbox (conversations), laid out like a texting app. It works the same in both editions with a token; with the
extension, reading and sending go through the extension (see "Messages (extension mode)" in [5](#5-file-by-file-map)
and risk 17).

- **List.** `useConversations('inbox')` and `useConversations('sent')`, merged by `mergeFolders`: each conversation
  once, newest activity first, unread if either copy says so. If the sent folder fails, the inbox alone is shown. In the
  sent folder Canvas puts your own newest message in `last_authored_message(_at)`; `getConversations('sent')` moves it
  into `last_message(_at)`. A conversation is named by its subject (`chatName`; who it is with when it has none), with
  the other people (`otherPeople`, `peopleLabel`) underneath.
- **Thread.** `useConversation(id)`. Canvas answers newest first; `threadDays` sorts oldest first, groups by local day
  and marks runs by one author (a gap of 10 minutes or more starts a new run). In a group thread (more than two
  participants) the author's name heads each run by someone else. Bodies are plain text, never HTML: `linkify` turns
  http(s) addresses into links (new tab, `rel="noopener noreferrer"`), everything else is text.
- **Attachments.** Images show as thumbnails (`thumbnail_url`, else `url`), other files as cards by kind
  (`attachmentKind`); both open through `openFile()` (the viewer with a token, Canvas in a new tab with the extension).
  An attachment without a `url` (the extension leaves file links out of what it saves) opens the Canvas Inbox in a new tab.
- **Read state.** With a token, Canvas marks a conversation read when `GET /conversations/:id` answers; opening one
  the inbox list still shows as unread also sends `markConversationRead` once, then reloads the lists and the count
  (`useMailRefresh`). With the extension nothing is marked read (`markConversationRead` does nothing, and the
  extension reads threads with `auto_mark_as_read=false`).
- **Unread badge.** `Sidebar` shows `useUnreadCount()` next to Messages ("99+" above 99) and refetches it every 60 s while the tab is visible.
  With a token that is `GET /conversations/unread_count`; with the extension, the unread conversations in the captured
  inbox.
- **Reply.** Enter sends, Shift+Enter adds a line (ignored while an input method is composing); the box grows to
  160 px. `replyToConversation(id, body, files)` uploads each attachment first (three-step upload into the student's
  "conversation attachments" folder), then posts `add_message` with their ids. The message shows at once (Canvas's
  answer, or a local copy) and the lists and thread reload.
- **New message** (`/messages/new`). Course (the visible courses) → recipients from `useCourseRecipients` (teachers
  and TAs as chips, classmates as chips with a search; the student is left out) → subject (up to 255 characters, may
  be empty) → message. `createConversation` makes one shared conversation (`group_conversation: true`) with
  `context_code: course_<id>`, then opens it. Canvas's compose address (`/conversations?context_id=course_1&user_id=5`),
  opened on the app's own address, lands here filled in (`ComposeRedirect`, `composeTarget`); a person named in it who
  is not in the class list still shows as chosen. Such links inside Canvas HTML shown in the app are not rerouted:
  `HtmlContent` makes them absolute, so they open Canvas's own Inbox in a new tab.
- **Limits.** Up to 10 files and 25 MB in all per message (`MAX_FILES`, `MAX_FILES_BYTES`; the extension's
  `cleanSendRequest` enforces the same).
- **Extension mode.** Opening Messages asks the extension to read the inbox, the sent folder and every thread
  (`refreshMail`, at most every two minutes); a status line says "Updating messages from Canvas…", or offers "Load
  latest messages" when the extension wants a click. Sending goes through `sendMessage` (attachments as base64,
  `filesForExtension`), which waits up to a minute plus 30 s per file. A thread with fewer captured messages than its
  `message_count` says only the newest have come through.

### 6.15 Dates, times and the computer's clock

Dates follow the app language (`getLocale()`); the 12/24-hour clock and the first weekday follow the computer
(`lib/systemClock.ts`), because browsers do not expose those settings (Chrome on a Mac shows "3:06 PM" with the
24-hour switch on).

- **Where the settings come from.** Only `npm run dev`: the `courseline-system-clock` plugin in `vite.config.ts` calls
  `readSystemClock()` (`lib/systemClockServer.ts`: `defaults read -g` for `AppleLocale`, `AppleICUForce24HourTime`,
  `AppleICUForce12HourTime` and `AppleFirstWeekday`; macOS only, 2 s per read) on every page load and writes
  `<meta name="courseline-clock" content="{locale, hourCycle, firstDay}">` into `index.html`. A built app (either
  edition) has no tag.
- **Reading them.** `parseClock` drops anything malformed. What the tag does not say comes from the region (the tag's
  `locale`, else `navigator.language`) through `Intl`. Read once per page load and cached (`resetClock()` for tests).
- **Using them.** `withClock(options)` adds the `hourCycle` to any format that shows the hour (`formatDue` in
  `lib/format.ts`, the Messages times); pass every new format with `hour` through it. `weekStartDay(fallback)` sets the
  calendar's first column; `CalendarPage` passes Monday for Spanish and Sunday otherwise, used only when neither the
  tag nor the browser knows.

---

## 7. Cookbook: how to change anything

### Add a new top-level screen

1. Create `src/pages/MyPage.tsx` exporting a component. Do not add outer padding.
2. In `App.tsx`, load it on demand: `const MyPage = lazyPage(() => import('./pages/MyPage'), 'MyPage');`, then add
   `<Route path="my-page" element={<MyPage />} />` inside the `<Route element={<Layout />}>` block.
3. Add a `<NavLink>` in `components/Sidebar.tsx` (with an icon from `navIcons` in `components/icons.tsx`, and its label
   in `t()`).
4. A screen that fills the whole area and scrolls its own panes (like Messages) gets no page padding: extend the
   `fullBleed` check in `components/Layout.tsx` with its path.
5. Add the route and a few words it shows to the `it.each` table in `App.test.tsx`, so the smoke test renders it.

### Add a new tab inside a course

1. Create the page component (it renders below the course header, so no title needed).
2. In `App.tsx`, declare it with `lazyPage(...)` (as above) and add a child route under `courses/:courseId`:
   `<Route path="quizzes" element={<CourseQuizzesPage />} />`.
3. In `components/CourseTabs.tsx`, add an entry to `tabs`:
   `{ to: \`${base}/quizzes\`, label: t('Quizzes'), active: pathname.startsWith(\`${base}/quizzes\`) }`.
   Order in the array is the order on screen. The first tab (Pages) uses the bare course URL as the default.

### Add or change a test

Tests live next to the code (`thing.ts` → `thing.test.ts`) and run with `npm test`. Pure logic (`lib/`) needs nothing
special. For anything that calls Canvas, use the helper in `src/test/fakeFetch.ts`:

```ts
import { installFetch, json } from '../test/fakeFetch';
const { calls } = installFetch(({ url }) => (url.pathname === '/api/v1/courses' ? json([{ id: 1, name: 'Bio' }]) : undefined));
// ...call the code, then assert on the result and on `calls` (URLs, headers, bodies)
```

Unmatched requests get a 404, so a missing route fails loudly. Remember `afterEach(() => vi.unstubAllGlobals())`.
For components, render with `react-dom/client` inside `act` (see `SubmissionForm.test.tsx`) and mock
`../context/AuthContext` so no provider is needed. After fixing a bug, add the test that would have caught it.

Tests always run the full app, on both branches: `vite.config.ts` turns the edition switch off in Vitest's `test` mode,
so `edition.json` saying `"apiOnly": true` on `main` changes nothing here. To test what the API-token edition shows,
mock the switch as `pages/LoginPage.apiOnly.test.tsx` does: `vi.mock('../edition', () => ({ API_ONLY: true }))`. The
extension's own logic is tested by `extension/**/*.test.js` (plain JS, run by the same `npm test`; `dev` only, since
`main` has no `extension/`). `npm run e2e` (a real
Chrome with the unpacked extension against a mock Canvas; start `npm run dev` first) is separate: neither `npm test` nor
CI runs it, and it exists only on `dev` (`main` has no extension to test).

### Fetch a new kind of Canvas data (end to end)

1. **Type it** in `api/types.ts` (only the fields you use).
2. **Endpoint:** add a function to the `api` object in `api/canvas.ts`, e.g.
   `getQuizzes: (courseId: number) => client.getAll<Quiz>(\`/courses/${courseId}/quizzes\`)`.
   Use `client.getAll` for lists, `client.get` for one object, `client.send` for writes. Check
   [8](#8-canvas-quirks-reference) first: some obvious endpoints have traps (the account-wide `/announcements` only covers
   a window around today, so `getAnnouncements` asks the course's `discussion_topics` instead).
3. **Hook:** add to `hooks/useCanvasData.ts`:
   ```ts
   export function useQuizzes(courseId: number) {
     const api = useApi();
     return useQuery(`quizzes:${courseId}`, () => api.getQuizzes(courseId));
   }
   ```
   The key **must contain every input** to the fetcher.
4. **Use it:** `const { data, error, refetch } = useQuizzes(id); if (error) return <ErrorMessage .../>; if (!data) return <Spinner />;`
5. If a call is expected to fail for some courses (hidden tab), follow `getCourseFiles` and return `null` on
   `forbidden`/`not_found`/`unauthorized`.
6. **Extension mode:** `createExtensionApi` in `src/extension/extensionApi.ts` returns the same `CanvasApi` type, so the
   typecheck fails until it has the same function. Answer from what was captured (`ds.items('quizzes', courseId)`; an
   address with no route in `ROUTES` in `extension/lib/capture.js` is still kept, as kind `other` with its `route`), throw
   `notSynced(...)` when nothing was captured, or `hiddenByCanvas(...)` when `hidden(courseId, section)` says the course
   menu leaves that tab out. A write or a file download is `needsToken`. If Sync now should load it, the Canvas page that
   requests it goes in `COURSE_PAGES` or `EXTRA_COURSE_PAGES` in `src/extension/pullPlan.ts`; for a freshness chip, add
   its kinds to `FRESHNESS_TYPES` in `extensionApi.ts`.

### Add to Messages

Messages follows the usual data path in both modes. Its code is grouped under an `Inbox` comment in `api/canvas.ts`,
`hooks/useCanvasData.ts` and `src/extension/extensionApi.ts`; the screen is `pages/MessagesPage.tsx`.

1. **Reads:** a function in `api/canvas.ts` and a hook. Keys in use: `conversations:inbox`, `conversations:sent`,
   `conversations:unread` (the sidebar badge, which `Sidebar.tsx` also reloads every 60 s while the tab is visible), `conversation:<id>` and
   `recipients:<courseId>`. In extension mode, answer from `mailFrom(snapshot.records)`, which merges Canvas's own Inbox
   (GraphQL) with REST-shaped records. Canvas loads a thread only when it is clicked, so threads reach the extension
   through `refreshMail` (opening Messages), not through Sync now.
2. **Writes:** after any change, call `useMailRefresh()` (in `MessagesPage.tsx`) so the lists, the unread count and the
   open thread reload in place. In extension mode a write either rejects with `needsToken` or is sent by the extension,
   which on purpose accepts only a reply or a new message: anything else means changing `cleanSendRequest` and
   `sendRequestFor` in `extension/lib/message.js` (and its tests), the path check in the `send` handler of
   `extension/inject.js`, and risk 17 in [9](#9-security-model). `markConversationRead` does nothing in extension mode
   (threads are read with `auto_mark_as_read=false`, so Canvas keeps its own read state).
3. **Display logic** that needs no React (days, runs, names, labels, times) goes in `lib/messages.ts`, tested in
   `lib/messages.test.ts`. Bodies are plain text: show them through `linkify`, never as HTML.
4. **Attachments:** at most 10 files and 25 MB per message, set in two places that must stay equal: `MAX_FILES` /
   `MAX_FILES_BYTES` in `MessagesPage.tsx` and in `extension/lib/message.js`. With a token they are uploaded by
   `uploadAttachments` in `api/canvas.ts`; in extension mode they travel as base64 (`filesForExtension`) and `inject.js`
   uploads them from the Canvas tab.

### Make a request that is not a plain JSON call

Add a method to `api/client.ts` (like `getBlob` or `uploadFile`; `uploadFile` takes extra slot fields, such as the
`parent_folder_path` Messages passes) and expose it through `canvas.ts`. **Do not call `fetch` on a Canvas URL from a
component** — it would bypass the proxy, the auth header and error mapping. The extension API needs the same function:
usually `needsToken`, as for `downloadFile` and `uploadSubmissionFile`.

### Change the default accent color or the preset list

- Presets: `ACCENT_PRESETS` in `lib/accent.ts`. The **first** entry is the default (`DEFAULT_ACCENT`).
- Also change the default CSS variables `--accent-50 … --accent-950` in `src/index.css` to the same palette (the
  defaults render before any JavaScript runs). Easiest: run `accentVars('#yourhex')` and paste the 11 values.
- The default is "no override"; choosing the default preset in Settings clears the stored value.

### Change colors, fonts, spacing or other design tokens

Edit `@theme` in `src/index.css` (Tailwind 4 reads its theme from CSS), e.g. `--font-sans: 'Inter', system-ui, sans-serif;`
or `--radius-xl: 1rem;`. Anything defined there becomes available as utilities (`font-sans`, `rounded-xl`). The accent colors
are special: they read CSS variables so users can change them at run time (see [6.6](#66-settings-theme-accent-and-what-is-stored)).

### Change how long data is cached

`STALE_MS` in `context/DataContext.tsx`. For one screen to always refresh, call `refetch()` on mount.

### Change the grade calculation

Edit `lib/grades.ts` only; the page just displays results. Rules live in `computeGrade` (weights/final/current),
`applyDrops` (drop rules), `medianComparison` (the class median tile). With a token, the headline numbers come from
Canvas when it sends them, and the mismatch note on the grades page will tell you how far your maths diverges. In
extension mode the headline *is* `computeGrade`'s result (`extensionApi.ts` fills `computed_current_score` /
`computed_final_score` with it when Canvas's own totals were not captured), so nothing on screen flags a mistake: rely
on `lib/grades.test.ts`.

### Add support for another file type in the viewer

All in `components/FileViewer.tsx`:

1. `FileCategory` type and `getFileTypeCategory` — map extensions/content types to a new category.
2. Write a viewer component taking `{ fileUrl, zoom }`. `fileUrl` is a **local blob URL**: read it with `fetch(fileUrl)`.
   Render untrusted content safely (sanitize any HTML; never inject raw strings).
3. Add the category to `PREVIEWABLE`, and a line to the switch at the bottom of `FileViewer`.
4. Make it fill its panel (`h-full`) and respond to `zoom`. If it has pages, give its scroll area
   `data-scroll-frame` and add an entry to `PAGE_SELECTOR`.
5. For a new code language, add it to `codeExts` and `getMonacoLanguage`.
6. Message attachments choose their card icon (and whether they show as an image) separately: add the type to
   `attachmentKind` in `lib/messages.ts`.

Do **not** add anything that points the browser at a Canvas file URL (iframe, `<embed>`, anchor): it can trigger an
automatic download or be blocked from embedding. Read bytes through the API instead.

### Change viewer limits and defaults

| Want to change | Where |
|---|---|
| Zoom steps / range | `ZOOM_PRESETS` (min/max derive from it) |
| Spreadsheet row / column cap | `MAX_SHEET_ROWS`, `MAX_SHEET_COLS` |
| PDF page width at 100% | `baseWidth` in `PdfViewer` |
| PDF worker patience / total timeout | `WORKER_OPEN_MS`, `PDF_TIMEOUT_MS` |
| Office render timeout | `OFFICE_TIMEOUT_MS` |
| Viewer size on screen | `Shell` in `FileViewer.tsx` (`h-[90vh]`), and `max-w-6xl` in `FileViewerModal.tsx` |

### Persist a new user setting

Follow `ThemeContext`/`CourseFilterContext`: a context (or local state) with a `courseline.<name>` key, wrap
`localStorage` reads/writes in `try/catch`, and render correctly when storage is unavailable. If it must apply before
first paint, mirror it in the inline script in `index.html`.

### Add a settings section

In `pages/SettingsPage.tsx`, write a `function MySection()` returning a `<Card title="...">` and add it to the right tab in
`SettingsPage` (or add a tab to `TABS` and the `Tab` type; its label is passed through `t()` there, so add it to the
dictionaries). A section about the browser extension goes behind `!API_ONLY` (as the Browser extension card is), so the
API-token edition does not show it.

### Add or change a translatable string

Wrap user-visible text in `t('English text')` (`import { t } from '../i18n'`; use `{name}` placeholders and pass values as the
second argument, never string concatenation, so word order can differ). Then add the same English text as a key in
`i18n/es.ts` and `i18n/pt.ts` (the tests fail if the two dictionaries differ). Separate strings for singular and plural. Error messages from `api/client.ts` and Canvas's own content are not
translated. Dates follow the app language through `lib/format.ts`; the 12/24-hour clock and first weekday follow the computer (`lib/systemClock.ts`), so pass any format with `hour` through `withClock()`.

To add a language: add it to `Language`, `LANGUAGES`, `dictionaries` and `LOCALES` in `i18n/index.ts` (and to the browser-language check in `detectLanguage`), and create its dictionary file.

### Show a date or time

Use the helpers in `lib/format.ts` (`formatDue`, `formatDay`, `formatAgo`) or, for Messages, `listTime` / `timeOf` in
`lib/messages.ts`. For a new format, pass `getLocale()` (the app language) and wrap the options in `withClock()` from
`lib/systemClock.ts` whenever they include `hour`:
`d.toLocaleTimeString(getLocale(), withClock({ hour: 'numeric', minute: '2-digit' }))`. Without it, Chrome on a Mac
shows "3:06 PM" even when the computer uses the 24-hour clock. A calendar's first column is `weekStartDay(fallback)`.
The settings are read once per page load (and `format.ts` caches its formatter per language), so a change in System
Settings shows after a reload. The computer's settings reach the page only through the dev server on macOS
(`<meta name="courseline-clock">`); in a build, and on other systems, the browser's region decides. In tests, add the meta
tag and call `resetClock()` (see `lib/systemClock.test.ts`).

### Change the sidebar or header

`components/Sidebar.tsx` (links, the Messages unread badge, which reloads every 60 s while the tab is visible, the course list, and the
extension's sync status `ExtensionStatus`, full edition only), `components/Header.tsx` (user, log out; the theme toggle
is on the Settings page).

### Point the app at a different Canvas / change the proxy

With a token, the address comes from the sign-in form, and a saved sign-in (`courseline.credentials`) wins over `.env`:
log out and sign in again with the new address and a token from that Canvas. `VITE_CANVAS_BASE_URL` in `.env` only
pre-fills the form (with `VITE_CANVAS_API_TOKEN`, skips it) and is the dev proxy's target; restart `npm run dev` after
changing it. **With `VITE_USE_DEV_PROXY=true`, every Canvas request goes to `VITE_CANVAS_BASE_URL`, token included,
whatever address was typed at sign-in**: turn the proxy off, or point it at the same Canvas, before signing in to a
test or mock Canvas. The proxy target is read in `vite.config.ts`; the proxy prefix `/canvas-proxy` is set in
`AuthContext.tsx`. In extension mode the address is saved in Settings → Connection or the extension's popup (both go
through `applyCanvasAddress` in `extension/lib/canvasAddress.js`); changing it clears the old address's captured data.

### Change how Canvas HTML is cleaned

`sanitize()` in `components/HtmlContent.tsx`. Loosening it (allowing iframes, scripts, styles) has direct security
consequences — see [9](#9-security-model). Some content never goes through it: message bodies are plain text with
links (`linkify` in `lib/messages.ts`), spreadsheets are drawn as elements (`SheetTable`), and what the rich text box
produces is cleaned by `cleanEditorHtml()` in `RichTextEditor.tsx`.

### Change course colors

Automatic colors: `BASE` (12 curated colors) and `colorAt` (generated ones after those) in `lib/courseColor.ts`, handed
out by a course's position among all the student's courses (`buildCourseColors`), so no two share one. A color or icon
the student picks in Settings → Courses → Course colors and icons is saved in `courseline.course-styles`
(`context/CourseStyleContext.tsx`) and wins. Cards, the sidebar, the calendar and lists all read it through
`useCourseColors()` in `hooks/useCanvasData.ts`. Canvas's own per-course colors (`/users/self/colors`) are not used
(the extension captures them as kind `colors`, but no screen reads them).

### Update dependencies

`npm outdated`, then update one at a time and run `npm test` and `npm run build`, plus click through the affected screen.
Watch `pdfjs-dist` (its API changes between major versions; the legacy build path and the `?url` worker import are in
`FileViewer.tsx`) and `xlsx` (installed from SheetJS's site, not npm — update by changing the tarball URL in
`package.json`).

### Build for production

`npm run build` → static files in `dist/`. **Do not publish this as-is**; read [9](#9-security-model). The dev proxy
does not exist in a build, so file previews at CORS-restricted schools would need a real backend proxy. The edition
depends on the branch: `dev` builds the full app, `main` (`edition.json` says `"apiOnly": true`) builds the API-token
edition, and `COURSELINE_EDITION=api` makes any build API-only. Two things only the dev server adds are missing from a
build: the computer's clock settings (`<meta name="courseline-clock">`, so the browser's region decides) and the dev
entries in the CSP's `connect-src` (`ws://localhost:*`, `ws://127.0.0.1:*`, `http://localhost:*`; see `src/lib/csp.ts`).

### Keep a feature out of the API-token edition

Anything that looks for, talks to or describes the browser extension goes behind `API_ONLY` from `src/edition.ts`, as
in `{!API_ONLY && <ExtensionStatus />}` (`Sidebar.tsx`; also `App.tsx`, `SettingsPage.tsx`, `LoginPage.tsx`,
`PullContext.tsx`). The build replaces the constant, so on `main` the code behind it is left out of the bundle.
`extensionInstalled()` in `src/extension/bridge.ts` already returns `false` there, so code that only runs once it is true
needs nothing more. Features that work with a token (Messages, the viewer, grades) need no guard. Test the API-only side
with the switch mocked (see "Add or change a test").

### Try the API-token edition locally

On `dev`, run `COURSELINE_EDITION=api npm run dev`, or `COURSELINE_EDITION=api npm run build && npm run preview`
(`vite.config.ts` reads the variable from the environment or from `.env`). Check that the sign-in page offers only the
token form, Settings → Connection has no extension cards, the sidebar has no sync status, and the page has no
`<meta name="courseline-app">`, so an installed extension ignores it (after a build, `grep -c courseline-app
dist/index.html` prints `0`). Without the variable, the dev server on `dev` is the full app again.

### Ship a change to the API-token edition (`main`)

`main` is the API-token edition and `dev` the full app. They share all code and docs and differ only in `edition.json`
and in `extension/`, `e2e/` and the `e2e` script, which `main` does not have.

1. Work and commit on `dev`. **Never edit `edition.json` on `dev`**: as long as `dev` leaves it alone, a merge never
   carries `dev`'s `"apiOnly": false` into `main`.
2. On `dev`: `npm run typecheck && npm test && npm run build`, and `COURSELINE_EDITION=api npm run build` to check that
   the API-only bundle builds.
3. `git checkout main`, then `git merge --no-commit dev; git rm -r -q -f --ignore-unmatch extension e2e && git commit --no-edit`
   (this keeps `extension/` and `e2e/` off `main`; see [Branches and editions](#branches-and-editions) for conflicts). Then
   `cat edition.json` must still print `{ "apiOnly": true }` and `ls extension e2e` must fail.
4. Push `main`. CI (`.github/workflows/ci.yml`: typecheck, test, build) runs on pushes to `main` and on pull requests,
   not on pushes to `dev`.
5. Switch back to `dev` to keep working.

### Change what Sync now opens, or its pace

Full edition only. Pages per course: `COURSE_PAGES` (always) and `EXTRA_COURSE_PAGES` (with "everything") in
`src/extension/pullPlan.ts`; account pages, once per run: `ACCOUNT_PAGES`. Tabs the school hides are skipped through
`hiddenSections`, except the sections in `ALWAYS_TRIED` (Discussions), which some schools serve anyway; a section added
there needs a way to tell that its page really opened, as `listPage` does (a redirect lands on the course home and
`visited` still names the address asked for). Pace: `CONCURRENCY` (background tabs at once), `PAUSE_MS` (between pages) and `IDLE_MAX_MS` (longest
wait for a page to go quiet) in `extension/lib/pullRunner.js`; "quiet" itself is `IDLE_MS` in `extension/inject.js`.
Keep `TABS_AT_ONCE` in `pullPlan.ts` equal to `CONCURRENCY` (it feeds the time estimate). A change of pace or scope
changes what the design doc allows: update "Deviations from the design doc" and risk 8 in [9](#9-security-model), and
do not add scheduled or repeating sync. After changing anything under `extension/`, reload the extension in
`chrome://extensions`.

---

## 8. Canvas quirks reference

Collected from the code comments and field experience. These explain code that otherwise looks odd. Rows marked
*(extension mode)* are about Canvas's own web pages, which the extension reads; the rest are about the REST API.

| Quirk | Where it matters |
|---|---|
| Lists default to **10 per page**; the next page is in the `Link` response header and is opaque. | `getAll` |
| Array params need brackets (`include[]=`). | `buildQuery` |
| **Rate limit returns 403, not 429**, with "Rate Limit Exceeded" in the body. | `toApiError` |
| **401 means two things:** bad token ("Invalid access token") **or** "not authorized" (e.g. Files tab disabled). Only the first logs you out. | `toApiError` |
| Restricted/past-term courses come back **without a `name`** and `access_restricted_by_date: true`. | `getCourses` filters them |
| `computed_current_score` etc. are `null` when grades are hidden or nothing is graded: show "—", not 0. | `getGrade`, `formatGrade` |
| Modules with **>50 items** omit `items`. | `getModules` refetches them |
| Many schools **hide the Pages tab**: `/pages` fails, `/pages/:slug` works. | `getPages` discovery chain |
| Module `Page` items' `html_url` is the *module-item* URL, not the page: use `page_url` (the slug). | Files tab |
| Different slugs can resolve to the **same page**. | `getPages` de-dupes |
| **Files tab hidden** → `/courses/:id/files` is 401/403, but files are reachable via modules. | `getCourseFiles` |
| File downloads **redirect to another host** (file storage). | proxy `followRedirects`, `getBlob` |
| `file.url` from `GET /files/:id` is **pre-signed** (verifier in the URL): works without a session or auth header. | file viewer |
| Web links to files (`/courses/1/files/2`) are the Canvas **UI**: need a login session, refuse to be embedded in frames. | why we use the API |
| Posting a submission comment needs the **real user id**, not `self`. | `postSubmissionComment` |
| `due_at` can be null; per-student overrides are not reflected. | everywhere |
| `score_statistics` (class min/median/max) may be rejected or absent depending on the install and the instructor's settings. | `getAssignmentGroups` retries without it; the class median tile shows only when some graded assignment has it |
| Canvas IDs are numbers but can exceed 2^53 on some shards (`Accept: application/json+canvas-string-ids`). | not handled; noted |
| The account-wide `/announcements` only returns a window around today (two weeks back, four ahead) unless dates are given, so older announcements vanish. | `getAnnouncements` asks the course's `discussion_topics?only_announcements=true` instead |
| A course's `discussion_topics` list leaves announcements out. | `getDiscussions` and `getAnnouncements` use the same address |
| `/users/self/upcoming_events` mixes calendar events in with assignments. | `getUpcoming` keeps type `assignment` only |
| Submission comments and rubric scores come only when asked for, with `include[]=submission_comments` / `rubric_assessment` on `submissions/self`; `include[]=submission` on the assignment does not carry them. | `getMySubmission` |
| `include[]=body` on `/pages` still leaves some pages without a body (block-editor pages, or a Canvas that ignores it). | `getPages` fetches those one by one |
| In the **sent** folder (`/conversations?scope=sent`) your own newest message is in `last_authored_message(_at)`; `last_message(_at)` may be empty. | `getConversations`, `mailFrom` |
| `/conversations/unread_count` sends the number as a **string**. | `getUnreadCount` |
| `GET /conversations/:id` **marks the conversation read** while answering, so the thread already says "read" and only the inbox list still says unread. `auto_mark_as_read=false` reads it without that. | `Thread` in `MessagesPage.tsx` checks the list too, then calls `markConversationRead`; the extension reads threads with `auto_mark_as_read=false` |
| A thread's `messages` come **newest first**. | `threadDays` sorts them oldest first |
| Message attachments are uploaded first, one at a time, into the student's own files (`/users/self/files` with `parent_folder_path: 'conversation attachments'`); the message then carries their `attachment_ids`. | `uploadAttachments` in `canvas.ts`, `uploadAttachment` in `inject.js` |
| `POST /conversations` to several recipients starts one private conversation per recipient unless `group_conversation: true` is sent, and answers with an **array**. | `createConversation`, `sendRequestFor` |
| Message attachment `url`s carry a `verifier`: they open for anyone who has them. | the extension strips them (`stripSensitive`), so in extension mode an attachment opens the conversation in Canvas |
| Canvas's "message this person" link is `/conversations?context_id=course_1&user_id=5&user_name=…`. | `ComposeRedirect` in `App.tsx`, `composeTarget` |
| Who a student can write to: `/courses/:id/users` with `enrollment_type[]` and `include[]=enrollments`; the role is only in each enrollment's `type` (`TeacherEnrollment`, `TaEnrollment`). | `getCourseRecipients` |
| *(extension mode)* Canvas's Inbox loads through GraphQL; the inbox and the sent folder differ only in the query's variables, and a thread loads only when it is clicked. GraphQL ids are base64 of `"<Type>-<id>"`. | `mailFrom`, `plainId`; why opening Messages has the extension read the mail itself (`refreshMailViaTab`) |
| *(extension mode)* The Inbox page carries no form token; the student's Settings page (`/profile/settings`) does (`input[name=authenticity_token]`). | `sendViaTab` and `refreshMailViaTab` open `/profile/settings` |
| *(extension mode)* The student Grades page fetches no assignments or scores: they are in `window.ENV`, and the names only in the `#grades_summary` table. | `readPage` in `inject.js`, `gradesPageGroups` |
| *(extension mode)* The class statistics under a grade (`#score_details_<id>`) have their labels in the student's language, and the page's language does not say how the numbers are written (a Spanish page still writes `6.88`). | `inject.js` reads them by position and each number by its own shape; `sensibleStatistics` keeps them only when they are in order and fit the points |
| *(extension mode)* A course tab the school hides only redirects to the course home; which tabs show is only in the page's `#section-tabs`. The API ignores the course menu. Exceptions seen on one school (Oct 30, 2026): `/courses/<id>/discussion_topics` opened (200, no redirect) although Discussions was not in the menu, and each assignment's own page (`/courses/<id>/assignments/<aid>`) opens and is drawn on the server, with no API call for the assignment (its dates are localized text; the numbers are in `ENV`). | `hiddenSections`; `pullPlan.ts` skips those pages except `ALWAYS_TRIED`; `listPage` says whether a list page opened; `assignmentPage` |
| *(extension mode)* The Modules page draws its modules into the HTML (no API call carries them), and its items late. | `readLatePage` in `inject.js` reads `#context_modules` when the page is parsed, on load, and once more just before the page reports it has gone quiet |

---

## 9. Security model

**The core risk:** the Canvas token is stored in `localStorage`. Any JavaScript running on this page can read it, and it
acts as *you*, with your full Canvas access, until it expires or is revoked. That is acceptable for a personal tool on
your own computer. It is **not** acceptable for a shared or public deployment.

The token risk applies to both editions whenever someone signs in with a token. The browser extension parts below (the bridge, captured data, Sync now, messages through the extension) concern the `dev` edition, which is the one that uses the extension. The API-token edition on `main` has no `<meta name="courseline-app">` (`vite.config.ts` removes it), so `extension/bridge.js` never answers its page, and `API_ONLY` turns off every place the app looks for the extension (`extensionInstalled()` is always false).

What the code does to reduce the risk:

- **All instructor HTML is sanitized** (DOMPurify) before display; scripts, event handlers, iframes and `javascript:`
  URLs are stripped.
- **Spreadsheet cells** are untrusted: the sheet is drawn as React elements (text, never HTML), and only http(s) cell links become links.
- **Message bodies** are plain text: shown as text (never HTML), and only http(s) addresses in them become links
  (`linkify` in `lib/messages.ts`), which open in a new tab with `noopener`.
- **Word hyperlinks** are restricted to http/https/mailto.
- **Tooltip and label text** is rendered by React (escaped), never via `innerHTML`.
- **Requests never send Canvas cookies** (`credentials: 'omit'`).
- **The token only goes to the Canvas address, over https**: `http://` addresses are upgraded, pagination links are
  re-rooted on Canvas, and upload storage and confirm addresses on other hosts get no token (see [6.2](#62-the-api-client)).
  With the dev proxy on (`VITE_USE_DEV_PROXY=true`), the token goes to the dev server instead, which forwards every
  request to `VITE_CANVAS_BASE_URL` from `.env`, whatever address was typed at sign-in.
- **The extension takes the app's commands only from the app**: `background.js` ignores `setCanvasHost`, `openPage`,
  `cancelPull`, `setPinned`, `sendMessage` and `refreshMail` (`APP_ONLY`) unless they come from a `localhost`/`127.0.0.1`
  tab (where `bridge.js` runs).
- **PDF.js** runs on the patched major version (older ones had a code-execution advisory for malicious PDFs).
- **File links never navigate or download** without an explicit Download click.

What it does *not* do (do these before anyone else uses this):

- Move the token out of the browser (a small backend that holds it, or Canvas OAuth2 with a developer key).
- Tighten the Content-Security-Policy (it exists but allows inline scripts and any https host; see risk 13).
- Audit dependencies in CI (it installs the locked versions with `npm ci`, but runs no `npm audit`).

Practical rules:

- Never commit `.env`. Never build and publish with `VITE_CANVAS_API_TOKEN` set.
- When sharing the project folder, **send everything except `node_modules` and `.env`.**
- Revoke tokens you no longer use (Canvas → Settings → Approved Integrations).
- Each person must use **their own** token.

### Deviations from the design doc

The "Courseline Canvas Sync — Design Doc" (Oct 10, 2026) says Sync now should open Canvas pages in **foreground** tabs
the student can watch, and lists "hidden background tabs auto-opening dozens or hundreds of Canvas pages" as
something not to build. It also says the extension should never relay through a second tab. The product now does these differently, by the owner's decisions (Oct 13, 2026, unless a row gives another date):

| Doc | Now | Why |
|---|---|---|
| Foreground tabs the student watches | Background tabs in the current window, each closed by the extension, with a live preview inside Courseline | No new windows or focus changes; works the same in Arc and other Chromium browsers (popup windows behave badly in Arc) |
| Confirmation in the extension | **Start** and **Stop** are inside the Courseline page; the first **Connect** with nothing captured starts the essentials at once (that click is the confirmation) | One place for the student to look |
| One bulk "Sync now" | Also refresh one course, one kind of data (click a freshness chip) or any single page address | Pull exactly what is wanted, quickly |
| About 1–2 s between pages, one page at a time | 4 background tabs at once (`CONCURRENCY`, since Oct 27, 2026), each pausing 400 ms (`PAUSE_MS`) after a page before its next one | A full pass, with linked pages, finishes much sooner |
| Never relay through a second tab | The extension sends the messages the student writes in Courseline. It opens the student's Canvas Settings page in a background tab, whose page script posts the reply or new message (and its attachments) with the form token on that page, then closes it. No cookie is read (Oct 29, 2026) | Messages work without a token. Canvas's Inbox page carries no form token, its Settings page does. See risk 17 |
| No page loads outside a Sync now the student confirmed | Opening Messages has the extension read the inbox, the sent folder and up to 100 threads (GET only, `auto_mark_as_read=false`) from the same kind of background tab, at most every two minutes (Oct 29, 2026) | Canvas loads a thread only when it is clicked in its own Inbox, so passive capture never sees most threads |

What is kept from the doc: nothing runs unless the student clicked in Courseline (enforced by the bridge), every page
is shown in the preview as it loads, Stop works between pages, there is a pause between pages (400 ms in each of
4 background tabs since Oct 27, 2026; one tab at a time before), scope is the student's chosen courses, and nothing
is scheduled or repeats. What is **not** kept: the student does not see the tabs themselves, nor the ones that send
and read messages, which are not in the preview either. If that matters for a school's terms, it is the first thing to
revisit. The doc records these departures, the build's status and the two editions in its own sections (updated Oct 30,
2026: [Courseline Canvas Sync — Design Doc](https://claude.ai/artifact/PN7CvmEZhstZXz6VuUTbRS)).

### Risk register

Everything known to be risky, in one place. **Status:** *Open* = not addressed; *Mitigated* = reduced, with what is left
stated; *Accepted* = deliberately left, fine for a personal tool. "Before sharing" means it must be resolved before
anyone other than the author uses the app or the extension. **Editions:** 1, 13 and 14 apply to both; every other
risk comes from the browser extension and so applies to `dev`. The API-token edition on `main` never talks to the
extension. If someone installs the extension anyway, it still captures from Canvas pages once an address is saved in
its popup (4–7, 11, 12, 15), but the app never reads what it holds.

| # | Risk | Where | Status | Notes / what would fix it |
|---|---|---|---|---|
| 1 | **The Canvas token is readable by any script on the app's page** (it lives in `localStorage` and acts as the user until revoked). | `AuthContext.tsx` | Accepted, **before sharing** | Backend that holds the token, or Canvas OAuth2. See the top of this section. |
| 2 | **Any script running on the app's page can ask the extension bridge for the captured data** (grades, course names, submissions) and can ask it to open Canvas pages in background tabs (see risk 8) and to send or read messages as the student (see risk 17). Same exposure as the token in `localStorage`: fine for a personal tool; it needs a proper boundary before the app is deployed for anyone else. | `extension/bridge.js`, `src/extension/bridge.ts` | Accepted, **before sharing** | The bridge now answers only the Courseline app (risk 3), but a script *inside* that page is still trusted. Fix: an exact-origin grant per site, or `externally_connectable` with a fixed origin. A script cannot start a run by itself: `bridge.js` refuses unless the page has a live user click (`navigator.userActivation.isActive`), or the run continues the run that has just ended (a chain a click started; within 2 minutes, never after Stop), and the extension no longer caps how many pages a run or an hour opens (owner's decision, Oct 27, 2026). A script *can* start one while the student is clicking something. |
| 3 | **The bridge could answer any `localhost` page**, so another project running on the machine could read the captured data. | `extension/bridge.js` | Mitigated | It now answers only on a short list of ports (5173–5180, 4173) **and** only if the page declares `<meta name="courseline-app">`. Match patterns cannot restrict ports, so this is checked at runtime. Another local page could still add that tag and use one of those ports. `background.js` also refuses the app's commands (`setCanvasHost`, `openPage`, `cancelPull`, `setPinned`, `sendMessage`, `refreshMail`) from any tab that is not on `localhost`/`127.0.0.1`, so a Canvas page or any other site cannot give them even if a future script forwarded them. |
| 4 | **Captured responses are stored unencrypted** in `chrome.storage.local`: grades, names, assignment and page text. Anyone with access to the browser profile, or malware running as the user, can read it. | `extension/background.js` | Mitigated | Email, login id and avatar fields, credential fields and **capability URLs** (calendar feed links, file links carrying a `verifier`, which work for anyone who holds them) are removed before saving (`stripSensitive`): a plain URL field is dropped; HTML (instructions, page bodies) keeps its links with only the `verifier` / `access_token` parameter taken out (`scrubCapabilityParams`, `&amp;` separators too), and HTML that still carries a calendar feed or `sessionless_launch` link is dropped whole, leaving `<key>_removed: true` (an assignment's `description_removed` makes its screen say the instructions were not kept, instead of "not synced yet", which no sync would change); anything older than 90 days is deleted (checked hourly). Still unencrypted at rest. **Clear captured data** removes the captures and what is derived from them (`keysToClear`) but deliberately keeps the student's own settings (the saved Canvas address, the courses chosen in the app, where the app lives). |
| 5 | **The capture scripts run on every https page** (the extension asks for access to all sites so it can recognise a Canvas on any domain). A bug in `inject.js` could interfere with an unrelated site, and while a page is undecided, up to 200 same-origin `/api/v1/` responses wait in memory. | `extension/inject.js`, `manifest.json` | Mitigated | Non-Canvas pages are dropped after 4 s and nothing leaves the page. Alternative: ask once per school domain instead of all sites (costs one click). |
| 6 | **A page can forge captures.** `relay.js` accepts any message with the right tag from the page's own window, so any script on that page (a school-added LTI tool, an analytics snippet, a compromised dependency) can post fake records. | `extension/relay.js`, `background.js` | Mitigated | `background.js` drops a record whose URL is not on the page that sent it (`sameOrigin`), and keeps nothing at all unless the student has **saved their Canvas address** (risk 7). So another website cannot add records, and cannot pose as Canvas. A script on the saved Canvas host's own pages can still forge records for that host. |
| 7 | **The Canvas host could be chosen by a page.** The "is this Canvas?" check runs inside the page, where any website can fake it, so an automatic "first Canvas wins" pin would let a hostile site claim the extension and redirect links and Sync. | `background.js`, `src/context/PullContext.tsx`, `src/extension/extensionApi.ts` | Mitigated | Nothing chooses the host for the student any more: records are kept only from the address saved in the popup or in Settings → Connection, and changing it clears the old address's data. Found in code review and fixed. |
| 8 | **Sync now automates page loads using the student's session, now in background tabs.** The student confirms inside the app and sees a live preview, can stop at any time, pages are opened 4 at a time in background tabs (`CONCURRENCY` in `extension/lib/pullRunner.js`), there is no cap on pages per run or per hour (owner's decision, Oct 27, 2026: this raises the automated-access risk below), and nothing is scheduled. A run can only start from a real click on the app's page; a confirmed run may continue from the run that just ended, round after round (the dashboard, then the courses, then the pages they link to, until nothing new turns up), within 2 minutes of each other and never after Stop. But the pages are no longer in a window the student watches, and Instructure or a school could still treat it as automated access under its terms. A student's account, not Courseline, carries that risk. | `extension/bridge.js`, `background.js`, `src/context/PullContext.tsx` | Accepted | This is a deliberate change from the design doc (see below). Keep the guardrails; do not add scheduled, repeating or fully hidden sync. |
| 9 | **Canvas changes its pages or response shapes without notice**, so capture silently stops matching and the app shows old data as if it were current. | `extension/lib/capture.js`, `ExtensionStatus.tsx` | Mitigated | Unexpected shapes are counted, kept as value-free skeletons, and shown as a warning with what to do; every dataset shows a "last updated" time. Values that are well-formed but cannot be right (a date with no time zone, "8,5", statistics misread by a factor) are left out and listed under the sidebar's Extension item (amber "Needs attention"), with what to do (`valueChecks.ts`, `dev` only). Not caught: a value that is wrong but plausible. |
| 10 | **Grades shown in extension mode can be calculated by Courseline**, not Canvas's own totals, and can differ (hidden totals, rules not modelled, grading periods). | `src/extension/extensionApi.ts`, `lib/grades.ts` | Mitigated | Canvas's own total is used when its Grades page shows it for the whole course (no grading period chosen, or "All grading periods") and no score was captured after that page; otherwise the grade is an estimate, marked `estimated` and labelled on the Grades screen, and the status bar says how grades are worked out. Do not use an estimate for decisions that matter without checking Canvas. |
| 11 | **Pasting the "Copy response shapes" output elsewhere.** It has field names and types only, no values, but a field name can reveal what a school's Canvas contains. | `extension/lib/shape.js` | Accepted | Read it before pasting. |
| 12 | **The extension is loaded unpacked.** Whatever is in the `extension/` folder runs with the extension's permissions, and there is no signing or update channel. Anything that can write to that folder can change what it does. | repository / local disk | Accepted | Keep the folder in a place only you can write to. A signed build is a distribution question, not a coding one. |
| 13 | **Content-Security-Policy on the app is partial.** `'unsafe-inline'` scripts are allowed (the first-paint script and Vite's dev client need them) and `connect-src` allows any https host (the Canvas address is user-typed), so an injected inline script is not blocked and can still send data to an https site. | `index.html` via `vite.config.ts`, `src/lib/csp.ts` | Mitigated (partly) | The policy blocks plugins, base-URL changes, form posts elsewhere, `eval`, and scripts from anywhere but this site and the Monaco CDN. **Not yet checked in a browser for the PDF viewer and Monaco**: if either breaks, relax `src/lib/csp.ts`. A real fix needs a backend. |
| 14 | **Dependencies**: known advisories, accepted ones are listed in [10](#10-dependencies). | `package.json` | Mitigated | Do not run `npm audit fix --force` blindly. |
| 15 | **The extension now saves every read a Canvas page makes**, not only the routes Courseline has a screen for. That includes things other people wrote or that concern them: inbox messages and names, discussion posts, class lists, quiz details. It is all kept unencrypted on this computer (the extension has `unlimitedStorage`), and anything that can read it (risk 2, 4) gets all of it. | `extension/inject.js`, `background.js`, `lib/capture.js` | Mitigated | Credential responses (`/jwts`, tokens, login and OAuth) are never saved, and `token`-type fields and capability URLs are stripped along with email, login id and avatar. Of what Canvas's own pages request, only reads are kept (no writes, no GraphQL mutations). The extension also keeps what it fetches itself when Messages is opened (the inbox, the sent folder and up to 100 threads; risk 17) and Canvas's answer to a message the student sends, so the thread shows it at once. Data read from the page itself is limited to a fixed list of eight kinds (`PAGE_KINDS` in `classifyPage`) and goes through the same stripping; one of them, `currentUser`, is account-level and keeps the signed-in student's id and display name. The Grades page's `ENV.submissions` includes submission comments, with their authors' names, like the API's submissions do. Limits: one response over 3 MB is counted, not kept; at most 6,000 responses (oldest dropped first); nothing older than 90 days. The explorer in Settings → Connection shows it all, and **Clear captured data** deletes it. |
| 16 | **Opening a page in Canvas is a visit.** The pages a pull opens load exactly as if the student had opened them, so Canvas may record the view: marking module items "viewed" (which can satisfy a "must view" requirement), clearing unread flags on discussions and announcements, and logging page views that an instructor can see. Apart from a message the student sends, with its attachments (risk 17), the extension writes nothing itself (it sends no other POST, PUT or mutation, and none that a page makes is captured), but Canvas does these things on its own when a page loads. Sending a message or opening Messages loads the student's Canvas Settings page in a background tab, which Canvas may log as a page view; threads are read with `auto_mark_as_read=false`, so they stay unread. | `src/context/PullContext.tsx`, `src/components/PullPanel.tsx` | Accepted | The confirmation says so ("Canvas may record the visit"). Module-item and discussion pages are among the links followed by **Pull linked pages**, and by **Sync now** unless **Essentials only** is ticked. For a course where a recorded view would matter, tick Essentials only and leave Pull linked pages alone. |
| 17 | **The extension can send messages as the student, and reads messages itself** (owner's decisions, Oct 29, 2026: sending, and reading threads when Messages is opened, since Canvas loads a thread only when it is clicked). Anything that can talk to the bridge (risk 2) could try to send a message to a teacher in the student's name. | `extension/bridge.js`, `background.js`, `inject.js`, `lib/message.js` | Mitigated | Only after a real click or key press on the app page (`navigator.userActivation`), only from the localhost app (`APP_ONLY`), only a reply in a conversation or a new message to Canvas user ids with a plain-text body (`cleanSendRequest`; anything else is refused), only to the saved Canvas address, from a background Canvas tab whose page script posts to the two message endpoints only (plus, for attachments, Canvas's own file-upload slot in the student's "conversation attachments" folder; at most 10 files, 25 MB in all). The form token comes from the page (`input[name=authenticity_token]` on the Settings page, else the `csrf-token` meta tag); no cookie is read. Reading: GET requests to the messages API only (the 50 newest conversations of the inbox and of the sent folder, then up to 100 threads, each read with `auto_mark_as_read=false`), at most every two minutes and only after a click. A script running while the student clicks something could still send one message, or start one read. |

**Before the app or extension is shared with anyone:** resolve 1 and 2 at a minimum, and decide on 4, 13, 15, 16 and 17. For the API-token edition alone (`main`, no extension), that is 1 and 13. (3, 6 and 7 were reduced; re-check them against whatever the app is deployed on.)

---

## 10. Dependencies

| Package | Why | Notes |
|---|---|---|
| `react`, `react-dom`, `react-router-dom` (7) | UI + routing | Version 7 clears an open-redirect advisory in 6.x; the app uses only `BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `Navigate` and the `use*` hooks, which are unchanged. |
| `dompurify` | Sanitizing instructor HTML (`HtmlContent`) and the rich-text editor's output before it is submitted (`cleanEditorHtml` in `RichTextEditor.tsx`, an allowlist of tags) | Security-critical: keep updated. Spreadsheets and messages do not use it: they are drawn as text |
| `pdfjs-dist` | PDF rendering, and PDF text for the AI export (`lib/extractText.ts`) | Needs Node ≥ 22.13 for installs. Pinned ≥ 6.2.108 because 5.6.83–6.2.107 has a high-severity advisory (code execution from a malicious PDF). The code uses the **legacy** build and imports the worker with Vite's `?url`. |
| `docx-preview` | Word rendering | |
| `xlsx` (SheetJS) | Spreadsheet values and number formats, for the viewer and the AI export (the formatting is read by `lib/xlsxStyles.ts`, not SheetJS) | **Installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`**, not npm: the npm copy (0.18.5) has high-severity advisories and no fix. To update, change the URL. |
| `pptx-preview` | PowerPoint rendering | Pulls in `echarts`, which has a moderate XSS advisory in a chart type (`Lines` series with tooltips) that PowerPoint rendering does not use. |
| `jszip` | Opens and writes zips: `presentation.xml` for the slide aspect ratio, the master body styles (`lib/pptxFix.ts`), the spreadsheet formatting parts (`lib/xlsxStyles.ts`), Word and PowerPoint text for the AI export (`lib/extractText.ts`), and the AI export zip itself (`lib/courseExportRunner.ts`) | Also a dependency of `pptx-preview`. |
| `@monaco-editor/react` | Code viewer | Loads the editor assets from a CDN at runtime. |
| `vitest`, `jsdom` | Test runner and the simulated browser it runs in | Configured in `vite.config.ts` (`test:`) |
| `vite` (6.4), `@vitejs/plugin-react`, `typescript`, `tailwindcss` (4) with `@tailwindcss/vite`, `@types/node` | Build tooling (`@types/node` types `vite.config.ts` and the dev server's `lib/systemClockServer.ts`) | Vite is kept on 6.4.x: versions up to 6.4.2 have path-traversal advisories fixed in 6.4.3+, and Vitest 5 supports 6.4+. |

`npm audit` currently reports **no critical and no high findings**. Three moderate and two low remain, and none is fixable without breaking something or reachable from this app: `echarts` and `uuid` come in through `pptx-preview` (an XSS in a chart type, 'Lines' series with tooltips, that PowerPoint rendering never uses; and a buffer-bounds issue in uuid forms the library does not call, since it only calls `v4()` with no arguments), and `monaco-editor` carries its own internal copy of `dompurify` (the app's direct `dompurify` is patched). Dependabot will list the same items; they are known and accepted. Do not run `npm audit fix --force` blindly: it makes breaking major upgrades (for `pptx-preview` it would even downgrade).

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Could not reach Canvas… CORS" | School blocks browser requests | `VITE_USE_DEV_PROXY=true` in `.env`, restart `npm run dev` |
| File preview says "Your browser blocked the download (CORS)" | Proxy not enabled / dev server not restarted | Same as above; confirm `VITE_CANVAS_BASE_URL` is correct (the proxy reads it) |
| Signing in on `npm run dev` with another Canvas address (a test or mock Canvas) still reaches your school, or is refused as a bad token | With `VITE_USE_DEV_PROXY=true`, every token-mode request goes to `/canvas-proxy`, which forwards it to `VITE_CANVAS_BASE_URL` from `.env`, whatever address was typed | Start that server with `VITE_USE_DEV_PROXY=false npm run dev` (a variable set in the shell beats `.env`), or point `VITE_CANVAS_BASE_URL` at the other Canvas and restart |
| File preview: "Canvas denied access to this file" | File locked/hidden for you | Open it in Canvas; use the Download button if offered |
| File preview: "couldn't find this file" | Deleted file | — |
| PDF spinner, then "timed out while …" | PDF engine blocked or stalled | The message names the step. Retry; check console (`[file viewer]` lines). The viewer already retries on the main thread after 10 s |
| Upload says "The browser blocked the upload to Canvas's file storage" | The storage host (a different server from Canvas) refused a browser request (CORS) | Use **Submit in Canvas** in the Details card; this cannot be fixed from the app |
| Upload says "Canvas did not confirm the upload" | Your Canvas answered step 3 in a way the app does not handle | Check the Network tab for the request after the upload; see `uploadFile` in `api/client.ts` |
| `npm ci` or `npm install` fails on `xlsx` | No access to `cdn.sheetjs.com` | Check network/proxy; or switch to a vendored copy |
| "the download wasn't a PDF" | Canvas/proxy returned an error page | Check you are logged in / token valid; try reloading |
| A style has no effect, or a color is missing | The class name is built from pieces, or lives in a file Tailwind does not scan | Write the full class name; extend the `@source` lines in `src/index.css` |
| After `npm install` of a new package, imports fail or the page loops reloading | Vite's pre-bundled dependency cache is stale | Stop the server, run `npm run dev -- --force` |
| Everything is suddenly slow: `tsc` sits at 0 % CPU for minutes, the dev server takes 20 s to answer or never does, tests time out or fail with `ECANCELED: operation canceled, read`, the e2e run is flaky | The project folder is in **iCloud Drive** (Desktop & Documents) with **Optimize Mac Storage** on, and macOS has offloaded files to iCloud (check with `find . -flags +dataless \| wc -l`; `node_modules` alone is ~25,000 files). Every read then waits for a download | Best: move the project out of `~/Documents` and `~/Desktop` (for example to `~/Developer/`). Or, in Finder, right-click the folder → **Keep Downloaded**. To get going right now, force the download: `find . -flags +dataless -type f -print0 \| xargs -0 -P 64 -n 20 cat > /dev/null` |
| Two dev servers behave strangely | They share `node_modules/.vite` | Run one at a time, or give the second a different `cacheDir` |
| Port 5173 "in use" | Another server running | Vite moves to 5174+; use the printed URL |
| The login page shows only the token form, and there is no extension status in the sidebar or extension card in Settings, though the extension is installed | The API-token edition: the `main` branch (`edition.json` has `"apiOnly": true`) or a build or dev server started with `COURSELINE_EDITION=api` | Expected. Use the `dev` branch, without `COURSELINE_EDITION=api`, to use the extension |
| On `dev`, the extension is installed but the app does not see it | The app is on a port the bridge does not answer (only 5173–5180 and 4173), or the app's tab was open before the extension was loaded or reloaded | Use one of those ports; reload the extension in `chrome://extensions`, then reload the app's tab |
| Times show 12-hour although the Mac is set to 24-hour, or the calendar week starts on the wrong day | Only `npm run dev` on macOS reads those settings (`defaults read -g`, `lib/systemClockServer.ts`) into `<meta name="courseline-clock">`. A built copy (`npm run build`, `npm run preview`) or another OS falls back to the browser's region, and Chrome on a Mac ignores the 24-hour switch | Use `npm run dev` on the Mac; after changing System Settings, reload the page |
| Messages in extension mode look out of date, or show **Load latest messages** | The extension reads messages only after a click, and at most every two minutes | Click **Load latest messages**, or open Messages again after two minutes |
| Sending or loading messages in extension mode says "You are not signed in to Canvas in this browser" | The background Canvas tab landed on Canvas's login page | Sign in to Canvas in the same browser, then try again |
| `EBADENGINE` warning on install | Node < 22.13 | Upgrade Node (works with a warning on 20) |
| Login keeps returning to the login screen | Token invalid/expired, or school returns 401 | Generate a new token; check the base URL has no trailing path |
| A course is missing | Not selected in Settings, or restricted by date | Settings → Choose your courses |
| Grades tile shows "—" | Instructor hides totals or nothing graded | Expected |
| "Rebuilt here from your scores" note on Grades | Our maths differs from Canvas's (rules we do not model) | Trust Canvas's headline; investigate `lib/grades.ts` |
| Build fails with "'x' is declared but never used" | `noUnusedLocals` is on | Remove the unused import/variable |

---

## 12. Conventions

- **TypeScript is strict**; unused locals/parameters fail the build. Run `npm run build` before considering a change
  done.
- **Comments:** only for non-obvious *why* (a Canvas quirk, a workaround). Do not narrate what code does.
- **Data access:** pages → hooks → `useQuery` → the `api` from `useApi()`: `canvas.ts` → `client.ts` with a token, or
  `extension/extensionApi.ts` (the same `CanvasApi` type, built from captured data) in extension mode. A new endpoint
  needs both (TypeScript enforces it), or `needsToken` in `extensionApi.ts`. No `fetch` in components.
- **Untrusted content:** Canvas HTML via `HtmlContent`; file bytes read from the local blob; labels, message bodies and
  spreadsheet cells rendered by React as text (never as HTML).
- **Naming:** hooks `useThing`; Canvas endpoint functions `getThing`; cache keys `thing:<ids>`; storage keys
  `courseline.<name>`.
- **Styling:** `neutral-*` grays, `accent-*` brand, `dark:` twin on every colored class, status colors only for status.
- **Error handling:** API errors flow through `useQuery.error` → `<ErrorMessage>`. Handle expected failures
  (hidden tabs) in `canvas.ts`, not in components.
- **Accessibility:** interactive elements are real buttons/links with labels; charts have a table view; keyboard
  support on custom controls.
- **Commit** small, working steps (see [3](#before-you-change-anything)).
- **Branches and editions:** work on `dev` (the full app, with the extension), then merge `dev` into `main` (the
  API-token edition), taking `extension/` and `e2e/` back out in the merge (see [Branches and editions](#branches-and-editions)).
  `edition.json` is the only other difference (`"apiOnly": true` on `main`): never edit it on `dev`, so a merge keeps
  `main` API-only. Anything that looks for or talks to the extension goes behind `API_ONLY`
  from `src/edition.ts`. To see the API-only app on `dev`, run `COURSELINE_EDITION=api npm run dev` (or build with
  it). Tests always run the full app; to test the API-only path, mock `../edition` as `LoginPage.apiOnly.test.tsx` does.

### Keeping it stable while you add features

The app is in real use, so treat every change as something a student will hit tomorrow.

1. **One feature or fix per branch**, merged only when CI is green (`npm run typecheck`, `npm test`, `npm run build`).
   CI runs on pushes to `main` and on pull requests, not on pushes to `dev`, so run the three commands yourself before
   merging `dev` into `main`.
2. **Add a test with every fix.** If it was a bug, write the test that would have caught it first. Canvas data shapes go in
   `api/canvas.test.ts` using realistic JSON; pure logic goes next to the code in `lib/`.
3. **Check UI changes in a browser**, on a real course, in light and dark mode and at phone width. Tests do not look at
   pixels.
4. **A five-minute smoke test before publishing a change**: log in; open a course; open the Pages tab; open one PDF, one
   Word, one Excel and one PowerPoint file; open the grades page and type a what-if score; open an assignment; open Messages and one conversation. For `main` (or with
   `COURSELINE_EDITION=api`), also check that the login page shows only the token form and the sidebar has no extension
   status.
5. **Touching a Canvas response?** Update `api/types.ts`, then the endpoint in `api/canvas.ts`, then add a test. Handle
   hidden or missing data (many courses hide tabs and grades) instead of assuming it exists.
6. **Update dependencies deliberately**, one at a time (`npm outdated`), re-running the three commands. The PDF, Excel
   and PowerPoint libraries change APIs between major versions.
7. **Tokens and secrets**: never commit `.env`; tokens expire, so a login that suddenly fails usually just needs a new one.

---

## 13. Known gaps and ideas

### Things to be aware of

1. **Other schools' Canvas installs can differ.** The app is developed and used against one school's Canvas. Submissions
   follow Canvas's documented upload flow, but a different school may differ. Likely failure modes, in order: (a) the
   file-storage host refuses a browser upload (CORS), where the app says so and points to "Submit in Canvas"; (b) the
   confirmation step answers in a shape `uploadFile` does not recognise, where the app says "Canvas did not confirm the
   upload". Try a throwaway assignment on a new school.
2. **The file viewer has few saved automated tests (`SheetTable.test.tsx` and `lib/xlsxStyles.test.ts` for spreadsheets, `lib/pptxFix.test.ts` for PowerPoint), and nothing checks how screens look.** `App.test.tsx` renders every
   screen but Messages in a simulated browser, but not pixels. Both were verified in a real browser during development with
   throwaway scripts (a fake Canvas, Chrome driven over the DevTools protocol, and before/after screenshot comparison
   for the Tailwind 4 migration). `e2e/` is that for the extension and the
   screens it feeds (a real Chrome, a mock Canvas); the file viewer and pixel comparisons are still not covered.
3. **The grade engine** matches Canvas on the cases tested (weights, drops, excused, extra credit) but has not been
   compared with a wide range of real gradebooks. Canvas's own totals remain the headline for that reason.

4. **Values the extension does not check yet** (`dev` only; see `valueChecks.ts` for what it does check):
   - *Assignments that disappeared, and values that became empty:* an assignment no longer on the Grades page, or a
     field Canvas cleared, keeps its older captured value. Dropping it would be wrong too often with grading periods
     (each period's page lists only its own assignments).
   - *Hidden totals:* no ENV or page signal that the instructor hid the total has been verified, so a hidden total is not
     detected; the grade shown is then an estimate, and labelled as one.
   - *Grading-period weights:* a course that weights its grading periods is worked out without those weights.
   - *ENV `due_at` vs `effective_due_dates`:* whether the Grades page's `due_at` already includes the student's own
     override is not verified; `extension/TESTING.md` has a manual check.
   - *Class median rounding:* the Grades page shows statistics with two decimals, so a median can differ slightly from
     the token version's. Inherent.
   - *Course names:* the card's `originalName` is used; whether the API returns the nickname instead is unclear.
   - *Numbers like "1,300" in class statistics* are read as thousands (the page writes them that way); a misread
     factor is caught by the scale check only when the assignment's points are known.
   - *Posted dates:* an undated assignment with no planner item has no `created_at` in extension mode; announcement
     dates from GraphQL use `postedAt`, else `createdAt` (which one Canvas fills is not verified).

### Limitations by design

- No quizzes. Announcements and discussions are read-only, per course (the topics and their first post, no replies;
  "Open in Canvas" goes to them). The calendar shows assignment due dates only, not Canvas calendar events.
- Messages: no archiving, starring, deleting or searching conversations. In extension mode the extension reads the 50
  newest conversations of the inbox and of the sent folder (up to 100 threads). Opening a conversation does not mark it
  read in Canvas (`markConversationRead` does nothing there), recipients come only from captured class lists, and
  attachments open Canvas's Inbox instead of the in-app viewer (their file links are removed before saving).
- The API-token edition (`main`) has no extension: no sign-in without a token, no Sync now, no captured data.
- Cache is in memory only: a page reload refetches everything.
- Accent presets are only checked for white-text contrast, not colorblind separation (the UI uses one accent, so this
  is moot, but status badges are color + text).
- `AssignmentsPage` ("All assignments") and `CalendarPage` fan out one request per visible course; with many courses the Planner API would be cheaper (one call, server-side aggregation).
- `Settings → Choose your courses`: courses added later stay hidden once any selection is saved.
- Spreadsheet previews cap at 2,000 rows and 200 columns per sheet. Formatting is read from .xlsx/.xlsm only (.xls,
  .ods and .csv show their values without it), and conditional formatting, charts, pictures and cell comments are not
  drawn. Very large decks/documents render fully in the browser (memory).
- The computer's 12/24-hour clock and first weekday are read only by `npm run dev` on macOS; anywhere else, times and
  calendar weeks follow the browser's region.
- Three languages: English, Spanish and Brazilian Portuguese (`src/i18n/`), chosen in Settings or taken from the
  browser. A string missing from `es.ts` or `pt.ts` shows in English, and Canvas content stays in the language it was
  written in.
- Monaco and PDF.js worker assets: Monaco comes from a CDN, so the code viewer needs internet.

### Pending

Work that is decided but not done.

1. **Try the extension against a real school's Canvas, and write down what differs from the mock.** *Partly done:*
   tried on one school (Oct 30, 2026); what differed is in the gotchas table ("Exceptions seen on one school") and was
   added to the mock (restricted course 4). Still to do: a second school, and the points below. The end-to-end
   test covers the extension, the app and the whole sync loop in a real Chrome, but the Canvas it talks to is
   `e2e/mock-canvas.mjs`. Things only the real Canvas can show: pages that load part of their data only when the tab
   is visible (background tabs may load less), GraphQL operations that carry data the mock does not, and which pages
   need to be opened to fill which screen. Use `extension/TESTING.md`, then `Settings → Connection → Everything
   captured` to see what each page really returned.
2. **Check the Content-Security-Policy against the PDF viewer and the code viewer** (Monaco). The login page, dashboard,
   settings and every screen the e2e opens run under it with no violations, but files cannot be opened in extension
   mode, so the viewers were not exercised. `src/lib/csp.ts` says what to loosen if either breaks.
3. **Decide the sanctioned-access question** below, in parallel, with a person at the school.
4. **Before sharing with anyone:** risks 1 and 2 in the [risk register](#risk-register) (token in the browser, and any
   script on the app's page can use the bridge), and the unencrypted store (4).
5. **Send a message, with an attachment, and open Messages through the extension on a real Canvas.** Both have unit
   tests only (`extension/background.test.js`, `inject.test.js`, `lib/message.test.js`). `e2e/mock-canvas.mjs` has
   no Settings page (where the form token comes from) and takes no messages, and `npm run e2e` never opens Messages.
   Check that the Settings page carries `authenticity_token`, that attachments land in "conversation attachments",
   and that the sent message shows in the thread at once.

#### Sanctioned access options (to research, not decided)

The extension works from the student's side without anyone's approval. If a school wants more, the routes Instructure
and the school would have to agree to are below. Confirm each with the school's Canvas administrator or Instructure
before relying on it; this list is from general knowledge of Canvas, not from a conversation with either.

| Route | What it needs | What it would give |
|---|---|---|
| A developer key with OAuth2 | The school's Canvas administrator creates the key and approves the app | Per-student sign-in, no personal tokens, revocable; the app still needs a backend for the client secret |
| An LTI 1.3 tool installed in the school's Canvas | The school installs it | Launches from inside Canvas with course context; limited data unless extra services are enabled |
| A school-issued or institution-approved token | The school's policy | Same as personal tokens, with the school's knowledge |
| Instructure's partner or data programs | An agreement with Instructure | Depends on the program |

### Reasonable next steps

- Run a submission against a real Canvas and fix whatever differs (see above).
- Add Playwright tests with a saved fake-Canvas fixture for the screens and the file viewer.
- Move the token behind a tiny backend (or OAuth2) so the app can be shared.
- Planner API to replace the per-course fan-out in "All assignments" and the calendar; discussion replies, quizzes, and calendar events in the calendar.
- Persist the query cache (so reloads are instant) or adopt TanStack Query.
