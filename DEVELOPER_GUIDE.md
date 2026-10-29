# Courseline — Developer Guide

The complete map of this project: what it does, how it is built, why it is built that way, and exactly where to
change things. Read this top to bottom once, then use the table of contents and the **Cookbook** (section 7) as a
reference.

**Audience:** any developer (or AI assistant) opening this codebase for the first time. No prior knowledge of Canvas
or of this project is assumed. Basic React + TypeScript is.

> Companion file: `README.md` has the short version (setup, token, Canvas API notes). Where the two disagree, this
> guide is newer.

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
talks directly to your school's Canvas REST API (`https://<school>/api/v1/...`) using a personal access token. There is
**no backend of our own**: everything runs in the browser, and the only server is the Vite dev server during
development.

What it gives you over Canvas itself:

- A course page that shows **Pages and Modules as one list** (collapsible, reorderable), so it looks the same whether
  the teacher built the course from Pages or from Modules.
- An **in-app file viewer** for PDF, Word, Excel, PowerPoint, images and code, with page numbers, typed zoom and an
  explicit Download button. Nothing downloads unless you press that button.
- An **in-depth grades page** per course: grade over time, assignment groups, what-if scores, goal calculator.
- Dark mode and a **user-chosen accent color**.

Stack: React 18, TypeScript (strict), Vite 6, Tailwind CSS 4, React Router 7. Tests: Vitest 5. No state library, no UI kit.

---

## 2. Status: what works and what does not

| Area | State |
|---|---|
| Login with Canvas token, logout | Works |
| Dashboard, Courses, per-course tabs (Pages, Assignments, Files by unit, Grades) | Works |
| Pages tab (pages + modules merged, collapse, reorder, saved per course) | Works |
| File viewer: PDF, DOCX, XLSX/XLS/CSV/ODS, PPTX, images, code | Works (tested in headless Chrome against a mock Canvas) |
| Old `.doc` / `.ppt` | Not previewable (no browser renderer exists): shows a message + Download button |
| Grades page, what-if, goal calculator, trend chart | Works (tested against a mock Canvas; maths unit-tested) |
| Settings: theme, accent color, course selection | Works |
| Assignment detail page, rubric, comments, **Reply box** | Works; in use by the author on real coursework; unit-tested |
| **Submitting text** | Works; in use by the author on real coursework; unit-tested |
| **Submitting files (upload)** | Implements Canvas's documented three-step flow; in use by the author on real coursework; tested in a real browser against a fake Canvas (three confirmation styles, CORS, retry). **File-storage hosts differ between schools**, so another school's Canvas may refuse browser uploads (the app says so and points to "Submit in Canvas") |
| Browser extension (capture, background-tab sync, preview, link following) | Works, tested in a **real Chrome against a mock Canvas** (`npm run e2e`, 38 checks, also run by hand against nothing but the mock). **Not yet tried against a real school's Canvas**: real pages load data in ways the mock only approximates (see Pending) |
| Announcements and discussions per course | Works in both modes (token: Canvas API; extension: from captured pages) |
| Automated tests | **~410 unit tests** (Vitest): API client, endpoints, grades, HTML sanitizing, cache, accent colors, the submission form, the extension's logic, the app's extension mode, and a smoke test that renders every screen against a fake Canvas. **`npm run e2e`** drives a real Chrome with the unpacked extension through sign-in, sync, preview, stop, refresh, pull-a-page, linked pages and switching address. CI runs the unit tests on every push (the e2e needs a local Chrome, so it is run by hand) |
| Deployment | **Not supported** as-is (token lives in the browser; dev proxy is dev-only) |

The author uses the app day to day against a real school's Canvas. The automated tests (`src/**/*.test.ts(x)`) use a fake
one. The screens and the file viewer were also checked in a real browser against a fake Canvas during development; those
browser scripts are **not part of this repository** (`App.test.tsx` covers the screens in a simulated browser, not pixels). Canvas installations differ a little from school to school, so on a
new school try a submission on a throwaway assignment first.

---

## 3. Run it

### Requirements

- **Node 22.13 or newer** (22 LTS recommended). `pdfjs-dist` declares `>=22.13 || >=24` and Vitest 5 needs
  `>=22.12`. Node 20 can still install, build and run the app (with an `EBADENGINE` warning) but **cannot run the tests**.
