// A small fake Canvas over HTTPS, for e2e/run.mjs: Canvas-looking pages whose scripts call the same kinds of API routes the real
// frontend does (string ids, `while(1);` prefix, some calls in a second wave, mixed latency).
import https from 'node:https';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8443);
export const hits = [];
// Every API call the fake Canvas answered: what the extension should have picked up (or knowingly left out).
export const apiLog = [];
export const PORT_USED = PORT;

const wrap = (b) => 'while(1);' + JSON.stringify(b);
const assignment = (id, name, due, extra = {}) => ({
  id: String(id), course_id: '1', assignment_group_id: '10', name, due_at: due, points_possible: 10,
  html_url: `https://canvas.test:${PORT}/courses/1/assignments/${id}`, submission_types: ['online_upload'], position: id, ...extra,
});
const future = new Date(Date.now() + 5 * 86400e3).toISOString();
const COURSES = [
  { id: 1, name: 'Biology 101', course_code: 'BIO101', workflow_state: 'available', apply_assignment_group_weights: false, enrollments: [{ type: 'student', enrollment_state: 'active', user_id: 42 }] },
  { id: 2, name: 'World History', course_code: 'HIS200', workflow_state: 'available', apply_assignment_group_weights: false, enrollments: [{ type: 'student', enrollment_state: 'active', user_id: 42 }] },
  { id: 3, name: 'Chemistry (not pinned)', course_code: 'CHE1', workflow_state: 'available', enrollments: [{ type: 'student', enrollment_state: 'active', user_id: 42 }] },
  // Like a live school's restricted course: its menu shows only Home, Announcements, Grades and People, and the hidden
  // tabs redirect to the course home. Each assignment's own page still opens, drawn on the server (no API call).
  { id: 4, name: 'Algebra (restricted)', course_code: 'ALG1', workflow_state: 'available', apply_assignment_group_weights: false, enrollments: [{ type: 'student', enrollment_state: 'active', user_id: 42 }] },
];

