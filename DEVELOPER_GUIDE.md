# Better Canvas — Developer Guide

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

Better Canvas is a **browser app that replaces the Canvas LMS student interface**. It is a React single-page app that
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
| Automated tests | **98 tests** (Vitest): API client, endpoints, grades, HTML sanitizing, cache, accent colors, submission form. CI runs them on every push |
| Deployment | **Not supported** as-is (token lives in the browser; dev proxy is dev-only) |

The author uses the app day to day against a real school's Canvas. The automated tests (`src/**/*.test.ts(x)`) use a fake
one. The screens and the file viewer were also checked in a real browser against a fake Canvas during development; those
browser scripts are **not part of this repository**. Canvas installations differ a little from school to school, so on a
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
git remote add origin git@github.com:<you>/better-canvas.git
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
 context/DataContext.tsx     keyed in-memory cache, 5-minute freshness, de-dupes in-flight requests
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

Everything lives in `src/` (about 5,500 lines of app code plus tests). Config files sit in the project root.

### Root

| File | Purpose |
|---|---|
| `index.html` | HTML shell. Contains an **inline script** that applies the saved dark mode and accent color *before first paint* (prevents a flash). Keep it in sync with `ThemeContext.tsx`. |
| `vite.config.ts` | Vite + React + Tailwind plugins. Defines the **dev proxy** (`/canvas-proxy` → `VITE_CANVAS_BASE_URL`, with `followRedirects`). |
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
| `CourseFilterContext.tsx` | Which courses to show (Settings). `useCourseFilter()`. |
| `FileViewerContext.tsx` | The shared viewer modal. `useFileViewer().openFile(...)`. |

### `src/hooks/`

| File | Purpose |
|---|---|
| `useQuery.ts` | Generic fetch-and-cache hook. |
| `useCanvasData.ts` | One-line hooks per resource: `useCourses`, `useVisibleCourses`, `useCourse`, `useAssignments`, `useAssignment`, `useMySubmission`, `useModules`, `useModuleItems`, `usePage`, `usePages`, `useCourseFiles`, `useAssignmentGroups`, `useUpcoming`. |

### `src/lib/` — pure logic (no React)

| File | Purpose |
|---|---|
| `grades.ts` | The grade maths (group weights, drop rules, what-if, trend, goal solver). Fully unit-testable. |
| `accent.ts` | Accent presets and the function that turns one hex color into a full 11-step palette. |
| `format.ts` | Dates, grades, byte sizes, `courseIdFromContext`. |

### `src/pages/` — one file per screen (routes in `App.tsx`)

| File | Screen |
|---|---|
| `DashboardPage.tsx` | `/` — welcome, upcoming assignments, first four courses, grades card. |
| `CoursesPage.tsx` | `/courses` — all visible courses as cards. |
| `AssignmentsPage.tsx` | `/assignments` — one course at a time (stub; see the comment about aggregate endpoints). |
| `GradesPage.tsx` | `/grades` — grade per course, each with a **Breakdown →** link. |
| `SettingsPage.tsx` | `/settings` — Theme, Accent color, Course selection. |
| `LoginPage.tsx` | Shown whenever there are no valid credentials. |
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
| `Header.tsx`, `Sidebar.tsx` | Top bar (menu, theme toggle, user, log out); left navigation. |
| `CourseLayout.tsx`, `CourseTabs.tsx` | Per-course title/grade header and the tab strip. **Add course tabs in `CourseTabs.tsx`.** |
| `CourseCard.tsx`, `GradeSummary.tsx`, `AssignmentList.tsx` | Reusable list/card pieces. `AssignmentList` also exports `assignmentStatus()`. |
| `HtmlContent.tsx` | Sanitized rendering of Canvas HTML; intercepts file links. |
| `FileViewer.tsx` | The viewer: all file-type renderers, zoom, page tracking (the biggest file, ~900 lines). |
| `FileViewerModal.tsx` | The overlay around the viewer (Esc, click-outside, body scroll lock). |
| `GradeTrendChart.tsx` | The SVG line chart on the grades page. |
| `SubmissionForm.tsx` | Text / file submission UI. Uploads every file, then submits all their ids together. |
| `ErrorBoundary.tsx` | Catches render crashes. |
| `ui.tsx` | `Spinner`, `ErrorMessage`, `Card`, `EmptyState`, `PageTitle`. |