- A Canvas account and a personal access token.
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
```

If port 5173 is taken, Vite silently picks the next one (5174, ...). **Use the address printed in the terminal.**

### Environment variables (`.env`)

| Variable | Meaning |
|---|---|
| `VITE_CANVAS_BASE_URL` | Your school's Canvas address, e.g. `https://myschool.instructure.com`. Pre-fills the login form. **Also the dev proxy's target** — if you use the proxy, this must be correct. |
| `VITE_CANVAS_API_TOKEN` | Optional. If set (with the URL), skips the login screen. **Leave empty unless you understand the security note in [9](#9-security-model).** |
| `VITE_USE_DEV_PROXY` | `true` routes all Canvas calls through the Vite dev server (see [6.2](#62-the-api-client)). Needed when the school's Canvas blocks browser (CORS) requests, and **required for file previews at schools that do**. Restart `npm run dev` after changing. |

`.env` is git-ignored. `VITE_*` variables are **inlined into the built JavaScript** — never build for distribution
with a real token in `.env`.

### Getting a token

Canvas → Account → Settings → Approved Integrations → **+ New Access Token**. Set an expiry. Copy it immediately.
Some schools disable personal tokens; then you would need OAuth2 (not implemented).

### Before you change anything

Run `npm run typecheck && npm test && npm run build` once so you know the starting point is green, and commit often.
All three also run in CI (`.github/workflows/ci.yml`) on every push and pull request.

### Publishing to GitHub

The project is ready to be a repository: `.gitignore` already excludes `node_modules`, `dist`, `.env` (secrets),
`.claude/` (local Claude Code settings) and editor/OS files.

The repository is already initialized on branch `main` with no commits yet, so start at `git add -A`:

```bash
git add -A
git status                              # read the list: no .env, no node_modules, no .claude
git commit -m "Initial commit"
# create an EMPTY repository on github.com (start Private), then:
git remote add origin git@github.com:<you>/courseline.git
git push -u origin main
```

Checklist before making it public:

- `git ls-files | grep -E '^\.env$|\.claude|node_modules'` prints nothing.
- You have **no real token** in `.env.example` (it holds placeholders only).
- The `LICENSE` is PolyForm Noncommercial 1.0.0 (free for personal/noncommercial use; commercial use reserved to the
  copyright holder). Check the `Required Notice:` line at the top has the name you want shown publicly.
- Check the CI run goes green on GitHub (it installs with `npm ci`, which needs internet access to `cdn.sheetjs.com`).
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

Rules that keep this working:

- **Nothing outside `src/api/` calls Canvas with `fetch`.** Pages call hooks. (The file viewer's `fetch(fileUrl)` calls read *local* `blob:` copies, not Canvas.)
- **API failures are returned, not thrown**: `useQuery` gives you `error`; render it with `<ErrorMessage>`. The
  `ErrorBoundary` only catches render crashes.
- **Cache keys must include every input** to the fetcher (`assignments:${courseId}`), otherwise two different requests
  share one cache slot.

### The provider stack (outermost first)

`main.tsx` → `ErrorBoundary` → `ThemeProvider` → `AuthProvider` → `BrowserRouter` → `App`.
Inside `App`, once logged in: `DataProvider` → `CourseFilterProvider` → `FileViewerProvider` → `Routes`.

`DataProvider` sits **inside** the auth gate on purpose: logging out unmounts it, which discards every cached response.
`FileViewerProvider` renders the single shared file-viewer modal for the whole app.

### Rendering instructor HTML

Canvas pages, assignment descriptions and submission bodies are HTML written by other people. They always go through
`components/HtmlContent.tsx` (DOMPurify). Never use `dangerouslySetInnerHTML` on Canvas content directly.

### Opening files

Every Canvas file link, anywhere, calls `useFileViewer().openFile(url, name)`. The viewer looks the file up through
the API, downloads it into memory, and renders that local copy. See [6.9](#69-the-file-viewer).

---

## 5. File-by-file map

Everything lives in `src/` (about 5,200 lines of app code plus tests). Config files sit in the project root.

### Root

| File | Purpose |
|---|---|
| `index.html` | HTML shell. Contains an **inline script** that applies the saved dark mode and accent color *before first paint* (prevents a flash), after moving settings saved under the app's old name (`better-canvas.*` keys) to `courseline.*`. Keep it in sync with `ThemeContext.tsx`. |
| `edition.json`, `src/edition.ts` | The edition switch. `"apiOnly": true` (the `main` branch), or `COURSELINE_EDITION=api` at build time, makes the API-token edition: `vite.config.ts` defines `__API_ONLY__`, drops `<meta name="courseline-app">` (so `extension/bridge.js` ignores the page), and `API_ONLY` turns off `extensionInstalled()`, the extension sign-in, the sidebar status, the pinned-course sync, the extension's "open the plan" request and the Settings extension cards. Tests always run the full app (`mode === 'test'`); `LoginPage.apiOnly.test.tsx` mocks the switch. Keep `edition.json` out of `dev` → `main` merges' conflicts by never editing it on `dev`. |
| `vite.config.ts` | Vite + React + Tailwind plugins. Defines the **dev proxy** (`/canvas-proxy` → `VITE_CANVAS_BASE_URL`, with `followRedirects`), the CSP meta tag, and the `courseline-clock` meta tag (the Mac's time settings, from `lib/systemClockServer.ts`). |
| *(no `tailwind.config.js`)* | Tailwind 4 is configured in CSS, in `src/index.css` (`@theme`, `@custom-variant`, `@source`), and runs as a Vite plugin. There is no PostCSS config either. |
| `tsconfig.json` | Strict TypeScript, **`noUnusedLocals` and `noUnusedParameters` on** (an unused import fails the build). |
| `.env`, `.env.example` | Environment (see [3](#3-run-it)). |
| `package.json` | Scripts and dependencies. |
| `README.md` | Short setup + Canvas API notes. |
| `.github/workflows/ci.yml` | CI: `npm ci`, typecheck, tests, build on Node 22 for every push/PR. |
| `.gitignore` | Keeps `.env`, `node_modules`, `dist`, `.claude/` and OS/editor files out of Git. |
| `.claude/` | Claude Code settings for this folder (git-ignored; not part of the app). |
| `docs/screenshots/` | The README's images. They were taken from a fake Canvas with made-up course data. |
| `LICENSE` | PolyForm Noncommercial 1.0.0. |

### `src/api/` — talking to Canvas (no React in here)

| File | Purpose |
|---|---|
| `client.ts` | Low-level HTTP: `get`, `getAll` (pagination), `send` (POST/PUT), `getBlob` (file bytes), `uploadFile` (Canvas's three-step upload), error classification (`CanvasApiError`), `normalizeBaseUrl`, `downloadTarget`. |
| `canvas.ts` | One function per endpoint, collected in `createCanvasApi()`. **Add new endpoints here.** Contains the long comments on Canvas quirks. |
| `types.ts` | TypeScript types for the Canvas responses we use (only the fields we read). |

### `src/context/` — app-wide state

| File | Purpose |
|---|---|
| `AuthContext.tsx` | Credentials (localStorage), current user, login/logout, builds the `api` object. `useAuth()`, `useApi()`. |
| `DataContext.tsx` | The keyed response cache behind `useQuery`. |
| `ThemeContext.tsx` | Dark/light mode **and** custom accent color. `useTheme()`. |
| `CourseStyleContext.tsx` | The user's own color and icon per course (Settings → Course colors and icons, which lists only the courses selected under Choose your courses), saved in localStorage. `useCourseStyles()`; read through `useCourseColors()` / `useCourseIcons()`. |
| `LanguageContext.tsx` | The app language (English / Spanish): saved choice, else the browser's. `useLanguage()`. Changing it remounts the tree so every `t()` call re-renders. |
| `i18n/index.ts`, `i18n/es.ts`, `i18n/pt.ts` | `t('English text', { vars })` and the Spanish and Brazilian Portuguese dictionaries; `getLocale()` gives the date/number locale (`pt-BR` for Portuguese). English text is the key; a missing key falls back to English. |
| `CourseFilterContext.tsx` | Which courses to show (Settings). `useCourseFilter()`. |
| `FileViewerContext.tsx` | The shared viewer modal. `useFileViewer().openFile(...)`. |

### `src/hooks/`

| File | Purpose |
|---|---|
| `useQuery.ts` | Generic fetch-and-cache hook. |
| `useCanvasData.ts` | One-line hooks per resource: `useCourses`, `useVisibleCourses`, `useCourse`, `useAssignments`, `useAllAssignments`, `useAssignment`, `useMySubmission`, `useModules`, `useModuleItems`, `usePage`, `usePages`, `useCourseFiles`, `useAssignmentGroups`, `useUpcoming`. |

### `src/lib/` — pure logic (no React)

| File | Purpose |
|---|---|
| `grades.ts` | The grade maths (group weights, drop rules, what-if, trend, goal solver). Fully unit-testable. |
| `accent.ts` | Accent presets and the function that turns one hex color into a full 11-step palette. |
| `pptxFix.ts` | `applyMasterBodyStyles()`: before a PowerPoint file is previewed, copies the master's body text style (bullets, sizes) into empty body placeholders and top-anchors them, because pptx-preview never reads `<p:bodyStyle>` (it only does titles). Returns the original bytes if there is nothing to do or the file can't be read. |
| `htmlToMarkdown.ts` | Canvas HTML → Markdown (headings, lists, tables, links, equations as LaTeX, image descriptions). |
| `extractText.ts` | Text out of downloaded files: plain/code/HTML, PDF (pdf.js), Word and PowerPoint (zip + XML, including speaker notes), spreadsheets. Returns null when there is none. |
| `courseExport.ts` | Pure: turns the gathered course data into the export's documents (README, ALL_TEXT, syllabus, units, pages, assignments, file text, manifest) and rewrites Canvas links to the local copies. |
| `courseExportRunner.ts` | `scanCourse()` reads the course from Canvas; `packExport()`/`buildExportZip()` download files, extract text and zip. Cancellable, 3 downloads at a time. |
| `format.ts` | Dates, grades, byte sizes, `courseIdFromContext`. |
| `systemClock.ts`, `systemClockServer.ts` | The computer's 12/24-hour clock and first weekday. Browsers don't expose them (Chrome on a Mac ignores the 24-hour switch), so the dev server reads them with `defaults read -g` (macOS only) into `<meta name="courseline-clock">` on every page load; elsewhere, or in a production build, the browser's region decides. `withClock(options)` adds the `hourCycle` to any format that shows the hour; `weekStartDay()` sets the calendar's first column. |
| `courseIcons.ts` | The icon keys/names a course can use (drawings are in `components/icons.tsx`). |
| `courseColor.ts` | Unique per-course colors: handed out by a course's position among all the user's courses (12 curated, then generated), so no two courses share one. Read through the `useCourseColors()` hook; used by course cards, the sidebar, the calendar and multi-course assignment lists. |
| `html.ts` | Reading Canvas HTML without rendering it: `linkedFiles` (file links in a description or page), `fileLinkName`, `htmlText`. |

### `src/pages/` — one file per screen (routes in `App.tsx`)

| File | Screen |
|---|---|
| `MessagesPage.tsx` | Messages (`/messages`, `/messages/:id`, `/messages/new`; Canvas's `/conversations?context_id=…&user_id=…` compose link redirects here). One conversation list, received and sent together like a texting app (`mergeFolders`: Canvas's inbox and sent folder, each conversation once, newest activity first), the thread as bubbles (yours on the right, day separators, runs by one person), a reply box that sends on Enter (Shift+Enter for a new line) with a paperclip for attachments (up to 10 files, 25 MB in all), and New message (course → its teachers and classmates, with a search for classmates → subject → message). A conversation is named by its subject, like a group chat (`chatName`), with who it is with underneath. Shown full-bleed (`Layout` drops the page padding for it). Layout helpers in `lib/messages.ts`. |
| `DashboardPage.tsx` | `/` — welcome, upcoming assignments, first four courses, grades card. |
| `CoursesPage.tsx` | `/courses` — all visible courses as cards. |
| `AssignmentsPage.tsx` | `/assignments` — pending/done tabs across all visible courses. |
| `CourseExportPage.tsx` | `/courses/:id/export` — the **AI export** tab: scan the course, choose options (file text, original files, size limit), build and download a zip. All in the browser; nothing is uploaded. |
| `CalendarPage.tsx` | `/calendar` — month grid of assignments due across the visible courses (via `useAllAssignments`); click a day to list it. Weeks start Monday in Spanish. Pure date maths in `lib/calendar.ts`; item colors come from `lib/assignmentState.ts` (red = missing, pastel blue = to do, pastel green = submitted/graded/excused; submitted work past its due date is faded). Lists are ordered by `sortAssignments()` (upcoming soonest first, then past most recent first; an undated assignment is placed by its post date, one handed in with no due date by when it was handed in and shown grayed out, fully undated ones last). The same scheme colors the status badges in every assignment list and the per-course grades table. |
| `SettingsPage.tsx` | `/settings` — tabs (open one kept in `?tab=`): **Connection** (how data arrives; the extension checklist; Canvas address; Sync now; switch to or from an access token; log out; the default tab when the extension is installed), **Appearance** (Language, Theme, Accent color) and **Courses** (course colors and icons, then course selection). Add a section to a tab, or a tab to `TABS`. |
| `LoginPage.tsx` | Shown whenever there are no valid credentials. With the extension installed it leads with **Your Canvas address → Connect** (saves the address, switches to the extension, loads the essentials in background tabs with a preview in the page when nothing is captured, and signs in by itself when data arrives); the token form is one click below. Without the extension it leads with the token form. Both use `components/CanvasConnection.tsx` and `components/TokenForm.tsx`. |
| `CoursePagesPage.tsx` | `/courses/:id` (default tab, "Pages") — pages and modules merged. |
| `CourseDetailPage.tsx` | `/courses/:id/assignments` — the "Assignments" tab. |
| `CourseFilesPage.tsx` | `/courses/:id/files` — "Files by unit"; also exports `UnitItems`, reused by the Pages tab. |
| `CourseGradesPage.tsx` | `/courses/:id/grades` — the in-depth grades page. |
| `AssignmentDetailPage.tsx` | `/courses/:id/assignments/:aid` — instructions, files, details, submission form, your submission, feedback + reply, rubric. |
| `SubmissionViewPage.tsx` | `/courses/:id/assignments/:aid/submission` — full view of your submission. |

### `src/components/`

| File | Purpose |
|---|---|
| `Layout.tsx` | App shell (header, sidebar, routed page). **The only place page padding lives.** |
| `icons.tsx` | Shared inline-SVG icons: `navIcons` for the sidebar, the course icon set, `<CourseIcon courseId>` (the chosen icon in the chosen color). Add a course icon: key in `lib/courseIcons.ts`, drawing here. |
| `Header.tsx`, `Sidebar.tsx` | Top bar (menu, user, log out); left navigation. Sidebar icons are inline SVGs in `navIcons` in `components/icons.tsx` (no icon library); add one there for a new item. The dark/light toggle lives only on the Settings page. |
| `CourseLayout.tsx`, `CourseTabs.tsx` | Per-course title/grade header and the tab strip. **Add course tabs in `CourseTabs.tsx`.** |
| `CourseCard.tsx`, `GradeSummary.tsx`, `AssignmentList.tsx` | Reusable list/card pieces. `AssignmentList` also exports `assignmentStatus()`. |
| `HtmlContent.tsx` | Sanitized rendering of Canvas HTML; intercepts file links. |
| `FileViewer.tsx` | The viewer: all file-type renderers, zoom, page tracking (the biggest file, ~900 lines). |
| `FileViewerModal.tsx` | The overlay around the viewer (Esc, click-outside, body scroll lock). Loads `FileViewer` the first time a file is opened. |
| `GradeTrendChart.tsx` | The SVG line chart on the grades page. |
| `SubmissionForm.tsx` | Text / file submission UI. Uploads every file, then submits all their ids together. The text tab uses `RichTextEditor`. |
| `RichTextEditor.tsx` | Dependency-free rich text box (contentEditable + `execCommand`): bold/italic/underline, lists, quote, link. Pastes as plain text. Exports `cleanEditorHtml()` (DOMPurify allow-list; always run output through it) and `isEditorEmpty()`. |
| `ErrorBoundary.tsx` | Catches render crashes. |
| `ui.tsx` | `Spinner`, `ErrorMessage`, `Card`, `EmptyState`, `PageTitle`. |

### `extension/` — the browser extension (plain JS, no build step; load unpacked in Chrome)

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest. Capture scripts run on every https page and decide for themselves whether it is Canvas; `bridge.js` runs only on localhost. The description ends with the time it was last changed, to tell which copy Chrome loaded. |
| `inject.js` (page world) / `relay.js` | Passive capture: wraps `fetch`/XHR, keeps every Canvas `/api/` read (REST and GraphQL, through `fetch(url)`, `fetch(Request)` or XHR in text or JSON mode; never a write, and never a GraphQL mutation: recognised by its query text, or for a persisted query with no text, by a name that reads like a change) the page itself asked for, buffers them until the page is recognised as Canvas (body class `ic-app` or an `ENV` object), then forwards. Reads no cookies, starts no requests. **It also reads what Canvas builds into the page itself** (`readPage`), because some data never crosses `/api/`: the student Grades page fetches no assignments or scores (they are in `window.ENV.assignment_groups` / `ENV.submissions`, the assignment and group names only in the `#grades_summary` table), the course home's front page is `ENV.WIKI_PAGE`, the syllabus is `ENV.SYLLABUS_BODY`, the Modules page draws its modules into the HTML (`#context_modules`; each item's `<CanvasModel>_<contentId>` class gives its type and content id), which tabs the course menu shows is only in `#section-tabs`, and who is signed in is `ENV.current_user`. These are sent with a `page` field, one of six kinds (`PAGE_KINDS` in `lib/capture.js`): `gradesPage`, `wikiPage`, `syllabus`, `modulesPage` and `courseNav` at `https://<host>/courses/<id>#page:<kind>`, and `currentUser` (only the id and display name) at `https://<host>/#page:currentUser`. The Grades page is read only when it is the signed-in student's own (`/courses/<id>/grades`, or `/grades/<their id>`; never an observer's view), with the grading period it showed; the class statistics under each assignment (`table#score_details_<id>`) are read by position, each number by its own shape (a Spanish page still writes `6.88`, so the page's language is not used), and the app keeps them only when they are in order (`sensibleStatistics`). Still passive: what is already on the page, once it is known to be Canvas. |
| `background.js` | Classifies each response (`lib/capture.js`), stores it as `cap:<key>` in `chrome.storage.local` (a route Courseline reads keeps its `kind`; every other one is saved in full as kind `other` with its `route`; a known route that came back in an unexpected format is kept raw too, as `cap:rejected:<key>` with `rejectedAs`, so it never replaces a good copy and is never lost; a response over 3 MB is counted in `skippedLarge`, which the popup shows), counts unexpected shapes in `health`, and notes the address shapes in `unmapped`/`shapes`. Credential endpoints are never saved. Page data (a `page` field from `relay.js`) goes through `classifyPage` instead of `classify`: a fixed list of kinds with their own shape checks, one record per course and kind (a wiki page is filed as `frontPage` or `page`, the API's own kinds; the Grades page once per grading period it showed). `/api/v1/folders/:id/all` (the Files page, folder by folder) is the `folderContents` kind; it has no course in its address, so each file's `context_asset_string` says whose it is. Commands meant for the app (`setCanvasHost`, `openPage`, `cancelPull`, `setPinned`) are accepted only from a localhost tab. The hourly prune check keeps its clock in memory, so a capture does not read storage just to learn it is not time. |
| `lib/capture.js`, `lib/readers.js`, `lib/summary.js`, `lib/shape.js`, `lib/pullRunner.js`, `lib/peek.js` | Pure logic with tests: routes and shape checks, readers (course lists), popup summary, value-free response skeletons, the page-by-page runner with its hourly cap, and the short name samples shown in the preview. |
| `popup.html/js` | Per-course freshness, "N of M courses synced", health, unread addresses, Sync now, copy shapes, clear. |
| *(linked pages)* | **Pull linked pages** follows internal links. `src/extension/linkDiscovery.ts` scans everything captured (including HTML inside bodies and every `html_url`) for links to assignments, pages, discussions, announcements, quizzes, files, module items and the syllabus on the student's own Canvas and chosen courses. `pendingLinks` skips pages opened in the last day (the extension keeps `visited`), and `PullContext.requestDeepSync` opens them all in one run (no batch or hourly cap, by the owner's decision of Oct 27, 2026; Stop still works between pages). It also opens every subfolder a captured folder listing names (`/courses/<id>/files/folder/<path>`), because the Files page only loads the folder it shows. `extensionApi.ts` finds an opened assignment again by id in Canvas's newer GraphQL form (`assignmentFromObjects`) so instructions and rubrics fill in without a reader per query. |
| *(one pass)* | One click on **Sync now** (with "everything") opens the planned pages, then every page linked from what came back, then the pages linked from those, round after round until a round finds nothing new (`PullBuild.more`, asked after every run; `attempted` keeps any address from being opened twice in a pass, so it always ends). **Pull linked pages** chains the same way. Each round is a continuation of the run that just ended (`continueFrom`): `bridge.js` accepts it only from that run, within 2 minutes, and never after Stop (Stop clears the chain even between rounds, and the app sends `endChain` when the pass is over). "Essentials only" does not follow links. Opened pages are remembered in `visited` for a day (the same day `pendingLinks` waits), pruned by age, not by count, so a long pass never forgets its own pages. Class statistics read from the page must also fit the assignment's points (`sensibleStatistics(stats, points)`). |
| *(what Sync now opens)* | Per course: the home page (front page and course menu), Assignments, Grades, Modules, Pages and Files (Files by unit needs both the units and the file list); with "everything" also Announcements, Discussions, Quizzes, Syllabus and People, plus the account pages once (`src/extension/pullPlan.ts`). **Tabs the school hides are skipped**: Canvas only redirects them to the course home. Which ones are hidden comes from the captured course menu (`hiddenSections`), so the first run of a course still tries them all. |
| *(no sync window)* | Sync now has no extension window. The plan, **Start**, the live preview and **Stop** are in the app (`context/PullContext.tsx`, `components/PullPanel.tsx`). `bridge.js` runs the page-by-page loop in the app's own tab, and `background.js` opens each page in a **background tab** of the same window (`openPage`), 4 at a time (`CONCURRENCY`), waits for it, closes it, and reports what it brought in (captures are credited to the tab that sent them, so parallel pages do not mix). It moves to the next page as soon as the page reports it has gone quiet (`inject.js` counts requests in flight; the load event has fired and none has been pending for 0.7 s), cut off at 12 s, with a 0.4 s pause between pages. See "Deviations from the design doc". |
| `bridge.js` | Lets the app read the captured data and tell the extension which courses it chose (see below). Answers only a page on an allowed port that declares `<meta name="courseline-app">`. Sends `changed` only when something a snapshot carries changed (`cap:*`, `health`, `appPinned`, `canvasHost`, `visited` in local storage), not for pull bookkeeping in session storage, so a sync does not make the app reload the whole store after every page. |

**Extension mode (app side).** With no saved token and the extension installed (it sets `data-courselineExtension` on
`<html>`), `AuthContext` loads a snapshot through `src/extension/bridge.ts` and builds the API from it with
`src/extension/extensionApi.ts` (`createExtensionApi` returns the same `CanvasApi` type as `createCanvasApi`, so pages
do not change). Differences: ids are normalised to numbers; grades are worked out by `lib/grades.ts` from captured
scores unless Canvas's own totals were on the page; lists for courses that were never visited are empty, not an
error; anything that writes to Canvas or downloads a file rejects with "needs a Canvas access token". A section the
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
topics means the course has none (Canvas sends no list when it is empty); topics opened on their own come from the
`GetDiscussionQuery` GraphQL capture (course found from the author's link). Unit item titles leave out Canvas's
screen-reader text, and an item linked straight to another site keeps that address as its `external_url`. An assignment's posted date and Canvas's missing / late
flags also come from captured planner items when nothing better was captured. The Modules page is read again on the
page's load event and just before the page reports it has gone quiet, because Canvas draws module items late. Your name comes from `currentUser`; course names, code
and term from the dashboard card (`originalName`, `courseCode`, `term`). In the Grades page's data a submission has
fewer fields than the API's, so it updates field by field; the row's pills add `missing` / `late`; each assignment counts
in one group only (the one its newest capture puts it in); and `never_drop` ids are compared as numbers (`toModel`). Assignments, groups and
scores also come from the Grades page's own data (`gradesPageGroups` turns a `gradesPage` capture into
`assignment_groups`), so a course whose Assignments tab is hidden still has its gradebook and grade. The syllabus comes
from a `syllabus` capture or a course record carrying `syllabus_body`. New captures
arrive as a `changed` message, and `App.tsx` rebuilds `DataProvider` (keyed on `dataVersion`). A snapshot can hold
thousands of records: to find the newest one, the Canvas host or the last capture time, use `newestRecord`,
`snapshotHost` and `lastUpdatedAt` from `extensionApi.ts` (one pass) rather than copying and sorting `records`. `ExtensionStatus` (in the sidebar, under the courses) is a collapsible item: collapsed, a status dot with the same status in words (green up to date, amber partly synced or out of date, red an unexpected format, pulsing while syncing) and how long ago; opened (remembered in `courseline.extension-status-open`), coverage, Sync now, per-kind freshness, this course, and warnings. Freshness is shown per kind of
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

### Tests (`*.test.ts` / `*.test.tsx`, next to the code they cover)

| File | Covers |
|---|---|
| `api/client.test.ts` | Auth header, pagination (incl. the 50-page guard), proxy re-rooting, every error kind, `downloadTarget`, `getBlob`, and all variants of the three-step upload. |
| `api/canvas.test.ts` | Endpoint quirks: restricted-course filtering, `score_statistics` retry, hidden Files tab → `null`, >50-item modules, the Pages discovery chain and de-duplication, write payloads. |
| `lib/grades.test.ts` | Weights, current vs final, every drop rule, excused/omitted/extra credit, what-if, trend replay, goal solver, Canvas→model mapping. |
| `lib/accent.test.ts`, `lib/format.test.ts` | Palette generation and contrast rule, CSS variable application, grade/byte formatting. |
| `lib/html.test.ts` | File links found in Canvas HTML: names, `data-id`, duplicates, unnamed links. |
| `components/HtmlContent.test.ts` | Sanitizer: scripts/handlers/iframes removed, links made absolute, Canvas file links made inert. |
| `components/SubmissionForm.test.tsx` | Upload-then-submit order, failure submits nothing, retry skips already-uploaded files, allowed extensions, rich-text tab (HTML body, sanitizing, empty check, reset). |
| `context/DataContext.test.tsx` | Cache: single request per key, error capture, 5-minute freshness, refetch keeps old data visible, only the changed key re-renders, `ensure` and `prime`. |
| `context/CourseStyleContext.test.tsx` | Per-course color/icon: save, merge, reset, ignore invalid saved values. |
| `lib/courseColor.test.ts` | Colors are unique at any count, order-independent, and stable when a course is added. |
| `lib/assignmentState.test.ts` | The one color scheme for assignments (red missing / pastel blue to do / pastel green handed in), which finished work fades, and that the list badges use it. |
| `lib/pptxFix.test.ts` | Body style copied onto masters and layouts, titles and placeholders with their own style untouched, top anchoring, same bytes back when nothing to do or on garbage. |
| `lib/htmlToMarkdown.test.ts`, `lib/extractText.test.ts`, `lib/courseExport.test.ts`, `lib/courseExportRunner.test.ts` | The AI export: Markdown conversion, text from Word/PowerPoint/plain files, the document set and link rewriting, scanning, packing, size limits, failures and cancelling (with a fake Canvas API). |
| `lib/calendar.test.ts` | Month grid (week start, whole weeks, year rollover) and local date keys. |
| `i18n/i18n.test.ts` | `t()` in both languages, placeholders, saved-language detection, and that every Spanish string keeps the English `{placeholders}`. |
| `firstPaint.test.ts` | The inline script in `index.html`: old `better-canvas.*` keys move to `courseline.*` without overwriting newer ones; theme and accent apply. |
| `App.test.tsx` | Smoke test: every route renders its data through the real providers, cache and lazy-loaded screens; sidebar navigation; the Pages tab makes no per-page requests. |
| `test/fakeFetch.ts` | Helper (not a test): replaces `fetch` with a router so tests never touch the network. |

**Not** covered by automated tests: how the screens look, and the file viewer (both were checked in a real browser during
development, but those scripts were not saved).

### Other

| File | Purpose |
|---|---|
| `src/main.tsx` | Entry point, provider stack. |
| `src/App.tsx` | The router and auth gate. |
| `src/index.css` | **Tailwind configuration** and global CSS: `@theme` (the `accent-*` colors), `@custom-variant dark`, `@source` (what Tailwind scans), two base fixes, the default accent CSS variables, and styles for rendered Canvas HTML (`.canvas-html`). |
| `src/vite-env.d.ts` | Types for `import.meta.env` and for the PDF.js legacy build imports. |

---

## 6. Subsystems in depth

### 6.1 Authentication and credentials

- Credentials `{ baseUrl, token }` are stored in `localStorage` under **`courseline.credentials`**.
- If `.env` has both `VITE_CANVAS_BASE_URL` and `VITE_CANVAS_API_TOKEN`, those are used when nothing is stored.
- On start, `AuthProvider` calls `GET /users/self/profile`. Success → `authenticated`; failure → `unauthenticated`
  (login screen) with an error message.
- `createCanvasApi` is given `onUnauthorized: logout`, so **any 401 about a bad token returns you to the login
  screen**. (A 401 whose message says "not authorized" is treated as a permission problem, not a bad token — see
  [8](#8-canvas-quirks-reference).)
- `useApi()` returns the API object and throws if called while logged out. `useAuth()` exposes `status`, `user`,
  `api`, `baseUrl`, `token`, `login`, `logout`, `error`.

### 6.2 The API client

`api/client.ts`. Key behavior:

- **Every request** sends `Authorization: Bearer <token>` and `credentials: 'omit'` (never Canvas cookies).
- **The token only goes to the Canvas address, over https.** `normalizeBaseUrl` upgrades a typed `http://` address to
  `https://` (only `localhost`/`127.0.0.1` keep http, for local mocks). `getAll` re-roots every `next` link on the
  Canvas origin, so a `Link` header cannot send the token elsewhere. Anything that may point at another host (file
  storage, an upload's confirm address) is fetched **without** the token; `isCanvasOrigin(url, baseUrl)` is the check.
- **`get(path, params)`** — one JSON resource. **`getAll(path, params)`** — a list: requests `per_page=100` and follows
  the `Link: rel="next"` header until there is none (max 50 pages as a runaway guard). **`send(method, path, body)`**
  — POST/PUT/DELETE with a JSON body.
- **Array params** get Canvas's bracket form automatically: `include: ['a','b']` → `include[]=a&include[]=b`.
- **Errors** become `CanvasApiError` with a `kind`: `unauthorized`, `forbidden`, `rate_limit`, `not_found`, `network`,
  `server`, `unknown`. Rate limiting is detected from a 403 whose body says "Rate Limit Exceeded" (Canvas does not use
  429). A console warning appears when `X-Rate-Limit-Remaining` drops below 100.
- **`getBlob(url)`** downloads file bytes from a **pre-signed** URL (no auth header, because the URL carries its own
  verifier). **`downloadTarget(url, baseUrl, origin)`** decides where to fetch from: Canvas-origin URLs are re-rooted on
  `origin` (the real Canvas address, or `/canvas-proxy`), anything else is fetched as-is.
- **The dev proxy.** When `VITE_USE_DEV_PROXY=true`, `AuthContext` sets `proxyPrefix: '/canvas-proxy'`; the client sends
  every request to the Vite dev server, and `vite.config.ts` forwards it to Canvas. This avoids browser CORS blocking.
  It also sets **`followRedirects: true`**, because Canvas answers file downloads with a redirect to a different host
  (file storage), and following it server-side keeps the bytes same-origin. **The proxy exists only while
  `npm run dev` runs.** It does nothing in a built app.

### 6.3 Endpoints in use

All paths are under `/api/v1`. Function names are in `api/canvas.ts`.

| Function | Canvas endpoint | Used by |
|---|---|---|
| `getProfile` | `GET /users/self/profile` | login check, header name |
| `getCourses` | `GET /courses?enrollment_state=active&include[]=total_scores&include[]=term` | most pages (filters out restricted stubs) |
| `getCourse` | `GET /courses/:id` (same includes) | course header, grades page |
| `getCourseSyllabus` | `GET /courses/:id?include[]=syllabus_body&include[]=term` (extension mode: the syllabus page's `ENV.SYLLABUS_BODY`) | AI export |
| `getConversations(scope)` / `getConversation(id)` / `getUnreadCount` | `GET /conversations?scope=inbox|sent`, `GET /conversations/:id` (marks it read, as Canvas does), `GET /conversations/unread_count` (extension mode: Canvas's Inbox GraphQL, `mailFrom`) | Messages, sidebar badge |
| `replyToConversation` / `createConversation` | `POST /conversations/:id/add_message`, `POST /conversations` (`group_conversation: true`, `context_code`, `attachment_ids` after uploading each file with `POST /users/self/files`, `parent_folder_path: conversation attachments`) (extension mode: sent by the extension, see below) | Messages |
| `getCourseRecipients` | `GET /courses/:id/users?enrollment_type[]=teacher&enrollment_type[]=ta&enrollment_type[]=student&include[]=enrollments` (extension mode: the People page's class list, `peopleFrom`) | New message (teachers and classmates) |
| `getAssignments` | `GET /courses/:id/assignments?include[]=submission&order_by=due_at` | Assignments tab, All assignments page |
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

### 6.4 Cache and hooks

- `DataContext` provides a `QueryStore` holding `{ data, loading, error, fetchedAt }` per key. `useQuery` subscribes to
  its own key (`useSyncExternalStore`), so a response re-renders only the components that read that key.
- **`STALE_MS = 5 minutes`.** Mounting a hook with fresh data does not refetch. Older data is shown immediately and
  refetched in the background (`loading` is true during that, `data` stays — check `data` to tell first load from
  refresh).
- A request already in flight for a key is not duplicated.
- `refetch()` forces a reload.
- Inside a fetcher, `store.ensure(key, fetcher)` reuses another query's fresh or in-flight data (it returns a promise that
  rejects on failure), and `store.prime(key, data)` fills a slot from a response that already carries it. `usePages`
  uses both: discovery shares the `modules:<id>` request, and each page lands in `page:<id>:<slug>`, so the module rows
  on the Pages tab never fetch a page again. Use the same key **and** fetcher as the hook that owns the key.
- **Cache keys in use:** `courses`, `course:<id>`, `assignments:<id>`, `assignment:<cid>:<aid>`,
  `submission:<cid>:<aid>`, `modules:<id>`, `moduleItems:<cid>:<mid>`, `page:<id>:<slug>`, `pages:<id>`,
  `files:<id>`, `assignmentGroups:<id>`, `upcoming`.
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
| `/courses/:courseId/files` | `CourseFilesPage` | |
| `/courses/:courseId/grades` | `CourseGradesPage` | |
| `/courses/:courseId/assignments/:assignmentId` | `AssignmentDetailPage` | Keeps the Assignments tab highlighted. |
| `/courses/:courseId/assignments/:assignmentId/submission` | `SubmissionViewPage` | |
| `/assignments` | `AssignmentsPage` | |
| `/courses/:courseId/export` | `CourseExportPage` | |
| `/calendar` | `CalendarPage` | |
| `/settings` | `SettingsPage` | |
| `*` | "Page not found" | |

### 6.6 Settings, theme, accent, and what is stored

Everything the app remembers lives in `localStorage`:

| Key | Holds | Written by |
|---|---|---|
| `courseline.credentials` | `{baseUrl, token}` | `AuthContext` |
| `courseline.selected-courses` | JSON array of course ids (absent = show all) | `CourseFilterContext` |
| `theme` | `"light"` or `"dark"` (absent = follow the system) | `ThemeContext` |
| `courseline.accent` | custom accent `#rrggbb` (absent = default) | `ThemeContext` |
| `courseline.accent-vars` | the computed palette, so `index.html` can apply it before first paint | `ThemeContext` |
| `courseline.pages.<courseId>` | `{order: string[], collapsed: string[]}` for the Pages tab | `CoursePagesPage` |

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

Shows each module with its items: files, assignments (link to the in-app page), pages (with the files found inside
their HTML), links. Modules with more than 50 items come back from Canvas **without** `items`; `getModules` refetches
those separately. If the course's Files tab is disabled, the loose-files section is skipped (`getCourseFiles` returns
`null`) — files are still reachable through modules.

### 6.9 The file viewer

**Principle: nothing downloads unless the user presses a Download button.** Canvas file links in this app never
navigate. They open the viewer.

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
| XLSX / XLS / CSV / ODS | SheetJS (`xlsx` 0.20.3) for the values (`cell.w`, the text as Excel shows it) + `lib/xlsxStyles.ts` for the formatting SheetJS's free edition does not read (fills with theme colors and tint, fonts, borders, alignment, column widths, row heights, hidden rows and columns, gridlines, from `xl/styles.xml`, the theme and each sheet's XML) → `SheetTable`, drawn as elements (never injected HTML) on a white page in light and dark mode, with column letters and row numbers | Sheet tabs; hidden sheets skipped; merged cells; **max 2,000 rows and 200 columns per sheet** (`MAX_SHEET_ROWS`, `MAX_SHEET_COLS`). Formatting is .xlsx/.xlsm only; .xls, .ods and .csv show their values. Conditional formatting is not drawn. |
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
`OFFICE_TIMEOUT_MS` (30 s), `MAX_SHEET_ROWS` (2,000), PDF base width 800 px (`PdfViewer`).

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
"Rebuilt here from your scores: X%" note rather than hiding the discrepancy. What-if scores live only in component
state — they are never sent to Canvas.

**Class median grade (estimate).** When any graded assignment has `score_statistics`, a fifth tile shows the grade
you would have if every graded assignment had scored exactly its class median, and how many points you are above or
below it. Canvas publishes no course-level median, so this is the median *of each assignment*, not of the students'
totals: an estimate, labelled as one. Both numbers use only the graded assignments that have statistics (the tile
says "Based on N of M" when some do not), so the comparison is like for like.

**Chart — `GradeTrendChart.tsx`:** hand-written SVG (no chart library). One series, 2 px line, 10% area wash, end
label, crosshair that snaps to the nearest point, keyboard (arrow keys / Home / End), and a "Table view" twin.

### 6.11 Assignments and submissions

- `AssignmentDetailPage`: instructions (sanitized), files found in the instructions (opened in the viewer), details,
  `SubmissionForm`, your submission (long text/many attachments truncate with a link to `SubmissionViewPage`), feedback
  comments with a **Reply** box (`postSubmissionComment`), and the rubric.
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
- **Dark mode:** every colored class needs a `dark:` twin.
- **Layout rule:** only `Layout.tsx` adds outer page padding; pages and tabs must not.
- Responsive: mobile-first; the sidebar is a drawer below `md`.

---

## 7. Cookbook: how to change anything

### Add a new top-level screen

1. Create `src/pages/MyPage.tsx` exporting a component. Do not add outer padding.
2. In `App.tsx`, load it on demand: `const MyPage = lazyPage(() => import('./pages/MyPage'), 'MyPage');`, then add
   `<Route path="my-page" element={<MyPage />} />` inside the `<Route element={<Layout />}>` block.
3. Add a `<NavLink>` in `components/Sidebar.tsx` (with an icon from `navIcons` in `components/icons.tsx`).

### Add a new tab inside a course

1. Create the page component (it renders below the course header, so no title needed).
2. In `App.tsx`, declare it with `lazyPage(...)` (as above) and add a child route under `courses/:courseId`:
   `<Route path="announcements" element={<AnnouncementsPage />} />`.
3. In `components/CourseTabs.tsx`, add an entry to `tabs`:
   `{ to: \`${base}/announcements\`, label: 'Announcements', active: pathname.startsWith(\`${base}/announcements\`) }`.
   Order in the array is the order on screen. The first tab uses the bare course URL as the default.

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

### Fetch a new kind of Canvas data (end to end)

1. **Type it** in `api/types.ts` (only the fields you use).
2. **Endpoint:** add a function to the `api` object in `api/canvas.ts`, e.g.
   `getAnnouncements: (courseId: number) => client.getAll<Announcement>('/announcements', { context_codes: [\`course_${courseId}\`] })`.
   Use `client.getAll` for lists, `client.get` for one object, `client.send` for writes.
3. **Hook:** add to `hooks/useCanvasData.ts`:
   ```ts
   export function useAnnouncements(courseId: number) {
     const api = useApi();
     return useQuery(`announcements:${courseId}`, () => api.getAnnouncements(courseId));
   }
   ```
   The key **must contain every input** to the fetcher.
4. **Use it:** `const { data, error, refetch } = useAnnouncements(id); if (error) return <ErrorMessage .../>; if (!data) return <Spinner />;`
5. If a call is expected to fail for some courses (hidden tab), follow `getCourseFiles` and return `null` on
   `forbidden`/`not_found`/`unauthorized`.

### Make a request that is not a plain JSON call

Add a method to `api/client.ts` (like `getBlob` or `uploadFile`) and expose it through `canvas.ts`. **Do not call
`fetch` on a Canvas URL from a component** — it would bypass the proxy, the auth header and error mapping.

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
`applyDrops` (drop rules). If you change semantics, the headline numbers still come from Canvas — the mismatch note on
the grades page will tell you how far your maths diverges.

### Add support for another file type in the viewer

All in `components/FileViewer.tsx`:

1. `FileCategory` type and `getFileTypeCategory` — map extensions/content types to a new category.
2. Write a viewer component taking `{ fileUrl, zoom }`. `fileUrl` is a **local blob URL**: read it with `fetch(fileUrl)`.
   Render untrusted content safely (sanitize any HTML; never inject raw strings).
3. Add the category to `PREVIEWABLE`, and a line to the switch at the bottom of `FileViewer`.
4. Make it fill its panel (`h-full`) and respond to `zoom`. If it has pages, give its scroll area
   `data-scroll-frame` and add an entry to `PAGE_SELECTOR`.
5. For a new code language, add it to `codeExts` and `getMonacoLanguage`.

Do **not** add anything that points the browser at a Canvas file URL (iframe, `<embed>`, anchor): it can trigger an
automatic download or be blocked from embedding. Read bytes through the API instead.

### Change viewer limits and defaults

| Want to change | Where |
|---|---|
| Zoom steps / range | `ZOOM_PRESETS` (min/max derive from it) |
| Spreadsheet row cap | `MAX_SHEET_ROWS` |
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
`SettingsPage` (or add a tab to `TABS`).

### Add or change a translatable string

Wrap user-visible text in `t('English text')` (`import { t } from '../i18n'`; use `{name}` placeholders and pass values as the
second argument, never string concatenation, so word order can differ). Then add the same English text as a key in
`i18n/es.ts` and `i18n/pt.ts` (the tests fail if the two dictionaries differ). Separate strings for singular and plural. Error messages from `api/client.ts` and Canvas's own content are not
translated. Dates follow the app language through `lib/format.ts`; the 12/24-hour clock and first weekday follow the computer (`lib/systemClock.ts`), so pass any format with `hour` through `withClock()`.

To add a language: add it to `Language`, `LANGUAGES`, `dictionaries` and `LOCALES` in `i18n/index.ts` (and to the browser-language check in `detectLanguage`), and create its dictionary file.

### Change the sidebar or header

`components/Sidebar.tsx` (links, course list), `components/Header.tsx` (user, log out; the theme toggle is on the Settings page).

### Point the app at a different Canvas / change the proxy

Change `VITE_CANVAS_BASE_URL` in `.env` and restart `npm run dev`. The proxy target is read from it in
`vite.config.ts`; the proxy prefix `/canvas-proxy` is set in `AuthContext.tsx`.

### Change how Canvas HTML is cleaned

`sanitize()` in `components/HtmlContent.tsx`. Loosening it (allowing iframes, scripts, styles) has direct security
consequences — see [9](#9-security-model).

### Change course-card colors

`accents` array in `components/CourseCard.tsx` (derived from the course id; Canvas's real per-course colors are at
`/users/self/colors`, a noted TODO).

### Update dependencies

`npm outdated`, then update one at a time and run `npm run build` plus click through the affected screen.
Watch `pdfjs-dist` (its API changes between major versions; the legacy build path and the `?url` worker import are in
`FileViewer.tsx`) and `xlsx` (installed from SheetJS's site, not npm — update by changing the tarball URL in
`package.json`).

### Build for production

`npm run build` → static files in `dist/`. **Do not publish this as-is**; read [9](#9-security-model). The dev proxy
does not exist in a build, so file previews at CORS-restricted schools would need a real backend proxy.

---

## 8. Canvas quirks reference

Collected from the code comments and field experience. These explain code that otherwise looks odd.

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
| `score_statistics` (class median) may be rejected or absent depending on the install and the instructor's settings. | `getAssignmentGroups` retries |
| Canvas IDs are numbers but can exceed 2^53 on some shards (`Accept: application/json+canvas-string-ids`). | not handled; noted |

---

## 9. Security model

**The core risk:** the Canvas token is stored in `localStorage`. Any JavaScript running on this page can read it, and it
acts as *you*, with your full Canvas access, until it expires or is revoked. That is acceptable for a personal tool on
your own computer. It is **not** acceptable for a shared or public deployment.

What the code does to reduce the risk:

- **All instructor HTML is sanitized** (DOMPurify) before display; scripts, event handlers, iframes and `javascript:`
  URLs are stripped.
- **Spreadsheet cells** are untrusted: the sheet is drawn as React elements (text, never HTML), and only http(s) cell links become links.
- **Word hyperlinks** are restricted to http/https/mailto.
- **Tooltip and label text** is rendered by React (escaped), never via `innerHTML`.
- **Requests never send Canvas cookies** (`credentials: 'omit'`).
- **The token only goes to the Canvas address, over https**: `http://` addresses are upgraded, pagination links are
  re-rooted on Canvas, and upload storage and confirm addresses on other hosts get no token (see [6.2](#62-the-api-client)).
- **The extension takes the app's commands only from the app**: `background.js` ignores `setCanvasHost`, `openPage`,
  `cancelPull` and `setPinned` unless they come from a `localhost`/`127.0.0.1` tab (where `bridge.js` runs).
- **PDF.js** runs on the patched major version (older ones had a code-execution advisory for malicious PDFs).
- **File links never navigate or download** without an explicit Download click.

What it does *not* do (do these before anyone else uses this):

- Move the token out of the browser (a small backend that holds it, or Canvas OAuth2 with a developer key).
- Tighten the Content-Security-Policy (it exists but allows inline scripts and any https host; see risk 13).
- Pin and audit dependencies in CI.

Practical rules:

- Never commit `.env`. Never build and publish with `VITE_CANVAS_API_TOKEN` set.
- When sharing the project folder, **send everything except `node_modules` and `.env`.**
- Revoke tokens you no longer use (Canvas → Settings → Approved Integrations).
- Each person must use **their own** token.

### Deviations from the design doc

The "Courseline Canvas Sync — Design Doc" (Oct 10, 2026) says Sync now should open Canvas pages in **foreground** tabs
the student can watch, and lists "hidden background tabs auto-opening dozens or hundreds of Canvas pages" as
something not to build. The product now does this differently, by the owner's decision (Oct 13, 2026):

| Doc | Now | Why |
|---|---|---|
| Foreground tabs the student watches | Background tabs in the current window, each closed by the extension, with a live preview inside Courseline | No new windows or focus changes; works the same in Arc and other Chromium browsers (popup windows behave badly in Arc) |
| Confirmation in the extension | **Start** and **Stop** are inside the Courseline page | One place for the student to look |
| One bulk "Sync now" | Also refresh one course, one kind of data (click a freshness chip) or any single page address | Pull exactly what is wanted, quickly |

What is kept from the doc: nothing runs unless the student clicked in Courseline (enforced by the bridge), every page
is shown in the preview as it loads, Stop works between pages, pages are paced (4 background tabs at once since Oct 27, 2026, the owner's decision; one at a time before), scope is the student's
chosen courses, and nothing is scheduled or repeats. What is **not** kept: the student does not see the tabs
themselves. If that matters for a school's terms, it is the first thing to revisit. The doc itself still describes
the earlier design and should be updated to match.

### Risk register

Everything known to be risky, in one place. **Status:** *Open* = not addressed; *Mitigated* = reduced, with what is left
stated; *Accepted* = deliberately left, fine for a personal tool. "Before sharing" means it must be resolved before
anyone other than the author uses the app or the extension.

| # | Risk | Where | Status | Notes / what would fix it |
|---|---|---|---|---|
| 1 | **The Canvas token is readable by any script on the app's page** (it lives in `localStorage` and acts as the user until revoked). | `AuthContext.tsx` | Accepted, **before sharing** | Backend that holds the token, or Canvas OAuth2. See the top of this section. |
| 2 | **Any script running on the app's page can ask the extension bridge for the captured data** (grades, course names, submissions) and can ask it to open Canvas pages in background tabs (see risk 8). Same exposure as the token in `localStorage`: fine for a personal tool; it needs a proper boundary before the app is deployed for anyone else. | `extension/bridge.js`, `src/extension/bridge.ts` | Accepted, **before sharing** | The bridge now answers only the Courseline app (risk 3), but a script *inside* that page is still trusted. Fix: an exact-origin grant per site, or `externally_connectable` with a fixed origin. A script cannot start a run by itself: `bridge.js` refuses unless the page has a live user click (`navigator.userActivation.isActive`), or the run continues the run that has just ended (a chain a click started; within 2 minutes, never after Stop), and the extension no longer caps how many pages a run or an hour opens (owner's decision, Oct 27, 2026). A script *can* start one while the student is clicking something. |
| 3 | **The bridge could answer any `localhost` page**, so another project running on the machine could read the captured data. | `extension/bridge.js` | Mitigated | It now answers only on a short list of ports (5173–5180, 4173) **and** only if the page declares `<meta name="courseline-app">`. Match patterns cannot restrict ports, so this is checked at runtime. Another local page could still add that tag and use one of those ports. `background.js` also refuses the app's commands (`setCanvasHost`, `openPage`, `cancelPull`, `setPinned`) from any tab that is not on `localhost`/`127.0.0.1`, so a Canvas page or any other site cannot give them even if a future script forwarded them. |
| 4 | **Captured responses are stored unencrypted** in `chrome.storage.local`: grades, names, assignment and page text. Anyone with access to the browser profile, or malware running as the user, can read it. | `extension/background.js` | Mitigated | Email, login id and avatar fields, credential fields and **capability URLs** (calendar feed links, file links carrying a `verifier`, which work for anyone who holds them) are removed before saving (`stripSensitive`); anything older than 90 days is deleted (checked hourly). Still unencrypted at rest. **Clear captured data** removes the captures and what is derived from them (`keysToClear`) but deliberately keeps the student's own settings (the saved Canvas address, the courses chosen in the app, where the app lives). |
| 5 | **The capture scripts run on every https page** (the extension asks for access to all sites so it can recognise a Canvas on any domain). A bug in `inject.js` could interfere with an unrelated site, and while a page is undecided, up to 200 same-origin `/api/v1/` responses wait in memory. | `extension/inject.js`, `manifest.json` | Mitigated | Non-Canvas pages are dropped after 4 s and nothing leaves the page. Alternative: ask once per school domain instead of all sites (costs one click). |
| 6 | **A page can forge captures.** `relay.js` accepts any message with the right tag from the page's own window, so any script on that page (a school-added LTI tool, an analytics snippet, a compromised dependency) can post fake records. | `extension/relay.js`, `background.js` | Mitigated | `background.js` drops a record whose URL is not on the page that sent it (`sameOrigin`), and keeps nothing at all unless the student has **saved their Canvas address** (risk 7). So another website cannot add records, and cannot pose as Canvas. A script on the saved Canvas host's own pages can still forge records for that host. |
| 7 | **The Canvas host could be chosen by a page.** The "is this Canvas?" check runs inside the page, where any website can fake it, so an automatic "first Canvas wins" pin would let a hostile site claim the extension and redirect links and Sync. | `background.js`, `src/context/PullContext.tsx`, `src/extension/extensionApi.ts` | Mitigated | Nothing chooses the host for the student any more: records are kept only from the address saved in the popup or in Settings → Connection, and changing it clears the old address's data. Found in code review and fixed. |
| 8 | **Sync now automates page loads using the student's session, now in background tabs.** The student confirms inside the app and sees a live preview, can stop at any time, pages are opened 4 at a time in background tabs (`CONCURRENCY` in `extension/lib/pullRunner.js`), there is no cap on pages per run or per hour (owner's decision, Oct 27, 2026: this raises the automated-access risk below), and nothing is scheduled. A run can only start from a real click on the app's page; a confirmed run may continue from the run that just ended, round after round (the dashboard, then the courses, then the pages they link to, until nothing new turns up), within 2 minutes of each other and never after Stop. But the pages are no longer in a window the student watches, and Instructure or a school could still treat it as automated access under its terms. A student's account, not Courseline, carries that risk. | `extension/bridge.js`, `background.js`, `src/context/PullContext.tsx` | Accepted | This is a deliberate change from the design doc (see below). Keep the guardrails; do not add scheduled, repeating or fully hidden sync. |
| 9 | **Canvas changes its pages or response shapes without notice**, so capture silently stops matching and the app shows old data as if it were current. | `extension/lib/capture.js`, `ExtensionStatus.tsx` | Mitigated | Unexpected shapes are counted, kept as value-free skeletons, and shown as a warning; every dataset shows a "last updated" time. Still open: telling the student what to do about it. |
| 10 | **Grades shown in extension mode are calculated by Courseline**, not Canvas's own totals, and can differ (hidden totals, rules not modelled). | `src/extension/extensionApi.ts`, `lib/grades.ts` | Mitigated | The status bar says so. Do not use them for decisions that matter without checking Canvas. |
| 11 | **Pasting the "Copy response shapes" output elsewhere.** It has field names and types only, no values, but a field name can reveal what a school's Canvas contains. | `extension/lib/shape.js` | Accepted | Read it before pasting. |
| 12 | **The extension is loaded unpacked.** Whatever is in the `extension/` folder runs with the extension's permissions, and there is no signing or update channel. Anything that can write to that folder can change what it does. | repository / local disk | Accepted | Keep the folder in a place only you can write to. A signed build is a distribution question, not a coding one. |
| 13 | **Content-Security-Policy on the app is partial.** `'unsafe-inline'` scripts are allowed (the first-paint script and Vite's dev client need them) and `connect-src` allows any https host (the Canvas address is user-typed), so an injected inline script is not blocked and can still send data to an https site. | `index.html` via `vite.config.ts`, `src/lib/csp.ts` | Mitigated (partly) | The policy blocks plugins, base-URL changes, form posts elsewhere, `eval`, and scripts from anywhere but this site and the Monaco CDN. **Not yet checked in a browser for the PDF viewer and Monaco**: if either breaks, relax `src/lib/csp.ts`. A real fix needs a backend. |
| 14 | **Dependencies**: known advisories, accepted ones are listed in [10](#10-dependencies). | `package.json` | Mitigated | Do not run `npm audit fix --force` blindly. |
| 15 | **The extension now saves every read a Canvas page makes**, not only the routes Courseline has a screen for. That includes things other people wrote or that concern them: inbox messages and names, discussion posts, class lists, quiz details. It is all kept unencrypted on this computer (the extension has `unlimitedStorage`), and anything that can read it (risk 2, 4) gets all of it. | `extension/inject.js`, `background.js`, `lib/capture.js` | Mitigated | Credential responses (`/jwts`, tokens, login and OAuth) are never saved, and `token`-type fields and capability URLs are stripped along with email, login id and avatar. Only reads are kept (no writes, no GraphQL mutations). Data read from the page itself is limited to a fixed list of kinds (`PAGE_KINDS` in `classifyPage`) and goes through the same stripping; one of them, `currentUser`, is account-level and keeps the signed-in student's id and display name. The Grades page's `ENV.submissions` includes submission comments, with their authors' names, like the API's submissions do. Limits: one response over 3 MB is counted, not kept; at most 6,000 responses (oldest dropped first); nothing older than 90 days. The explorer in Settings → Connection shows it all, and **Clear captured data** deletes it. |
| 16 | **Opening a page in Canvas is a visit.** The pages a pull opens load exactly as if the student had opened them, so Canvas may record the view: marking module items "viewed" (which can satisfy a "must view" requirement), clearing unread flags on discussions and announcements, and logging page views that an instructor can see. The extension never writes anything itself (no POST, PUT or mutation is captured or sent), but Canvas does these things on its own when a page loads. | `src/context/PullContext.tsx`, `src/components/PullPanel.tsx` | Accepted | The confirmation says so ("Canvas may record the visit"). Module-item and discussion pages are among the links followed by **Pull linked pages**; leave that button alone for a course where a recorded view would matter. |

| 17 | **The extension can send messages as the student, and reads messages itself** (owner's decisions, Oct 29, 2026: sending, and reading threads when Messages is opened, since Canvas loads a thread only when it is clicked). Anything that can talk to the bridge (risk 2) could try to send a message to a teacher in the student's name. | `extension/bridge.js`, `background.js`, `inject.js`, `lib/message.js` | Mitigated | Only after a real click or key press on the app page (`navigator.userActivation`), only from the localhost app (`APP_ONLY`), only a reply in a conversation or a new message to Canvas user ids with a plain-text body (`cleanSendRequest`; anything else is refused), only to the saved Canvas address, from a background Canvas tab whose page script posts to the two message endpoints only (plus, for attachments, Canvas's own file-upload slot in the student's "conversation attachments" folder; at most 10 files, 25 MB in all). The form token comes from the page (`input[name=authenticity_token]` on the Settings page); no cookie is read. Reading: GET requests to the messages API only, a thread read with `auto_mark_as_read=false`, at most every two minutes and only after a click. A script running while the student clicks something could still send one message, or start one read. |

**Before the app or extension is shared with anyone:** resolve 1 and 2 at a minimum, and decide on 4, 13, 15 and 16. (3, 6 and 7 were reduced; re-check them against whatever the app is deployed on.)

---

## 10. Dependencies

| Package | Why | Notes |
|---|---|---|
| `react`, `react-dom`, `react-router-dom` (7) | UI + routing | Version 7 clears an open-redirect advisory in 6.x; the app uses only `BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `Navigate` and the `use*` hooks, which are unchanged. |
| `dompurify` | Sanitizing instructor HTML | Security-critical: keep updated |
| `pdfjs-dist` | PDF rendering | Needs Node ≥ 22.13 for installs. Pinned ≥ 6.2.108 because 5.6.83–6.2.107 has a high-severity advisory (code execution from a malicious PDF). The code uses the **legacy** build and imports the worker with Vite's `?url`. |
| `docx-preview` | Word rendering | |
| `xlsx` (SheetJS) | Spreadsheet parsing | **Installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`**, not npm: the npm copy (0.18.5) has high-severity advisories and no fix. To update, change the URL. |
| `pptx-preview` | PowerPoint rendering | Pulls in `echarts`, which has a moderate XSS advisory in a chart type (`Lines` series with tooltips) that PowerPoint rendering does not use. |
| `jszip` | Reads `presentation.xml` to get the slide aspect ratio | Also a dependency of `pptx-preview`. |
| `@monaco-editor/react` | Code viewer | Loads the editor assets from a CDN at runtime. |
| `vitest`, `jsdom` | Test runner and the simulated browser it runs in | Configured in `vite.config.ts` (`test:`) |
| `vite` (6.4), `@vitejs/plugin-react`, `typescript`, `tailwindcss` (4) with `@tailwindcss/vite` | Build tooling | Vite is kept on 6.4.x: versions up to 6.4.2 have path-traversal advisories fixed in 6.4.3+, and Vitest 5 supports 6.4+. |

`npm audit` currently reports **no critical and no high findings**. Three moderate and two low remain, and none is fixable without breaking something or reachable from this app: `echarts` and `uuid` come in through `pptx-preview` (an XSS in a chart type, 'Lines' series with tooltips, that PowerPoint rendering never uses; and a buffer-bounds issue in uuid forms the library does not call, since it only calls `v4()` with no arguments), and `monaco-editor` carries its own internal copy of `dompurify` (the app's direct `dompurify` is patched). Dependabot will list the same items; they are known and accepted. Do not run `npm audit fix --force` blindly: it makes breaking major upgrades (for `pptx-preview` it would even downgrade).

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Could not reach Canvas… CORS" | School blocks browser requests | `VITE_USE_DEV_PROXY=true` in `.env`, restart `npm run dev` |
| File preview says "Your browser blocked the download (CORS)" | Proxy not enabled / dev server not restarted | Same as above; confirm `VITE_CANVAS_BASE_URL` is correct (the proxy reads it) |
| File preview: "Canvas denied access to this file" | File locked/hidden for you | Open it in Canvas; use the Download button if offered |
| File preview: "couldn't find this file" | Deleted file | — |
| PDF spinner, then "timed out while …" | PDF engine blocked or stalled | The message names the step. Retry; check console (`[file viewer]` lines). The viewer already retries on the main thread after 10 s |
| Upload says "The browser blocked the upload to Canvas's file storage" | The storage host (a different server from Canvas) refused a browser request (CORS) | Use **Submit in Canvas** in the Details card; this cannot be fixed from the app |
| Upload says "Canvas did not confirm the upload" | Your Canvas answered step 3 in a way the app does not handle | Check the Network tab for the request after the upload; see `uploadFile` in `api/client.ts` |
| `npm ci` fails on `xlsx` | No access to `cdn.sheetjs.com` | Check network/proxy |
| "the download wasn't a PDF" | Canvas/proxy returned an error page | Check you are logged in / token valid; try reloading |
| A style has no effect, or a color is missing | The class name is built from pieces, or lives in a file Tailwind does not scan | Write the full class name; extend the `@source` lines in `src/index.css` |
| After `npm install` of a new package, imports fail or the page loops reloading | Vite's pre-bundled dependency cache is stale | Stop the server, run `npm run dev -- --force` |
| Everything is suddenly slow: `tsc` sits at 0 % CPU for minutes, the dev server takes 20 s to answer or never does, tests time out or fail with `ECANCELED: operation canceled, read`, the e2e run is flaky | The project folder is in **iCloud Drive** (Desktop & Documents) with **Optimize Mac Storage** on, and macOS has offloaded files to iCloud (check with `find . -flags +dataless \| wc -l`; `node_modules` alone is ~25,000 files). Every read then waits for a download | Best: move the project out of `~/Documents` and `~/Desktop` (for example to `~/Developer/`). Or, in Finder, right-click the folder → **Keep Downloaded**. To get going right now, force the download: `find . -flags +dataless -type f -print0 \| xargs -0 -P 64 -n 20 cat > /dev/null` |
| Two dev servers behave strangely | They share `node_modules/.vite` | Run one at a time, or give the second a different `cacheDir` |
| Port 5173 "in use" | Another server running | Vite moves to 5174+; use the printed URL |
| `EBADENGINE` warning on install | Node < 22.13 | Upgrade Node (works with a warning on 20) |
| Install fails on the `xlsx` package | No access to `cdn.sheetjs.com` | Check network/proxy; or switch to a vendored copy |
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
- **Data access:** pages → hooks → `useQuery` → `canvas.ts` → `client.ts`. No `fetch` in components.
- **Untrusted content:** Canvas HTML via `HtmlContent`; file bytes read from the local blob; labels rendered by React.
- **Naming:** hooks `useThing`; Canvas endpoint functions `getThing`; cache keys `thing:<ids>`; storage keys
  `courseline.<name>`.
- **Styling:** `neutral-*` grays, `accent-*` brand, `dark:` twin on every colored class, status colors only for status.
- **Error handling:** API errors flow through `useQuery.error` → `<ErrorMessage>`. Handle expected failures
  (hidden tabs) in `canvas.ts`, not in components.
- **Accessibility:** interactive elements are real buttons/links with labels; charts have a table view; keyboard
  support on custom controls.
- **Commit** small, working steps (see [3](#before-you-change-anything)).

### Keeping it stable while you add features

The app is in real use, so treat every change as something a student will hit tomorrow.

1. **One feature or fix per branch**, merged only when CI is green (`npm run typecheck`, `npm test`, `npm run build`).
2. **Add a test with every fix.** If it was a bug, write the test that would have caught it first. Canvas data shapes go in
   `api/canvas.test.ts` using realistic JSON; pure logic goes next to the code in `lib/`.
3. **Check UI changes in a browser**, on a real course, in light and dark mode and at phone width. Tests do not look at
   pixels.
4. **A five-minute smoke test before publishing a change**: log in; open a course; open the Pages tab; open one PDF, one
   Word, one Excel and one PowerPoint file; open the grades page and type a what-if score; open an assignment.
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
2. **The file viewer has no saved automated tests, and nothing checks how screens look.** `App.test.tsx` renders every
   screen in a simulated browser, but not pixels. Both were verified in a real browser during development with
   throwaway scripts (a fake Canvas, Chrome driven over the DevTools protocol, and before/after screenshot comparison
   for the Tailwind 4 migration). `e2e/` is that for the extension and the
   screens it feeds (a real Chrome, a mock Canvas); the file viewer and pixel comparisons are still not covered.
3. **The grade engine** matches Canvas on the cases tested (weights, drops, excused, extra credit) but has not been
   compared with a wide range of real gradebooks. Canvas's own totals remain the headline for that reason.

### Limitations by design

- Read-mostly: no discussions, announcements, inbox, quizzes; the calendar shows assignment due dates only, not Canvas calendar events (the sidebar/tabs have TODO markers).
- Cache is in memory only: a page reload refetches everything.
- Accent presets are only checked for white-text contrast, not colorblind separation (the UI uses one accent, so this
  is moot, but status badges are color + text).
- `AssignmentsPage` ("All assignments") fans out one request per visible course; with many courses the Planner API would be cheaper (one call, server-side aggregation).
- `Settings → Choose your courses`: courses added later stay hidden once any selection is saved.
- Spreadsheet previews cap at 2,000 rows per sheet; very large decks/documents render fully in the browser (memory).
- No i18n: all text is English (the Canvas content itself may be in any language).
- Monaco and PDF.js worker assets: Monaco comes from a CDN, so the code viewer needs internet.

### Pending

Work that is decided but not done.

1. **Try the extension against a real school's Canvas, and write down what differs from the mock.** The end-to-end
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
- Planner API to replace the per-course fan-out in "All assignments"; announcements/discussions/inbox, and calendar events in the calendar.
- Persist the query cache (so reloads are instant) or adopt TanStack Query.