const api = {
  '/api/v1/dashboard/dashboard_cards': () => [
    { id: '1', longName: 'Biology 101', shortName: 'BIO101', assetString: 'course_1', isFavorited: true },
    { id: '2', longName: 'World History', shortName: 'HIS200', assetString: 'course_2', isFavorited: true },
    { id: '4', longName: 'Algebra (restricted)', shortName: 'ALG1', assetString: 'course_4', isFavorited: true },
  ],
  '/api/v1/users/self/courses': () => COURSES,
  '/api/v1/users/self/upcoming_events': () => [],
  '/api/v1/planner/items': () => [{ plannable_id: '5', plannable_type: 'assignment', course_id: '1', plannable: { id: '5', title: 'Lab report' } }],
  '/api/v1/jwts': () => ({ token: 'SECRET-JWT-SHOULD-NEVER-BE-STORED' }),
  '/api/v1/courses/1': () => ({ ...COURSES[0], id: 1 }),
  '/api/v1/courses/2': () => ({ ...COURSES[1], id: 2 }),
  '/api/v1/courses/3': () => ({ ...COURSES[2], id: 3 }),
  '/api/v1/courses/4': () => ({ ...COURSES[3], id: 4 }),
  '/api/v1/courses/1/assignment_groups': () => [
    { id: '10', name: 'Labs', position: 1, group_weight: 0, assignments: [assignment(5, 'Lab report', future), assignment(6, 'Essay draft', future)] },
  ],
  '/api/v1/courses/2/assignment_groups': () => [
    { id: '20', name: 'Papers', position: 1, group_weight: 0, assignments: [assignment(15, 'Primary source paper', future, { course_id: '2', html_url: `https://canvas.test:${PORT}/courses/2/assignments/15` })] },
  ],
  '/api/v1/courses/1/students/submissions': () => [
    { id: 's5', assignment_id: '5', workflow_state: 'graded', score: 8, grade: '8', graded_at: '2026-10-01T10:00:00Z', submitted_at: '2026-09-30T10:00:00Z', user_id: '42' },
    { id: 's6', assignment_id: '6', workflow_state: 'unsubmitted', score: null, user_id: '42' },
  ],
  '/api/v1/courses/1/modules': () => [
    { id: '30', name: 'Unit 1', position: 1, items_count: 2, items: [
      { id: '300', module_id: '30', title: 'Week 1 reading', type: 'Page', position: 1, page_url: 'week-1', html_url: `https://canvas.test:${PORT}/courses/1/modules/items/300` },
      { id: '301', module_id: '30', title: 'Lab report', type: 'Assignment', position: 2, content_id: '5', html_url: `https://canvas.test:${PORT}/courses/1/modules/items/301` },
    ] },
  ],
  '/api/v1/courses/1/pages': () => [{ page_id: '700', url: 'week-1', title: 'Week 1', html_url: `https://canvas.test:${PORT}/courses/1/pages/week-1` }],
  '/api/v1/courses/1/pages/week-1': () => ({ page_id: '700', url: 'week-1', title: 'Week 1', body: '<p>Read chapter one about <a href="/courses/1/pages/week-2">week 2</a>.</p>', updated_at: '2026-09-01T00:00:00Z' }),
  '/api/v1/courses/1/pages/week-2': () => ({ page_id: '701', url: 'week-2', title: 'Week 2', body: '<p>Chapter two.</p>', updated_at: '2026-09-02T00:00:00Z' }),
  // Like Canvas: the same address is the announcements list when asked with only_announcements=true, else discussions.
  '/api/v1/courses/1/discussion_topics': (url) =>
    url.searchParams.get('only_announcements') === 'true'
      ? [{ id: '900', title: 'Welcome to Biology', message: '<p>Say hi</p>', posted_at: '2026-09-01T00:00:00Z', html_url: `https://canvas.test:${PORT}/courses/1/discussion_topics/900`, is_announcement: true, author: { display_name: 'Prof Rivera' } }]
      : [{ id: '901', title: 'Week 2 discussion', message: '<p>Discuss</p>', posted_at: '2026-09-08T00:00:00Z', html_url: `https://canvas.test:${PORT}/courses/1/discussion_topics/901`, is_announcement: false, author: { display_name: 'Prof Rivera' } }],
  '/api/v1/courses/1/assignments/5': () => ({ ...assignment(5, 'Lab report', future), description: '<p>Write up the lab. Use the <a href="/courses/1/pages/week-1">reading</a>.</p>', rubric: [{ id: 'c1', description: 'Clarity', points: 5, ratings: [{ id: 'r1', description: 'Clear', points: 5 }] }] }),
  '/api/v1/courses/1/discussion_topics/900': () => ({ id: '900', title: 'Welcome to Biology', message: '<p>Say hi</p>' }),
  '/api/v1/conversations': () => [{ id: '1', subject: 'Hello', last_message: 'hi' }],
  '/api/v1/courses/1/front_page': () => ({ url: 'home', title: 'Biology home', body: '<p>Welcome</p>' }),
  // Not the usual shape (no name): the extension must keep it raw, not drop it.
  '/api/v1/courses/1/assignments/7': () => ({ id: '7', unusual: true }),
  '/api/v1/courses/1/quizzes': () => [{ id: '55', title: 'Quiz 1', html_url: `https://canvas.test:${PORT}/courses/1/quizzes/55` }],
};

const graphql = (op) => {
  if (op === 'GetCourseHome' || op === 'GetCourseOutline') return { data: { course: { _id: '1', name: 'Biology 101' } } };
  if (op === 'MarkSeen') return { data: { markSeen: { ok: true } } };
  if (op === 'GetAssignmentDetail') return { data: { assignment: { _id: '6', name: 'Essay draft', description: '<p>Instructions that only arrive through GraphQL.</p>', dueAt: future, pointsPossible: 20, submissionTypes: ['online_text_entry'] } } };
  return { data: {} };
};