### Tests (`*.test.ts` / `*.test.tsx`, next to the code they cover)

| File | Covers |
|---|---|
| `api/client.test.ts` | Auth header, pagination (incl. the 50-page guard), proxy re-rooting, every error kind, `downloadTarget`, `getBlob`, and all variants of the three-step upload. |
| `api/canvas.test.ts` | Endpoint quirks: restricted-course filtering, `score_statistics` retry, hidden Files tab → `null`, >50-item modules, the Pages discovery chain and de-duplication, write payloads. |
| `lib/grades.test.ts` | Weights, current vs final, every drop rule, excused/omitted/extra credit, what-if, trend replay, goal solver, Canvas→model mapping. |
| `lib/accent.test.ts`, `lib/format.test.ts` | Palette generation and contrast rule, CSS variable application, grade/byte formatting. |
| `components/HtmlContent.test.ts` | Sanitizer: scripts/handlers/iframes removed, links made absolute, Canvas file links made inert. |
| `components/SubmissionForm.test.tsx` | Upload-then-submit order, failure submits nothing, retry skips already-uploaded files, allowed extensions, text tab. |
| `context/DataContext.test.tsx` | Cache: single request per key, error capture, 5-minute freshness, refetch keeps old data visible. |
| `test/fakeFetch.ts` | Helper (not a test): replaces `fetch` with a router so tests never touch the network. |

**Not** covered by automated tests: the screens and the file viewer (they were checked in a real browser during
development, but those scripts were not saved).

### Other

| File | Purpose |
|---|---|
| `src/main.tsx` | Entry point, provider stack. |
| `src/App.tsx` | The router and auth gate. |
| `src/index.css` | **Tailwind configuration** and global CSS: `@theme` (the `accent-*` colors), `@custom-variant dark`, `@source` (what Tailwind scans), two base fixes, the default accent CSS variables, and styles for rendered Canvas HTML (`.canvas-html`) and spreadsheet previews (`.xlsx-sheet`). |
| `src/vite-env.d.ts` | Types for `import.meta.env` and for the PDF.js legacy build imports. |

---

## 6. Subsystems in depth

### 6.1 Authentication and credentials

- Credentials `{ baseUrl, token }` are stored in `localStorage` under **`better-canvas.credentials`**.
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
| `getAssignments` | `GET /courses/:id/assignments?include[]=submission&order_by=due_at` | Assignments tab |
| `getAssignment` | `GET /courses/:id/assignments/:aid?include[]=submission` | assignment page |
| `getMySubmission` | `GET /courses/:id/assignments/:aid/submissions/self` (+ comments, rubric includes) | assignment page, submission page |
| `getAssignmentGroups` | `GET /courses/:id/assignment_groups?include[]=assignments&include[]=submission&include[]=score_statistics&scope_assignments_to_student=true` (retries without `score_statistics` on a plain 400) | grades page |
| `getModules` / `getModuleItems` | `GET /courses/:id/modules?include[]=items&include[]=content_details` / `.../modules/:mid/items` | Pages tab, Files tab |
| `getPages` / `getPage` | `GET /courses/:id/pages`, `.../pages/:slug`, `.../front_page` | Pages tab, Files tab |
| `getCourseFiles` | `GET /courses/:id/files` (returns `null` if the Files tab is hidden) | Files tab |
| `getFile` | `GET /files/:id` (gives the pre-signed `url`) | file viewer |
| `downloadFile` | fetches that signed URL's bytes | file viewer |
| `markModuleItemRead` | `POST /courses/:id/modules/:mid/items/:iid/mark_read` | opening a file from a module row |
| `postSubmissionComment` | `PUT /courses/:id/assignments/:aid/submissions/:userId` | Reply box |
| `uploadSubmissionFile` | `POST /courses/:id/assignments/:aid/submissions/self/files`, then the returned upload URL, then the confirmation URL | submission form |
| `submitAssignment` | `POST /courses/:id/assignments/:aid/submissions` (JSON `{ submission: { submission_type, body \| file_ids } }`) | submission form |
| `getUpcoming` | `GET /users/self/upcoming_events` | dashboard |

