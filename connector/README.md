# Courseline connector for the Claude desktop app

Lets Claude read your Canvas courses from a normal Claude chat, using your Claude Pro plan (no API key). It is a
local [MCP](https://modelcontextprotocol.io) server that the Claude desktop app runs on your computer. It reads Canvas
with your own access token and changes nothing in Canvas.

## Install

1. Build it (or use a `courseline-canvas.mcpb` someone built for you):

   ```sh
   npm run connector        # or: node connector/build.mjs
   ```

   This makes `connector/courseline-canvas.mcpb` (and `connector/server/index.mjs`, which makes the `connector/`
   folder itself installable too).

2. Make a Canvas access token: in Canvas, **Account → Settings → New access token**. Give it an expiry date.
3. Open the `.mcpb` file with the Claude desktop app (double-click it, or **Settings → Extensions → Advanced settings →
   Install Extension…**) and click **Install**. Installing the `connector/` folder as an unpacked extension works too,
   but copies the build script and README along with it.
4. When asked, enter your Canvas address (e.g. `https://campus.europaeducationgroup.es`) and the token. The app keeps the
   token in your system keychain.
5. In a new chat, ask something like *"What's due this week?"* or *"Go over what I got wrong on Quiz 3 in Cálculo"*.
   The first time Claude uses a tool, the app asks you to allow it.

To change the token later: **Settings → Extensions → Courseline for Canvas → Configure**.

## What Claude can do with it

| Tool | What it returns |
| --- | --- |
| `list_courses` | Your current courses, ids and current grades |
| `get_upcoming` | What is due soon across all courses |
| `get_course_outline` | A course's syllabus and its units, item by item |
| `list_assignments` | A course's assignments: due date, points, your status and score |
| `get_assignment` | Instructions, rubric, your score, teacher comments, rubric scores, what you handed in; for classic quizzes, each question with your answer and whether it was right |
| `get_grades` | Course total, assignment groups and weights, every score and class median |
| `list_pages`, `read_page` | Course pages as text |
| `list_files`, `read_file` | Course files: text from PDF, Word, PowerPoint (with speaker notes), Excel; images as pictures |
| `list_announcements` | Announcements, newest first |
| `search_course` | Where the syllabus, pages and assignments mention something |

## Limits

- Read-only: it cannot submit work, post, or message anyone.
- Quiz questions: classic quizzes only, and only as far as Canvas shows them to students. New Quizzes give only the score.
- Tabs a course hides from students stay hidden (a hidden Files area still shows the files its units link to).
- Scanned PDFs have no text to read.
- What Claude reads (course material, your grades) becomes part of your conversation with Claude, like anything you paste in.
- Usage counts toward your Claude plan's limits; reading many long files uses them faster.

## How it is built

`src/connector/` holds the code: `tools.ts` (the tools, built on the same Canvas API and export code as the web app),
`protocol.ts` (the MCP messages: `initialize`, `tools/list`, `tools/call`, written by hand so there are no
dependencies), and `main.ts` (stdin/stdout, plus jsdom's `DOMParser` and PDF.js running in-process, since the shared
code was written for the browser). `connector/build.mjs` bundles it with esbuild into one file and zips it with
`manifest.json`. Tests: `src/connector/connector.test.ts`. Set `DEBUG=1` when building to skip minifying.