// Course 4's menu: the only tabs its school shows.
const NAV4 = `<nav><ul id="section-tabs">${[['/courses/4', 'Inicio'], ['/courses/4/announcements', 'Anuncios'], ['/courses/4/grades', 'Calificaciones'], ['/courses/4/users', 'Personas']]
  .map(([href, label]) => `<li><a href="${href}">${label}</a></li>`)
  .join('')}</ul></nav>`;
// A due date with an offset, as the Grades page's ENV writes it.
const future4 = new Date(Date.now() + 6 * 86400e3 + 3600e3).toISOString().replace(/\.\d{3}Z$/, '+01:00');
// An assignment page as the live school draws it: the dates as localized text, then the instructions.
const assignmentShow = (title, description) => `<div id="assignment_show" class="assignment">
  <div class="assignment-title"><div class="title-content"><h1 class="title">${title}</h1></div></div>
  <ul class="student-assignment-overview">
    <li><span class="title">Fecha de entrega</span><span class="value"><span class="date_text"><span class="display_date">20 de oct</span><span class="display_time">a las 11:15</span></span></span></li>
    <li><span class="title">Puntos</span><span class="value">10</span></li>
  </ul>
  <div class="description user_content enhanced">${description}</div>
</div>`;

// Pages: which API calls they make, in two waves.
const pages = {
  '/': { first: ['/api/v1/dashboard/dashboard_cards', '/api/v1/users/self/courses', '/api/v1/planner/items', '/api/v1/jwts'], second: ['/api/v1/users/self/upcoming_events'] },
  '/courses': { first: ['/api/v1/users/self/courses'], second: [] },
  '/grades': { first: ['/api/v1/users/self/courses'], second: [] },
  '/calendar': { first: ['/api/v1/planner/items'], second: [] },
  '/conversations': { first: ['/api/v1/conversations'], second: [] },
  '/courses/1': {
    first: ['/api/v1/courses/1', '/api/v1/courses/1/assignments/7'],
    second: [],
    // The ways a real page can ask that are easy to miss: XHR in JSON mode, GraphQL over XHR (a read and a
    // mutation), and GraphQL sent as a Request object.
    extra: `
      await new Promise((done) => { const x = new XMLHttpRequest(); x.responseType = 'json'; x.open('GET', '/api/v1/courses/1/front_page'); x.setRequestHeader('Accept', 'application/json'); x.onloadend = done; x.send(); });
      const xpost = (op, kind) => new Promise((done) => { const x = new XMLHttpRequest(); x.open('POST', '/api/graphql'); x.setRequestHeader('Content-Type', 'application/json'); x.onloadend = done; x.send(JSON.stringify({ operationName: op, query: kind + ' ' + op + ' { x }', variables: { courseId: '1' } })); });
      await xpost('GetCourseHome', 'query');
      await xpost('MarkSeen', 'mutation');
      await fetch(new Request('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationName: 'GetCourseOutline', query: 'query GetCourseOutline { x }', variables: { courseId: '1' } }) }));
    `,
  },
  '/courses/1/assignments': { first: ['/api/v1/courses/1', '/api/v1/courses/1/assignment_groups'], second: [] },
  '/courses/1/grades': { first: ['/api/v1/courses/1/students/submissions'], second: ['/api/v1/courses/1/assignment_groups'] },
  '/courses/1/modules': { first: ['/api/v1/courses/1/modules'], second: [] },
  '/courses/1/pages': { first: ['/api/v1/courses/1/pages'], second: [] },
  '/courses/1/pages/week-1': { first: ['/api/v1/courses/1/pages/week-1'], second: [] },
  '/courses/1/pages/week-2': { first: ['/api/v1/courses/1/pages/week-2'], second: [] },
  '/courses/1/announcements': { first: ['/api/v1/courses/1/discussion_topics?only_announcements=true'], second: [] },
  '/courses/1/discussion_topics': { first: ['/api/v1/courses/1/discussion_topics'], second: [] },
  '/courses/1/quizzes': { first: ['/api/v1/courses/1/quizzes'], second: [] },
  '/courses/1/assignments/5': { first: ['/api/v1/courses/1/assignments/5'], second: [] },
  '/courses/1/assignments/6': { first: [], second: [], graphql: 'GetAssignmentDetail' },
  '/courses/1/assignments/syllabus': { first: ['/api/v1/courses/1'], second: [] },
  '/courses/1/files': { first: [], second: [] },
  '/courses/1/users': { first: [], second: [] },
  '/courses/1/discussion_topics/900': { first: ['/api/v1/courses/1/discussion_topics/900'], second: [] },
  '/courses/1/quizzes/55': { first: [], second: [] },
  '/courses/1/modules/items/300': { first: [], second: [] },
  '/courses/1/modules/items/301': { first: [], second: [] },
  '/courses/2': { first: ['/api/v1/courses/2'], second: [] },
  '/courses/2/assignments': { first: ['/api/v1/courses/2/assignment_groups'], second: [] },
  '/courses/2/grades': { first: [], second: [] },
  '/courses/2/modules': { first: [], second: [] },
  '/courses/2/pages': { first: [], second: [] },
  '/courses/2/assignments/15': { first: [], second: [] },
  '/courses/4': { first: ['/api/v1/courses/4'], second: [], nav: NAV4, env: { context_asset_string: 'course_4' } },
  // The tabs the school hides only redirect to the course home.
  '/courses/4/assignments': { redirect: '/courses/4' },
  '/courses/4/modules': { redirect: '/courses/4' },
  '/courses/4/pages': { redirect: '/courses/4' },
  '/courses/4/files': { redirect: '/courses/4' },
  '/courses/4/assignments/syllabus': { redirect: '/courses/4' },
  '/courses/4/quizzes': { redirect: '/courses/4' },
  // A file link in the instructions (Canvas sends a student without access back to the course).
  '/courses/4/files/77': { redirect: '/courses/4' },
  '/courses/4/files/77/download': { redirect: '/courses/4' },
  // Not in the menu, yet it opens (live finding): an empty course loads no topics.
  '/courses/4/discussion_topics': { first: [], second: [], nav: NAV4 },
  '/courses/4/announcements': { first: [], second: [], nav: NAV4 },
  '/courses/4/users': { first: [], second: [], nav: NAV4 },
  '/courses/4/grades': {
    first: [],
    second: [],
    nav: NAV4,
    env: {
      context_asset_string: 'course_4',
      group_weighting_scheme: 'equal',
      assignment_groups: [{ id: '40', group_weight: 0, rules: {}, assignments: [
        { id: '41', points_possible: 10, due_at: future4, submission_types: ['online_upload'] },
        { id: '42', points_possible: 5, due_at: null, submission_types: ['none'] },
      ] }],
      submissions: [{ assignment_id: '41', score: 7, workflow_state: 'graded' }],
    },
    // The table links 41's row to its submission; 42's row has no link (only ENV names it).
    body: `<table id="grades_summary"><tbody>
      <tr class="student_assignment" id="submission_41"><th class="title"><a href="/courses/4/assignments/41/submissions/42">Ecuaciones</a></th><td><span class="assignment_group_id">40</span></td></tr>
      <tr class="student_assignment" id="submission_42"><th class="title">Práctica</th><td><span class="assignment_group_id">40</span></td></tr>
      <tr class="student_assignment hard_coded final_grade" id="submission_final-grade"><th class="title">Total</th><td class="assignment_score"><span class="grade"></span></td></tr>
    </tbody></table>`,
    // Like Canvas: the server sends the Total cell empty and the page's own grade calculator fills it in from a ready
    // handler (registered after the extension's). 72%, not the 70% Courseline would work out from 7/10, so the app's
    // figure tells Canvas's total from an estimate.
    ready: `document.querySelector('#submission_final-grade .grade').textContent = '72%';`,
  },
  '/courses/4/assignments/41': {
    first: ['/api/v1/courses/4'],
    second: [],
    nav: NAV4,
    env: { context_asset_string: 'course_4', ASSIGNMENT_ID: '41', COURSE_ID: '4', ASSIGNMENT_POINTS_POSSIBLE: 10, assigned_rubric: { id: 'r1', data: [{ id: 'c1', description: 'Procedimiento', points: 10, ratings: [{ id: 'r1a', description: 'Completo', points: 10 }] }] } },
    body: assignmentShow('Ecuaciones', '<p>Resuelve los ejercicios.</p><a href="/courses/4/files/77/download?verifier=SECRETV">hoja.pdf</a>'),
  },
  '/courses/4/assignments/42': {
    first: [],
    second: [],
    nav: NAV4,
    env: { context_asset_string: 'course_4', ASSIGNMENT_ID: '42', COURSE_ID: '4', ASSIGNMENT_POINTS_POSSIBLE: 5, assigned_rubric: null },
    body: assignmentShow('Práctica', ''),
  },
};