### 6.4 Cache and hooks

- `DataContext` holds `{ [key]: { data, loading, error, fetchedAt } }`.
- **`STALE_MS = 5 minutes`.** Mounting a hook with fresh data does not refetch. Older data is shown immediately and
  refetched in the background (`loading` is true during that, `data` stays — check `data` to tell first load from
  refresh).
- A request already in flight for a key is not duplicated.
- `refetch()` forces a reload.
- **Cache keys in use:** `courses`, `course:<id>`, `assignments:<id>`, `assignment:<cid>:<aid>`,
  `submission:<cid>:<aid>`, `modules:<id>`, `moduleItems:<cid>:<mid>`, `page:<id>:<slug>`, `pages:<id>`,
  `files:<id>`, `assignmentGroups:<id>`, `upcoming`.
- Upgrade path (noted in the code): replace `DataContext` with TanStack Query or Zustand; `useQuery`'s signature can
  stay.

### 6.5 Routing

Defined in `App.tsx`. Unauthenticated users always get `LoginPage`.

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
| `/grades` | `GradesPage` | |
| `/settings` | `SettingsPage` | |
| `*` | "Page not found" | |

### 6.6 Settings, theme, accent, and what is stored

Everything the app remembers lives in `localStorage`:

| Key | Holds | Written by |
|---|---|---|
| `better-canvas.credentials` | `{baseUrl, token}` | `AuthContext` |
| `better-canvas.selected-courses` | JSON array of course ids (absent = show all) | `CourseFilterContext` |
| `theme` | `"light"` or `"dark"` (absent = follow the system) | `ThemeContext` |
| `better-canvas.accent` | custom accent `#rrggbb` (absent = default) | `ThemeContext` |
| `better-canvas.accent-vars` | the computed palette, so `index.html` can apply it before first paint | `ThemeContext` |
| `better-canvas.pages.<courseId>` | `{order: string[], collapsed: string[]}` for the Pages tab | `CoursePagesPage` |

All reads/writes are wrapped in `try/catch` (storage can be blocked in private windows). Nothing is synced between
browsers or devices.

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
- Default order: modules first, then pages; the user's saved order (`better-canvas.pages.<courseId>`) wins.
- **Page discovery fallback chain** (`getPages` in `canvas.ts`): many schools hide the Pages tab, which makes the
  `/pages` index fail (404 "disabled for this course") even though individual pages load. So: try the index; if it is
  refused, **discover slugs** from module items of type `Page` (`item.page_url`) plus links found in the course front
  page, fetch each, and **de-duplicate** (different slugs can resolve to the same page).
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
| PDF | **PDF.js** (`pdfjs-dist`, the *legacy* build) draws each page to a `<canvas>` | Pages render lazily; canvas capped at ~16 megapixels. If the background worker does not answer within 10 s it **falls back to main-thread parsing** (and remembers that for the session). 60 s overall limit. Verifies the bytes start with `%PDF-`. |
| DOCX | `docx-preview` | Hyperlinks restricted to http/https/mailto. |
| XLSX / XLS / CSV / ODS | SheetJS (`xlsx` 0.20.3) → HTML table → **DOMPurify** | Sheet tabs; hidden sheets skipped; **max 2,000 rows per sheet** (`MAX_SHEET_ROWS`). |
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
  `neededAverage` (binary search for the average score needed on remaining work to reach a target).

**Page — `CourseGradesPage.tsx`:** headline tiles (current / "if the rest were zero" / points / work status), grade
over time (`GradeTrendChart`), group breakdown bars, goal calculator, assignment table with filters and per-row what-if
inputs. **The headline numbers are Canvas's own** (`computed_current_score`, `computed_final_score`); our engine is used
for everything else. If our current grade differs from Canvas's by more than 0.6 points, the page shows a
"Rebuilt here from your scores: X%" note rather than hiding the discrepancy. What-if scores live only in component
state — they are never sent to Canvas.

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
  answer or a `Location` header. If the storage host refuses the browser (CORS) the message says to use "Submit in
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
2. Add `<Route path="my-page" element={<MyPage />} />` inside the `<Route element={<Layout />}>` block in `App.tsx`.
3. Add a `<NavLink>` in `components/Sidebar.tsx`.

### Add a new tab inside a course

1. Create the page component (it renders below the course header, so no title needed).
2. In `App.tsx`, add a child route under `courses/:courseId`: `<Route path="announcements" element={<AnnouncementsPage />} />`.
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

Follow `ThemeContext`/`CourseFilterContext`: a context (or local state) with a `better-canvas.<name>` key, wrap
`localStorage` reads/writes in `try/catch`, and render correctly when storage is unavailable. If it must apply before
first paint, mirror it in the inline script in `index.html`.

### Add a settings section

In `pages/SettingsPage.tsx`, write a `function MySection()` returning a `<Card title="...">` and add it to the list in
`SettingsPage`.

### Change the sidebar or header

`components/Sidebar.tsx` (links, course list), `components/Header.tsx` (theme toggle, user, log out).

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
- **Spreadsheet cells** are untrusted: SheetJS's HTML output is sanitized before it is injected.
- **Word hyperlinks** are restricted to http/https/mailto.
- **Tooltip and label text** is rendered by React (escaped), never via `innerHTML`.
- **Requests never send Canvas cookies** (`credentials: 'omit'`).
- **PDF.js** runs on the patched major version (older ones had a code-execution advisory for malicious PDFs).
- **File links never navigate or download** without an explicit Download click.

What it does *not* do (do these before anyone else uses this):

- Move the token out of the browser (a small backend that holds it, or Canvas OAuth2 with a developer key).
- Add a Content-Security-Policy.
- Pin and audit dependencies in CI.

Practical rules:

- Never commit `.env`. Never build and publish with `VITE_CANVAS_API_TOKEN` set.
- When sharing the project folder, **send everything except `node_modules` and `.env`.**
- Revoke tokens you no longer use (Canvas → Settings → Approved Integrations).
- Each person must use **their own** token.

---

## 10. Dependencies

| Package | Why | Notes |
|---|---|---|
| `react`, `react-dom`, `react-router-dom` (7) | UI + routing | Version 7 clears an open-redirect advisory in 6.x; the app uses only `BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `Navigate` and the `use*` hooks, which are unchanged. |
| `dompurify` | Sanitizing instructor HTML and spreadsheet output | Security-critical: keep updated |
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
  `better-canvas.<name>`.
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
2. **Screens and the file viewer have no saved automated tests.** They were verified in a real browser during
   development with throwaway scripts (a fake Canvas, Chrome driven over the DevTools protocol, and before/after
   screenshot comparison for the Tailwind 4 migration). A saved version of that (Playwright + a fake-Canvas fixture)
   would be the next level of safety.
3. **The grade engine** matches Canvas on the cases tested (weights, drops, excused, extra credit) but has not been
   compared with a wide range of real gradebooks. Canvas's own totals remain the headline for that reason.

### Limitations by design

- Read-mostly: no discussions, announcements, calendar, inbox, quizzes (the sidebar/tabs have TODO markers).
- Cache is in memory only: a page reload refetches everything.
- Accent presets are only checked for white-text contrast, not colorblind separation (the UI uses one accent, so this
  is moot, but status badges are color + text).
- `AssignmentsPage` ("All assignments") is a one-course-at-a-time stub; a real cross-course view needs the Planner API.
- `Settings → Choose your courses`: courses added later stay hidden once any selection is saved.
- Spreadsheet previews cap at 2,000 rows per sheet; very large decks/documents render fully in the browser (memory).
- No i18n: all text is English (the Canvas content itself may be in any language).
- Monaco and PDF.js worker assets: Monaco comes from a CDN, so the code viewer needs internet.

### Reasonable next steps

- Run a submission against a real Canvas and fix whatever differs (see above).
- Add Playwright tests with a saved fake-Canvas fixture for the screens and the file viewer.
- Move the token behind a tiny backend (or OAuth2) so the app can be shared.
- Planner API for a real "All assignments" view; announcements/discussions/calendar/inbox.
- Persist the query cache (so reloads are instant) or adopt TanStack Query.