const html = (p, spec) => `<!doctype html><html><head><meta charset="utf-8"><title>Canvas ${p}</title></head>
<body class="ic-app">${spec.nav ?? ''}<div id="application"><h1>Fake Canvas: ${p}</h1>${spec.body ?? ''}</div>
<script>
window.ENV = Object.assign({ current_user_id: '42', ASSET_HOST: 'x' }, ${JSON.stringify(spec.env ?? {})});
const get = (u) => fetch(u, { headers: { Accept: 'application/json+canvas-string-ids' } }).then((r) => r.text());
const post = (op) => fetch('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationName: op, query: 'query ' + op + ' { x }', variables: { courseId: '1' } }) }).then((r) => r.text());
${spec.ready ? `document.addEventListener('DOMContentLoaded', () => { ${spec.ready} });` : ''}
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all(${JSON.stringify(spec.first ?? [])}.map(get));
  await new Promise((r) => setTimeout(r, 150));
  await Promise.all(${JSON.stringify(spec.second ?? [])}.map(get));
  ${spec.graphql ? `await post('${spec.graphql}');` : ''}
  ${spec.extra ?? ''}
  // A write the page makes: must never be captured.
  fetch('/api/v1/courses/1/mark_read', { method: 'POST', body: '{}' });
});
</script></body></html>`;

export const startMock = () => new Promise((resolve) => {
const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, async (req, res) => {
  const url = new URL(req.url, `https://canvas.test:${PORT}`);
  hits.push(`${req.method} ${url.pathname}`);
  const delay = 30 + Math.floor(Math.random() * 400) + (url.pathname.endsWith('/assignment_groups') && url.pathname.includes('/courses/1/') ? 900 : 0);
  await new Promise((r) => setTimeout(r, delay));
  if (url.pathname === '/__hits') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(hits));
  }
  if (url.pathname === '/api/graphql' && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    const op = JSON.parse(body).operationName;
    apiLog.push({ method: 'POST', path: url.pathname, search: '', status: 200, op, at: Date.now() });
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(wrap(graphql(op)));
  }
  if (url.pathname.startsWith('/api/v1/')) {
    const handler = api[url.pathname];
    apiLog.push({ method: req.method, path: url.pathname, search: url.search, status: handler ? 200 : 404, at: Date.now() });
    if (!handler) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ errors: [{ message: 'not found' }] }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    // Like Canvas: a request that asks for plain JSON gets it without the `while(1);` guard (a JSON-mode XHR could
    // not parse it otherwise).
    if (req.headers.accept === 'application/json') return res.end(JSON.stringify(handler(url)));
    return res.end(wrap(handler(url)));
  }
  const spec = pages[url.pathname];
  if (!spec) {
    res.writeHead(404, { 'content-type': 'text/html' });
    return res.end('<h1>Not found</h1>');
  }
  // A tab the school hides: Canvas sends the student back to the course home.
  if (spec.redirect) {
    res.writeHead(302, { location: spec.redirect });
    return res.end();
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html(url.pathname, spec));
});
server.listen(PORT, () => resolve(server));
});
