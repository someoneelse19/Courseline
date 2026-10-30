import { describe, expect, it } from 'vitest';
import { CanvasApiError } from '../api/client';
import type { CapturedRecord, Snapshot } from './bridge';
import { coverage, courseUpdatedAt, createExtensionApi, failingKinds, freshnessByType, gradesPageGroups, hiddenSections, mailFrom, modulesFromPage, peopleFrom, sensibleStatistics, knownCourses, lastUpdatedAt, normalizeIds, pinnedIds, valueIssues } from './extensionApi';
import { computeGrade, toModel } from '../lib/grades';

const T0 = Date.parse('2026-10-11T10:00:00Z');
const rec = (kind: string, courseId: number | null, body: unknown, at = T0, url = `https://school.test/api/v1/${kind}`): CapturedRecord => ({
  kind,
  courseId,
  host: 'school.test',
  url,
  capturedAt: at,
  body,
});
const snap = (records: CapturedRecord[], health: Snapshot['health'] = {}, appPinned: number[] | null = null): Snapshot => ({ records, health, appPinned, canvasHost: null, takenAt: T0 });

// Shapes as Canvas's own pages returned them: ids are strings.
const card = (id: string, name: string) => ({ id, longName: name, assetString: `course_${id}` });
const dueFuture = new Date(Date.now() + 5 * 86400e3).toISOString();
const dueOld = '2020-01-01T00:00:00Z';
const assignment = (id: string, name: string, due: string | null, extra: object = {}) => ({
  id,
  course_id: '1',
  assignment_group_id: '10',
  name,
  due_at: due,
  points_possible: 10,
  html_url: `https://school.test/courses/1/assignments/${id}`,
  submission_types: ['online_upload'],
  ...extra,
});
const sub = (assignmentId: string, extra: object = {}) => ({ id: `s${assignmentId}`, assignment_id: assignmentId, workflow_state: 'unsubmitted', score: null, ...extra });

const base = [
  rec('dashboardCards', null, [card('1', 'Biology'), card('2', 'History')]),
  rec('course', 1, { id: 1, name: 'Biology', apply_assignment_group_weights: false, enrollments: [{ type: 'student', enrollment_state: 'active', user_id: 42 }] }),
  rec('assignmentGroups', 1, [
    { id: '10', name: 'Labs', position: 1, group_weight: 0, assignments: [assignment('5', 'Lab report', dueOld), assignment('6', 'Essay', dueFuture), assignment('7', 'Quiz', dueFuture)] },
  ]),
  rec('courseSubmissions', 1, [
    sub('5', { workflow_state: 'graded', score: 8, graded_at: '2026-09-22T10:00:00Z' }),
    sub('6'),
    sub('7', { workflow_state: 'submitted', submitted_at: '2026-10-10T10:00:00Z' }),
  ]),
];

describe('normalizeIds', () => {
  it('turns numeric id strings into numbers, deeply, and leaves everything else', () => {
    expect(normalizeIds({ id: '5', course_id: '1', lti_context_id: 'abc', name: '12', nested: [{ user_id: '9' }] })).toEqual({
      id: 5,
      course_id: 1,
      lti_context_id: 'abc',
      name: '12',
      nested: [{ user_id: 9 }],
    });
  });
});

describe('courses and coverage', () => {
  it('merges sources, flags concluded, and takes names from the dashboard', () => {
    const s = snap([
      ...base,
      rec('userCourses', null, [{ id: 3, name: 'Old Course', workflow_state: 'completed' }, { id: 2, name: 'History (list)', workflow_state: 'available' }]),
    ]);
    const courses = knownCourses(s);
    expect(courses.find((c) => c.id === 3)).toMatchObject({ concluded: true, name: 'Old Course' });
    expect(courses.find((c) => c.id === 2)).toMatchObject({ concluded: false, name: 'History' });
  });

  it('measures coverage against current courses only, naming the missing ones', () => {
    const s = snap([...base, rec('userCourses', null, [{ id: 3, name: 'Old', workflow_state: 'completed' }])]);
    const c = coverage(s);
    expect(c).toMatchObject({ total: 2, synced: 1 });
    expect(c.missing.map((m) => m.name)).toEqual(['History']);
  });

  it('counts and lists upcoming work for pinned courses only, while the course list still has every current course', async () => {
    const s = snap([
      ...base,
      rec('userCourses', null, [{ id: 7, name: 'Not pinned', workflow_state: 'available' }]),
      rec('assignmentGroups', 7, [{ id: '70', name: 'G', position: 1, group_weight: 0, assignments: [assignment('77', 'Hidden', dueFuture, { course_id: '7' })] }]),
    ]);
    expect([...(pinnedIds(s) ?? [])].sort()).toEqual([1, 2]);
    expect(coverage(s).total).toBe(2);
    const api = createExtensionApi(s);
    // Settings must be able to list every course to choose from.
    expect((await api.getCourses()).map((c) => c.id).sort()).toEqual([1, 2, 7]);
    expect((await api.getUpcoming()).map((u) => u.title)).not.toContain('Hidden');
  });

  it('the courses chosen in the app win over the dashboard', async () => {
    const s = snap(
      [
        ...base,
        rec('userCourses', null, [{ id: 7, name: 'Chosen', workflow_state: 'available' }]),
        rec('assignmentGroups', 7, [{ id: '70', name: 'G', position: 1, group_weight: 0, assignments: [assignment('77', 'Chosen work', dueFuture, { course_id: '7' })] }]),
      ],
      {},
      [7],
    );
    expect([...(pinnedIds(s) ?? [])]).toEqual([7]);
    expect(coverage(s)).toMatchObject({ total: 1, synced: 1 });
    expect((await createExtensionApi(s).getUpcoming()).map((u) => u.title)).toEqual(['Chosen work']);
  });

  it('has no pinned set until a dashboard was captured, so everything current is used', () => {
    const s = snap([rec('userCourses', null, [{ id: 7, name: 'A', workflow_state: 'available' }])]);
    expect(pinnedIds(s)).toBeNull();
    expect(coverage(s).total).toBe(1);
  });

  it('knows when a course and the whole set were last captured', () => {
    const s = snap([rec('course', 1, { id: 1 }, T0), rec('assignmentGroups', 1, [], T0 + 5000), rec('course', 2, { id: 2 }, T0 + 9000)]);
    expect(courseUpdatedAt(s, 1)).toBe(T0 + 5000);
    expect(courseUpdatedAt(s, 99)).toBeNull();
    expect(lastUpdatedAt(s)).toBe(T0 + 9000);
    expect(lastUpdatedAt(snap([]))).toBeNull();
  });

  it('lists kinds whose latest response was unexpected', () => {
    const s = snap([], {
      assignments: { ok: 2, badShape: 1, lastOkAt: 1, lastBadAt: 5 },
      modules: { ok: 2, badShape: 1, lastOkAt: 9, lastBadAt: 5 },
    });
    expect(failingKinds(s)).toEqual(['assignments']);
  });
});

describe('createExtensionApi', () => {
  const api = createExtensionApi(snap(base));

  it('returns current courses with a grade worked out from the captured scores', async () => {
    const courses = await api.getCourses();
    expect(courses.map((c) => c.name)).toEqual(['Biology', 'History']);
    const bio = courses[0];
    expect(bio.id).toBe(1);
    expect(bio.enrollments?.find((e) => e.type === 'student')?.computed_current_score).toBeCloseTo(80); // 8 of 10 graded
  });

  it('lists assignments with ids as numbers, the submission attached and due dates ordered', async () => {
    const list = await api.getAssignments(1);
    expect(list.map((a) => a.id)).toEqual([5, 6, 7]);
    expect(list[0].submission).toMatchObject({ workflow_state: 'graded', score: 8 });
    expect(list[0].course_id).toBe(1);
  });

  it('returns the gradebook groups with submissions inside, and nothing for an unsynced course', async () => {
    const groups = await api.getAssignmentGroups(1);
    expect(groups[0].assignments?.[0].submission?.score).toBe(8);
    expect(await api.getAssignmentGroups(2)).toEqual([]);
    expect(await api.getAssignments(2)).toEqual([]);
  });

  it('upcoming leaves out past and already submitted work', async () => {
    const upcoming = await api.getUpcoming();
    expect(upcoming.map((u) => u.title)).toEqual(['Essay']);
    expect(upcoming[0].context_code).toBe('course_1');
  });

  it('says plainly when one specific thing was never captured', async () => {
    await expect(api.getAssignment(1, 999)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(api.getCourse(404)).rejects.toBeInstanceOf(CanvasApiError);
    await expect(api.getMySubmission(1, 6)).resolves.toMatchObject({ workflow_state: 'unsubmitted' });
  });

  it('refuses writes and file downloads, which need a token', async () => {
    await expect(api.submitAssignment(1, 5, { submission_type: 'online_text_entry', body: 'x' })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(api.getFile(1)).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('assembles modules with their items, and pages including the front page', async () => {
    const s = snap([
      ...base,
      rec('modules', 1, [{ id: '20', name: 'Unit 1', position: 1 }]),
      rec('moduleItems', 1, [{ id: '30', module_id: '20', title: 'Read', type: 'Page', position: 1, page_url: 'intro' }], T0, 'https://school.test/api/v1/courses/1/modules/20/items'),
      rec('frontPage', 1, { page_id: '3', url: 'home', title: 'Home', body: '<p>Hi</p>' }),
    ]);
    const a = createExtensionApi(s);
    const modules = await a.getModules(1);
    expect(modules[0].items?.[0]).toMatchObject({ id: 30, module_id: 20, page_url: 'intro' });
    expect((await a.getPages(1)).map((p) => p.url)).toEqual(['home']);
    expect((await a.getPage(1, 'home')).title).toBe('Home');
    expect(await a.getCourseFiles(1)).toBeNull();
  });
});

describe('freshnessByType', () => {
  const NOW = T0 + 3 * 3600e3;
  const find = (list: ReturnType<typeof freshnessByType>, key: string) => list.find((f) => f.key === key);

  it('reports the newest capture per kind of data for one course, and flags missing core types', () => {
    const s = snap([
      ...base.map((r) => ({ ...r, capturedAt: T0 })),
      rec('assignments', 1, [], T0 + 3600e3),
      rec('modules', 1, [], T0 - 30 * 3600e3),
    ]);
    const list = freshnessByType(s, 1, NOW);
    expect(find(list, 'assignments')).toMatchObject({ updatedAt: T0 + 3600e3, stale: false, core: true });
    expect(find(list, 'grades')).toMatchObject({ updatedAt: T0, stale: false });
    expect(find(list, 'units')).toMatchObject({ stale: true });
    expect(find(list, 'pages')).toMatchObject({ updatedAt: null, core: true });
    expect(find(list, 'upcoming')).toBeUndefined(); // account-wide, not shown for one course
    expect(find(list, 'files')).toBeUndefined(); // optional and never captured
  });

  it('across courses it uses the pinned ones only, and includes account-wide data', () => {
    const s = snap([
      ...base,
      rec('plannerItems', null, [], T0 + 1000),
      rec('courseSubmissions', 9, [], T0 + 2000), // not pinned: must not make grades look fresher
    ]);
    const list = freshnessByType(s, null, NOW);
    expect(find(list, 'upcoming')).toMatchObject({ updatedAt: T0 + 1000 });
    expect(find(list, 'grades')?.updatedAt).toBe(T0);
  });
});

describe('assignment detail from a page that was opened', () => {
  const list = rec('assignmentGroups', 1, [{ id: '10', name: 'Labs', position: 1, group_weight: 0, assignments: [assignment('5', 'Lab report', dueFuture)] }]);

  it('has no instructions until the assignment page is opened', async () => {
    const api = createExtensionApi(snap([...base.slice(0, 2), list]));
    expect((await api.getAssignment(1, 5)).description).toBeUndefined();
  });

  it('fills instructions, points and the rubric from the REST detail record', async () => {
    const detail = rec('assignment', 1, { id: '5', name: 'Lab report', description: '<p>Write it up</p>', rubric: [{ id: 'c1', description: 'Clarity', points: 5, ratings: [{ id: 'r', description: 'Good', points: 5 }] }] });
    const a = await createExtensionApi(snap([...base.slice(0, 2), list, detail])).getAssignment(1, 5);
    expect(a.description).toBe('<p>Write it up</p>');
    expect(a.rubric?.[0].id).toBe('c1');
  });

  it('finds the same assignment in a newer (GraphQL) response by its id, in either spelling', async () => {
    const graphql = rec('other', 1, {
      data: { assignment: { _id: '5', name: 'Lab report', description: '<p>From GraphQL</p>', dueAt: '2026-11-01T10:00:00Z', pointsPossible: 20, submissionTypes: ['online_upload'] } },
    });
    const a = await createExtensionApi(snap([...base.slice(0, 2), list, graphql])).getAssignment(1, 5);
    expect(a.description).toBe('<p>From GraphQL</p>');
    expect(a.points_possible).toBe(10); // the list already had it, so the list's value is kept
    expect(a.submission_types).toEqual(['online_upload']);
  });

  it('works for an assignment only the opened page knows about', async () => {
    const only = rec('other', 1, { data: { assignment: { _id: '99', name: 'Surprise', description: '<p>Hi</p>', pointsPossible: 3 } } });
    const a = await createExtensionApi(snap([only])).getAssignment(1, 99);
    expect(a).toMatchObject({ name: 'Surprise', description: '<p>Hi</p>', points_possible: 3 });
    await expect(createExtensionApi(snap([only])).getAssignment(1, 1234)).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('announcements and discussions from captured pages', () => {
  const url = (q: string) => `https://school.test/api/v1/courses/1/discussion_topics${q}`;
  const announcement = { id: '900', title: 'Welcome', message: '<p>Hi</p>', posted_at: '2026-09-01T00:00:00Z' };
  const discussion = { id: '901', title: 'Week 2', message: '<p>Q</p>', posted_at: '2026-09-08T00:00:00Z', is_announcement: false };

  it('says "not synced" instead of "empty" when that list was never captured', async () => {
    const api = createExtensionApi(snap([]));
    await expect(api.getAnnouncements(1)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(api.getDiscussions(1)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('keeps the two lists apart by how they were asked for, newest first, with numeric ids', async () => {
    const newer = { ...announcement, id: '902', title: 'Midterm moved', posted_at: '2026-10-01T00:00:00Z' };
    const api = createExtensionApi(
      snap([
        { ...rec('discussions', 1, [announcement, newer]), url: url('?only_announcements=true') },
        { ...rec('discussions', 1, [discussion]), url: url('') },
      ]),
    );
    expect((await api.getAnnouncements(1)).map((x) => [x.id, x.title])).toEqual([[902, 'Midterm moved'], [900, 'Welcome']]);
    expect((await api.getDiscussions(1)).map((x) => [x.id, x.title])).toEqual([[901, 'Week 2']]);
  });

  it('an announcements capture alone leaves discussions "not synced", and the reverse', async () => {
    const onlyAnnouncements = createExtensionApi(snap([{ ...rec('discussions', 1, [announcement]), url: url('?only_announcements=true') }]));
    expect(await onlyAnnouncements.getAnnouncements(1)).toHaveLength(1);
    await expect(onlyAnnouncements.getDiscussions(1)).rejects.toMatchObject({ kind: 'not_found' });
    const onlyDiscussions = createExtensionApi(snap([{ ...rec('discussions', 1, [discussion]), url: url('') }]));
    expect(await onlyDiscussions.getDiscussions(1)).toHaveLength(1);
    await expect(onlyDiscussions.getAnnouncements(1)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('also reads the account-wide announcements list when it was asked for this course, and only that course', async () => {
    const list = [
      { id: '5', title: 'Mine', posted_at: '2026-10-01T00:00:00Z', context_code: 'course_1' },
      { id: '6', title: 'Not mine', posted_at: '2026-10-02T00:00:00Z', context_code: 'course_2' },
    ];
    const api = createExtensionApi(snap([{ ...rec('announcements', null, list), url: 'https://school.test/api/v1/announcements?context_codes[]=course_1' }]));
    expect((await api.getAnnouncements(1)).map((x) => x.title)).toEqual(['Mine']);
    await expect(api.getAnnouncements(3)).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('the freshest capture wins when the same thing was captured twice', () => {
  const listed = (score: number | null, state: string) => rec('courseSubmissions', 1, [sub('5', { workflow_state: state, score })]);
  const groupWith = (embedded: object | undefined) =>
    rec('assignmentGroups', 1, [{ id: '10', name: 'Labs', position: 1, group_weight: 0, assignments: [assignment('5', 'Lab report', dueFuture, embedded ? { submission: embedded } : {})] }]);

  it('a newer submissions list beats an older embedded submission', async () => {
    const api = createExtensionApi(snap([{ ...groupWith({ workflow_state: 'unsubmitted', score: null }), capturedAt: T0 }, { ...listed(9, 'graded'), capturedAt: T0 + 1000 }]));
    expect((await api.getAssignments(1))[0].submission).toMatchObject({ workflow_state: 'graded', score: 9 });
  });

  it('a newer embedded submission beats an older list', async () => {
    const api = createExtensionApi(snap([{ ...listed(null, 'unsubmitted'), capturedAt: T0 }, { ...groupWith({ workflow_state: 'graded', score: 7 }), capturedAt: T0 + 1000 }]));
    expect((await api.getAssignments(1))[0].submission).toMatchObject({ workflow_state: 'graded', score: 7 });
  });

  it('of two captures of one submission detail, the newest is the one shown', async () => {
    const detail = (state: string, at: number) => ({ ...rec('submission', 1, { id: 's5', workflow_state: state }, at), url: 'https://school.test/api/v1/courses/1/assignments/5/submissions/self' });
    const api = createExtensionApi(snap([detail('graded', T0 + 5000), detail('unsubmitted', T0)]));
    expect(await api.getMySubmission(1, 5)).toMatchObject({ workflow_state: 'graded' });
  });
});

describe('the same list captured under different query strings', () => {
  const groupBody = [{ id: '10', name: 'Labs', position: 1, group_weight: 0, assignments: [assignment('5', 'Lab report', dueFuture), assignment('6', 'Essay', dueFuture)] }];
  const subs = rec('courseSubmissions', 1, [sub('5', { workflow_state: 'graded', score: 8 }), sub('6')]);

  it('lists each assignment once and counts each score once, however many times the groups were captured', async () => {
    const twice = [
      rec('dashboardCards', null, [card('1', 'Biology')]),
      { ...rec('assignmentGroups', 1, groupBody, T0), url: 'https://school.test/api/v1/courses/1/assignment_groups?include[]=assignments' },
      { ...rec('assignmentGroups', 1, groupBody, T0 + 1), url: 'https://school.test/api/v1/courses/1/assignment_groups?include[]=assignments&include[]=submission' },
      subs,
    ];
    const api = createExtensionApi(snap(twice));
    const groups = await api.getAssignmentGroups(1);
    expect(groups).toHaveLength(1);
    expect(groups[0].assignments?.map((a) => a.id)).toEqual([5, 6]);
    const bio = (await api.getCourses())[0];
    // 8 of 10 graded, once. Counted twice it would still be 80 % here, so check the points too.
    expect(bio.enrollments?.find((e) => e.type === 'student')?.computed_current_score).toBeCloseTo(80);
    const model = (await import('../lib/grades')).toModel(groups);
    expect(model.items).toHaveLength(2);
  });

  it('lists module items once too', async () => {
    const items = [{ id: '30', module_id: '20', title: 'Read', type: 'Page', position: 1 }];
    const s = snap([
      rec('modules', 1, [{ id: '20', name: 'Unit', position: 1 }]),
      rec('moduleItems', 1, items, T0, 'https://school.test/api/v1/courses/1/modules/20/items?a=1'),
      rec('moduleItems', 1, items, T0 + 1, 'https://school.test/api/v1/courses/1/modules/20/items?a=2'),
    ]);
    expect((await createExtensionApi(s).getModules(1))[0].items).toHaveLength(1);
  });
});


// What the extension reads from Canvas's own pages (ENV and the grades table), for a course whose school hides the
// Assignments, Modules, Pages and Files tabs: only Home, Announcements, Grades and People are in its menu.
describe('a course read from its pages, with tabs the school hides', () => {
  const page = (kind: string, body: unknown, at = T0) => rec(kind, 9, body, at, `https://school.test/courses/9#page:${kind}`);
  const nav = page('courseNav', { tabs: ['/courses/9', '/courses/9/announcements', '/courses/9/grades', '/courses/9/users'].map((href) => ({ href, label: href })) });
  const grades = page('gradesPage', {
    assignment_groups: [
      { id: '70', group_weight: 40, rules: {}, assignments: [{ id: '700', points_possible: 10, due_at: dueOld, submission_types: ['online_upload'], omit_from_final_grade: false }] },
      { id: '71', group_weight: 60, rules: {}, assignments: [{ id: '701', points_possible: 20, due_at: dueFuture, submission_types: ['none'] }] },
      { id: '72', group_weight: 0, rules: {}, assignments: [] },
    ],
    submissions: [
      { assignment_id: '700', score: 8, workflow_state: 'graded', excused: false },
      { assignment_id: '701', score: null, workflow_state: 'unsubmitted', excused: false },
    ],
    assignments: [
      { id: '700', name: 'Problem set 1', html_url: 'https://school.test/courses/9/assignments/700', assignment_group_id: '70' },
      { id: '701', name: 'Midterm', html_url: 'https://school.test/courses/9/assignments/701', assignment_group_id: '71' },
    ],
    group_names: { '70': 'Homework', '71': 'Exams' },
  });
  const records = [rec('dashboardCards', null, [card('9', 'Calculus')]), nav, grades];
  const api = createExtensionApi(snap(records));

  it('builds the gradebook from the Grades page: names, weights, points and scores', async () => {
    const groups = await api.getAssignmentGroups(9);
    expect(groups.map((g) => [g.name, g.group_weight, g.assignments?.map((a) => a.name)])).toEqual([
      ['Homework', 40, ['Problem set 1']],
      ['Exams', 60, ['Midterm']],
      ['Assignment group', 0, []],
    ]);
    expect(groups[0].assignments?.[0]).toMatchObject({ id: 700, points_possible: 10, submission: { score: 8, workflow_state: 'graded' } });
    expect((await api.getAssignments(9)).map((a) => a.name)).toEqual(['Problem set 1', 'Midterm']);
  });

  it('works out the grade from it (graded work only, weights rescaled)', async () => {
    const course = await api.getCourse(9);
    expect(course.enrollments?.find((e) => e.type === 'student')?.computed_current_score).toBeCloseTo(80);
  });

  it('knows which tabs the school hides, and says so instead of "not synced"', async () => {
    expect([...hiddenSections(snap(records), 9)].sort()).toEqual(['assignments', 'discussions', 'files', 'modules', 'pages', 'quizzes', 'syllabus']);
    await expect(api.getModules(9)).rejects.toMatchObject({ kind: 'hidden', message: expect.stringMatching(/Units is not in this course’s Canvas menu/) });
    expect(await api.getCourseFiles(9)).toBeNull(); // as the API answers a hidden Files area: only files in units
    await expect(api.getCourseSyllabus(9)).rejects.toMatchObject({ kind: 'hidden' });
    await expect(api.getAnnouncements(9)).rejects.toThrow(/not been synced/); // shown in the menu, just not opened yet
    const fresh = freshnessByType(snap(records), 9);
    expect(fresh.find((f) => f.key === 'units')).toMatchObject({ updatedAt: null, hidden: true });
    expect(fresh.find((f) => f.key === 'assignments')).toMatchObject({ updatedAt: T0 });
    expect(fresh.find((f) => f.key === 'grades')?.hidden).toBeUndefined();
  });

  it('assumes nothing is hidden before the course menu was captured', () => {
    expect(hiddenSections(snap([grades]), 9).size).toBe(0);
  });

  it('serves the syllabus read from the syllabus page', async () => {
    const withSyllabus = createExtensionApi(snap([...records.filter((r) => r !== nav), page('syllabus', { syllabus_body: '<p>Outline</p>' })]));
    expect((await withSyllabus.getCourseSyllabus(9)).syllabus_body).toBe('<p>Outline</p>');
  });

  it('never blanks a field an API capture already had', () => {
    const [g] = gradesPageGroups({ assignment_groups: [{ id: '1', assignments: [{ id: '2' }] }], submissions: [], assignments: [] });
    expect(g).not.toHaveProperty('name');
    expect(g.assignments?.[0]).not.toHaveProperty('name');
  });
});

describe('more read from the page: modules, files, who is signed in, missing/late and class statistics', () => {
  const page = (kind: string, body: unknown, at = T0, courseId: number | null = 9) =>
    rec(kind, courseId, body, at, courseId ? `https://school.test/courses/${courseId}#page:${kind}` : `https://school.test/#page:${kind}`);
  const card = { id: '9', originalName: 'Calculus (C1)', longName: 'Calculus (C1) - CALC', shortName: 'Calculus (C1)', courseCode: 'CALC', term: 'Fall', assetString: 'course_9' };

  it('turns the Modules page into units, mapping Canvas model names to item types and page ids to slugs', () => {
    const body = {
      modules: [
        {
          id: '50',
          name: 'Unit 1',
          position: 1,
          items: [
            { id: '500', canvas_type: 'ContextModuleSubHeader', content_id: '0', title: 'Theory', indent: 0, position: 1 },
            { id: '501', canvas_type: 'Attachment', content_id: '77', title: 'Notes.pdf', indent: 1, position: 2, html_url: 'https://school.test/courses/9/modules/items/501' },
            { id: '502', canvas_type: 'WikiPage', content_id: '88', title: 'Welcome', indent: 0, position: 3 },
            { id: '503', canvas_type: 'ExternalUrl', content_id: '1', title: 'Teams', external_url: 'https://teams.example', indent: 0, position: 4 },
          ],
        },
      ],
    };
    const [unit] = modulesFromPage(body, 9, new Map([[88, 'welcome']]));
    expect(unit).toMatchObject({ id: 50, name: 'Unit 1', items_count: 4 });
    expect(unit.items?.map((i) => [i.type, i.content_id, i.page_url, i.external_url, i.indent])).toEqual([
      ['SubHeader', undefined, undefined, undefined, 0],
      ['File', 77, undefined, undefined, 1],
      ['Page', 88, 'welcome', undefined, 0],
      ['ExternalUrl', undefined, undefined, 'https://teams.example', 0],
    ]);
  });

  it('serves units from the Modules page when no API module list was captured', async () => {
    const api = createExtensionApi(
      snap([
        rec('dashboardCards', null, [card]),
        page('modulesPage', { modules: [{ id: '50', name: 'Unit 1', position: 1, items: [{ id: '501', canvas_type: 'Attachment', content_id: '77', title: 'Notes.pdf', position: 1 }] }] }),
      ]),
    );
    expect((await api.getModules(9)).map((m) => [m.name, m.items?.length])).toEqual([['Unit 1', 1]]);
  });

  it('lists the files the Files page loaded folder by folder, only for this course', async () => {
    const file = (id: string, course: string) => ({ id, display_name: `f${id}.pdf`, size: 10, context_asset_string: `course_${course}`, updated_at: '2026-10-01T00:00:00Z' });
    const folder = { id: '3', name: 'course files', full_name: 'course files', context_asset_string: 'course_9' };
    const records = [rec('dashboardCards', null, [card]), rec('other', null, [file('1', '9'), file('2', '8'), folder], T0, 'https://school.test/api/v1/folders/4/all')];
    records[1].route = 'GET /folders/:id/all';
    const files = await createExtensionApi(snap(records)).getCourseFiles(9);
    expect(files?.map((f) => [f.id, f.display_name])).toEqual([[1, 'f1.pdf']]);
  });

  it('says files are not synced (not hidden) when the Files tab is shown but was never opened', async () => {
    const nav = page('courseNav', { tabs: ['/courses/9', '/courses/9/files'].map((href) => ({ href })) });
    await expect(createExtensionApi(snap([rec('dashboardCards', null, [card]), nav])).getCourseFiles(9)).rejects.toThrow(/not been synced/);
    const hiddenNav = page('courseNav', { tabs: [{ href: '/courses/9' }] });
    expect(await createExtensionApi(snap([rec('dashboardCards', null, [card]), hiddenNav])).getCourseFiles(9)).toBeNull();
  });

  it('greets the student by the name Canvas shows, and names courses as the API does', async () => {
    const api = createExtensionApi(snap([rec('dashboardCards', null, [card]), page('currentUser', { id: '42', display_name: 'Ada L' }, T0, null)]));
    expect(await api.getProfile()).toMatchObject({ id: 42, name: 'Ada L' });
    expect(await api.getCourse(9)).toMatchObject({ name: 'Calculus (C1)', course_code: 'CALC', term: { name: 'Fall' } });
  });

  it('keeps fields the Grades page lacks from an older capture, and adds missing, late and class statistics', async () => {
    const older = rec('courseSubmissions', 9, [{ id: 's1', assignment_id: '700', submitted_at: '2026-10-02T00:00:00Z', graded_at: '2026-10-03T00:00:00Z', score: 5, workflow_state: 'graded' }], T0 - 1000, 'https://school.test/api/v1/courses/9/students/submissions');
    const grades = page('gradesPage', {
      assignment_groups: [{ id: '70', group_weight: 0, rules: {}, assignments: [{ id: '700', points_possible: 10 }, { id: '701', points_possible: 10, due_at: dueOld }] }],
      submissions: [
        { assignment_id: '700', score: 8, workflow_state: 'graded', excused: false },
        { assignment_id: '701', score: null, workflow_state: 'unsubmitted', excused: false },
      ],
      assignments: [
        { id: '700', name: 'Set 1', late: true, missing: false, score_statistics: { mean: 6, median: 7, max: 10, min: 1, upper_q: 8, lower_q: 4 } },
        { id: '701', name: 'Set 2', late: false, missing: true },
      ],
      group_names: { '70': 'Homework' },
    });
    const api = createExtensionApi(snap([rec('dashboardCards', null, [card]), older, grades]));
    const [group] = await api.getAssignmentGroups(9);
    const [a700, a701] = group.assignments ?? [];
    expect(a700).toMatchObject({ course_id: 9, score_statistics: { median: 7 }, submission: { score: 8, late: true, submitted_at: '2026-10-02T00:00:00Z', graded_at: '2026-10-03T00:00:00Z' } });
    expect(a701.submission).toMatchObject({ missing: true, score: null });
  });
});

describe('fixes from review', () => {
  const page = (kind: string, body: unknown, at = T0) => rec(kind, 9, body, at, `https://school.test/courses/9#page:${kind}`);
  const card9 = { id: '9', originalName: 'Calculus', assetString: 'course_9' };

  it('keeps an embedded submission\'s fields when a newer Grades-page copy has fewer', async () => {
    const groupsOld = rec('assignmentGroups', 9, [{ id: '70', name: 'Homework', position: 1, group_weight: 0, assignments: [{ ...assignment('700', 'Set 1', dueOld), course_id: '9', assignment_group_id: '70', submission: { assignment_id: '700', score: 5, submitted_at: '2026-10-02T00:00:00Z', grade: '5', workflow_state: 'graded' } }] }], T0 - 1000, 'https://school.test/api/v1/courses/9/assignment_groups');
    const grades = page('gradesPage', { assignment_groups: [{ id: '70', assignments: [{ id: '700', points_possible: 10 }] }], submissions: [{ assignment_id: '700', score: 8, workflow_state: 'graded' }], assignments: [{ id: '700', name: 'Set 1' }] });
    const [g] = await createExtensionApi(snap([rec('dashboardCards', null, [card9]), groupsOld, grades])).getAssignmentGroups(9);
    expect(g.assignments?.[0].submission).toMatchObject({ score: 8, submitted_at: '2026-10-02T00:00:00Z', grade: '5' });
  });

  it('counts an assignment that moved group only in its newest group', async () => {
    const before = rec('assignmentGroups', 9, [{ id: '70', name: 'A', position: 1, group_weight: 0, assignments: [assignment('700', 'Set 1', dueOld)] }], T0 - 1000, 'https://school.test/api/v1/courses/9/assignment_groups');
    const after = page('gradesPage', { assignment_groups: [{ id: '70', assignments: [] }, { id: '71', assignments: [{ id: '700', points_possible: 10 }] }], submissions: [], assignments: [{ id: '700', name: 'Set 1' }], group_names: { '71': 'B' } });
    const groups = await createExtensionApi(snap([rec('dashboardCards', null, [card9]), before, after])).getAssignmentGroups(9);
    expect(groups.map((g) => [g.name, g.assignments?.map((a) => a.id)])).toEqual([['A', []], ['B', [700]]]);
    expect(groups[1].assignments?.[0].html_url).toBe('https://school.test/courses/1/assignments/700'); // carried over
  });

  it('dates units and files from the Modules page and the folder listings', () => {
    const listing = rec('folderContents', null, [{ id: '1', display_name: 'a.pdf', size: 1, context_asset_string: 'course_9' }], T0, 'https://school.test/api/v1/folders/3/all');
    const fresh = freshnessByType(snap([rec('dashboardCards', null, [card9]), page('modulesPage', { modules: [] }), listing]), 9);
    expect(fresh.find((f) => f.key === 'units')?.updatedAt).toBe(T0);
    expect(fresh.find((f) => f.key === 'files')?.updatedAt).toBe(T0);
  });

  it('shows a Files tab that is not in the menu as such, even with no files captured', () => {
    const nav = page('courseNav', { tabs: [{ href: '/courses/9' }] });
    expect(freshnessByType(snap([rec('dashboardCards', null, [card9]), nav]), 9).find((f) => f.key === 'files')).toMatchObject({ hidden: true });
  });
});

describe('matching the API: posted dates, missing flags and the upcoming window', () => {
  const card9 = { id: '9', originalName: 'Calculus', assetString: 'course_9' };
  const grades = rec('gradesPage', 9, {
    assignment_groups: [{ id: '70', assignments: [{ id: '700', points_possible: 10 }, { id: '701', points_possible: 10, due_at: new Date(Date.now() + 3 * 86400e3).toISOString() }, { id: '702', points_possible: 10, due_at: new Date(Date.now() + 10 * 86400e3).toISOString() }] }],
    submissions: [{ assignment_id: '700', score: null, workflow_state: 'unsubmitted' }],
    assignments: [{ id: '700', name: 'Team formation' }, { id: '701', name: 'Soon' }, { id: '702', name: 'Later' }],
  }, T0, 'https://school.test/courses/9#page:gradesPage');
  const planner = rec('plannerItems', null, [
    { plannable_type: 'assignment', plannable_id: '700', course_id: '9', plannable: { created_at: '2026-09-27T10:00:00Z', title: 'Team formation' }, submissions: { missing: true, late: false } },
  ], T0, 'https://school.test/api/v1/planner/items');
  const api = createExtensionApi(snap([rec('dashboardCards', null, [card9]), grades, planner]));

  it('takes the posted date and Canvas\'s missing flag from planner items', async () => {
    const a = (await api.getAssignments(9)).find((x) => x.id === 700);
    expect(a).toMatchObject({ created_at: '2026-09-27T10:00:00Z', submission: { missing: true, late: false } });
  });

  it('lists as upcoming only what is due within the next week, as the API does', async () => {
    expect((await api.getUpcoming()).map((e) => e.title)).toEqual(['Soon']);
  });
});

describe('class statistics that do not add up are left out', () => {
  it('keeps statistics in order and drops misread ones', () => {
    expect(sensibleStatistics({ min: 0, lower_q: 3.75, median: 6.88, upper_q: 9.56, max: 10, mean: 6.17 })).toBeTruthy();
    // "6.88" read as 688: the median is above the high score.
    expect(sensibleStatistics({ min: 0, lower_q: 375, median: 688, upper_q: 956, max: 10, mean: 617 })).toBeUndefined();
    expect(sensibleStatistics({ min: 8, lower_q: 9, median: 9, upper_q: 10, max: 10, mean: 93 })).toBeUndefined(); // mean out of range
    expect(sensibleStatistics({ min: 1, max: 9, mean: 5 })).toBeUndefined(); // no median
  });
});

describe('review fixes: statistics against points, planner flags with no submission', () => {
  it('drops statistics that are all misread by the same factor (6.88 read as 688 on a 10-point assignment)', () => {
    const scaled = { min: 0, lower_q: 375, median: 688, upper_q: 956, max: 1000, mean: 617 };
    expect(sensibleStatistics(scaled)).toBeTruthy(); // in order, so only the points can tell
    expect(sensibleStatistics(scaled, 10)).toBeUndefined();
    expect(sensibleStatistics({ min: 0, lower_q: 3.75, median: 6.88, upper_q: 9.56, max: 10, mean: 6.17 }, 10)).toBeTruthy();
    expect(sensibleStatistics({ min: 0, lower_q: 8, median: 11, upper_q: 12, max: 12, mean: 10 }, 10)).toBeTruthy(); // extra credit
  });

  it('keeps Canvas\'s missing flag from planner items even when no submission was captured', async () => {
    const card9 = { id: '9', originalName: 'Calculus', assetString: 'course_9' };
    const groups = rec('assignmentGroups', 9, [{ id: '70', name: 'G', position: 1, group_weight: 0, assignments: [{ ...assignment('700', 'Set', dueOld), course_id: '9' }] }], T0, 'https://school.test/api/v1/courses/9/assignment_groups');
    const planner = rec('plannerItems', null, [{ plannable_type: 'assignment', plannable_id: '700', course_id: '9', plannable: {}, submissions: { missing: true } }], T0, 'https://school.test/api/v1/planner/items');
    const [a] = await createExtensionApi(snap([rec('dashboardCards', null, [card9]), groups, planner])).getAssignments(9);
    expect(a.submission).toEqual({ assignment_id: 700, missing: true });
  });
});

describe('matching the API: order of courses, files and pages; empty discussions', () => {
  const cards = [{ id: '2', originalName: 'Zoology', assetString: 'course_2' }, { id: '1', originalName: 'Algebra', assetString: 'course_1' }];

  it('lists courses by name, as /courses answers', async () => {
    expect((await createExtensionApi(snap([rec('dashboardCards', null, cards)])).getCourses()).map((c) => c.name)).toEqual(['Algebra', 'Zoology']);
  });

  it('lists files newest first', async () => {
    const listing = rec('folderContents', null, [
      { id: '1', display_name: 'old.pdf', size: 1, context_asset_string: 'course_1', updated_at: '2026-09-01T00:00:00Z' },
      { id: '2', display_name: 'new.pdf', size: 1, context_asset_string: 'course_1', updated_at: '2026-10-01T00:00:00Z' },
    ], T0, 'https://school.test/api/v1/folders/3/all');
    const files = await createExtensionApi(snap([rec('dashboardCards', null, cards), listing])).getCourseFiles(1);
    expect(files?.map((f) => f.display_name)).toEqual(['new.pdf', 'old.pdf']);
  });

  it('puts the front page first, then the pages in the order it links them', async () => {
    const page = (url: string, extra: object = {}) => rec('page', 1, { url, title: url, body: '', ...extra }, T0, `https://school.test/courses/1#page:wikiPage:${url}`);
    const front = rec('frontPage', 1, { url: 'index', title: 'Index', front_page: true, body: '<a href="/courses/1/pages/b">B</a> <a href="/courses/1/pages/a">A</a>' }, T0, 'https://school.test/courses/1#page:wikiPage');
    const pages = await createExtensionApi(snap([rec('dashboardCards', null, cards), page('a'), page('z'), page('b'), front])).getPages(1);
    expect(pages.map((p) => p.url)).toEqual(['index', 'b', 'a', 'z']);
  });

  it('a Discussions page that was opened and loaded nothing means no discussions', async () => {
    const s = { ...snap([rec('dashboardCards', null, cards)]), visited: { 'https://school.test/courses/1/discussion_topics': T0 } };
    expect(await createExtensionApi(s).getDiscussions(1)).toEqual([]);
    await expect(createExtensionApi(snap([rec('dashboardCards', null, cards)])).getDiscussions(1)).rejects.toThrow(/not been synced/);
  });

  it('reads a discussion opened on its own (GraphQL), for its course only', async () => {
    const node = (id: string, course: string, isAnnouncement = false) => ({ data: { legacyNode: { _id: id, title: `T${id}`, message: '<p>m</p>', postedAt: '2026-10-01T00:00:00Z', isAnnouncement, author: { displayName: 'Prof', htmlUrl: `https://school.test/courses/${course}/users/5` } } } });
    const g = (body: unknown) => Object.assign(rec('other', null, body, T0, 'https://school.test/api/graphql'), { route: 'POST /api/graphql GetDiscussionQuery' });
    const s = { ...snap([rec('dashboardCards', null, cards), g(node('10', '1')), g(node('11', '2')), g(node('12', '1', true))]), visited: { 'https://school.test/courses/1/discussion_topics': T0 } };
    const api = createExtensionApi(s);
    expect((await api.getDiscussions(1)).map((d) => [d.id, d.title, d.author?.display_name])).toEqual([[10, 'T10', 'Prof']]);
    expect((await api.getAnnouncements(1)).map((d) => d.id)).toEqual([12]);
  });
});

describe('the inbox, from what Canvas\'s own Inbox loaded', () => {
  const gql = (nodes: unknown[], variables?: object, at = T0) =>
    Object.assign(rec('other', null, { data: { legacyNode: { _id: '42', conversationsConnection: { nodes } } } }, at, 'https://school.test/api/graphql'), { route: 'POST /api/graphql GetConversationsQuery', variables });
  const node = (id: string, subject: string, state: string, msg: object, people: string[], count = 1) => ({
    workflowState: state,
    conversation: {
      _id: id,
      subject,
      conversationMessagesCount: count,
      conversationParticipantsConnection: { nodes: people.map((n) => ({ user: { shortName: n } })) },
      conversationMessagesConnection: { nodes: [msg] },
    },
  });
  const m = (id: string, author: string, authorId: string, at: string, body: string) => ({ id, body, createdAt: at, author: { _id: authorId, name: author } });

  it('lists conversations with their newest message, unread state and senders first', () => {
    const mail = mailFrom([
      gql([node('7', 'Pi', 'unread', m('a', 'Prof ', '5', '2026-09-26T16:16:28+02:00', 'Here'), ['Ana', 'Me ', 'Prof '], 3)], { scope: 'inbox' }),
    ]);
    const c = mail.get(7)!.conversation;
    expect(c).toMatchObject({ subject: 'Pi', workflow_state: 'unread', last_message: 'Here', message_count: 3 });
    expect(c.participants.map((p) => p.name)).toEqual(['Prof', 'Ana', 'Me']);
    expect([...mail.get(7)!.scopes]).toEqual(['inbox']);
  });

  it('knows the sent folder from the query\'s variables, and adds what the extension sent', () => {
    const sentRest = rec('conversation', null, { id: 8, subject: 'Q', workflow_state: 'read', participants: [{ id: 42, name: 'Me' }, { id: 5, name: 'Prof' }], messages: [{ id: 99, created_at: '2026-10-01T10:00:00Z', body: 'My question', author_id: 42 }] }, T0 + 5, 'https://school.test/api/v1/conversations/8');
    const mail = mailFrom([gql([node('8', 'Q', 'read', m('b', 'Prof', '5', '2026-09-30T10:00:00Z', 'Ask'), ['Me', 'Prof'])], { scope: 'sent' }), sentRest]);
    const e = mail.get(8)!;
    expect([...e.scopes]).toEqual(['sent']);
    expect([...e.messages.values()].map((x) => x.body).sort()).toEqual(['Ask', 'My question']);
    expect(e.conversation.last_message).toBe('My question');
  });

  it('sorts GraphQL messages (with an offset) and REST messages (in UTC) by when they were written, not as text', async () => {
    // 07:32 in Madrid is 05:32 UTC: before the REST message at 06:00 UTC, though "07:32" sorts after "06:00" as text.
    const rest = rec('conversation', null, { id: 7, subject: 'Pi', workflow_state: 'read', participants: [], messages: [{ id: 99, created_at: '2026-10-02T06:00:00Z', body: 'Later (REST)', author_id: 42 }] }, T0 + 5, 'https://school.test/api/v1/conversations/7');
    const api = createExtensionApi(snap([gql([node('7', 'Pi', 'read', m('a', 'Prof', '5', '2026-10-02T07:32:43+02:00', 'Earlier (GraphQL)'), ['Prof', 'Me'])], { scope: 'inbox' }), rest]));
    const thread = await api.getConversation(7);
    expect(thread.messages?.map((x) => [x.body, x.created_at])).toEqual([['Later (REST)', '2026-10-02T06:00:00Z'], ['Earlier (GraphQL)', '2026-10-02T05:32:43Z']]);
    expect(thread.last_message).toBe('Later (REST)');
  });

  it('orders the inbox by a REST list\'s last_message_at in UTC', async () => {
    // A REST list says 07:00+02:00 (05:00 UTC); a GraphQL conversation's newest message is 06:00 UTC, so it is newer.
    const list = Object.assign(rec('other', null, [{ id: 20, subject: 'Older', workflow_state: 'read', last_message: 'x', last_message_at: '2026-10-02T07:00:00+02:00', participants: [] }], T0, 'https://school.test/api/v1/conversations?scope=inbox'), { route: 'GET /conversations' });
    const api = createExtensionApi(snap([list, gql([node('21', 'Newer', 'read', m('n', 'Prof', '5', '2026-10-02T06:00:00Z', 'y'), ['Prof'])], { scope: 'inbox' })]));
    const inbox = await api.getConversations('inbox');
    expect(inbox.map((c) => [c.subject, c.last_message_at])).toEqual([['Newer', '2026-10-02T06:00:00Z'], ['Older', '2026-10-02T05:00:00Z']]);
  });

  it('serves the inbox, a thread (newest first) and the unread count through the API', async () => {
    const api = createExtensionApi(snap([rec('dashboardCards', null, [card('1', 'Bio')]), gql([node('7', 'Pi', 'unread', m('a', 'Prof', '5', '2026-09-26T16:16:28+02:00', 'Here'), ['Prof', 'Me'])])]));
    expect((await api.getConversations('inbox')).map((c) => c.subject)).toEqual(['Pi']);
    expect((await api.getConversation(7)).messages?.map((x) => x.body)).toEqual(['Here']);
    expect(await api.getUnreadCount()).toBe(1);
    await expect(createExtensionApi(snap([])).getConversations('inbox')).rejects.toThrow(/not been synced/);
  });
});

describe('people to write to, from a course\'s People page', () => {
  it('keeps teachers, TAs and classmates, by name', () => {
    const people = Object.assign(rec('other', 9, [
      { id: '5', name: 'Zoe Prof', enrollments: [{ type: 'TeacherEnrollment' }] },
      { id: '6', name: 'Al Helper', enrollments: [{ type: 'TaEnrollment' }] },
      { id: '7', name: 'Classmate', enrollments: [{ type: 'StudentEnrollment' }] },
    ], T0, 'https://school.test/api/v1/courses/9/users'), { route: 'GET /courses/:id/users' });
    expect(peopleFrom([people], 9)).toEqual([{ id: 6, name: 'Al Helper', role: 'ta' }, { id: 7, name: 'Classmate', role: 'student' }, { id: 5, name: 'Zoe Prof', role: 'teacher' }]);
    expect(peopleFrom([people], 8)).toEqual([]);
  });
});

describe('a thread opened in Canvas\'s Inbox, and its newest message from the list', () => {
  it('is one message, not two, and its attachment keeps its name', () => {
    const list = Object.assign(rec('other', null, { data: { legacyNode: { conversationsConnection: { nodes: [{ workflowState: 'read', conversation: { _id: '9', subject: 'Photo', conversationMessagesCount: 2, conversationParticipantsConnection: { nodes: [] }, conversationMessagesConnection: { nodes: [{ id: btoa('ConversationMessage-61'), body: 'here', createdAt: '2026-10-02T07:32:43+02:00', author: { _id: '42', name: 'Me' } }] } } }] } } } }, T0, 'https://school.test/api/graphql'), { route: 'POST /api/graphql GetConversationsQuery' });
    const thread = Object.assign(rec('other', null, { data: { legacyNode: { __typename: 'Conversation', _id: '9', subject: 'Photo', contextName: 'Programming', conversationMessagesConnection: { nodes: [
      { _id: '61', id: btoa('ConversationMessage-61'), body: 'here', createdAt: '2026-10-02T07:32:43+02:00', author: { _id: '42', name: 'Me' }, attachments: [{ _id: '5', displayName: 'photo.jpg' }] },
      { _id: '60', id: btoa('ConversationMessage-60'), body: 'please send it', createdAt: '2026-10-02T05:31:00+02:00', author: { _id: '7', name: 'Ignacio' } },
    ] } } } }, T0 + 1, 'https://school.test/api/graphql'), { route: 'POST /api/graphql GetConversationMessagesQuery' });
    const e = mailFrom([list, thread]).get(9)!;
    expect([...e.messages.values()].map((m) => [m.id, m.body]).sort()).toEqual([['60', 'please send it'], ['61', 'here']]);
    expect(e.messages.get('61')?.attachments).toEqual([{ id: 5, display_name: 'photo.jpg' }]);
    // Kept in UTC "Z", so they sort with REST messages.
    expect(e.messages.get('61')?.created_at).toBe('2026-10-02T05:32:43Z');
    expect(e.messages.get('60')?.created_at).toBe('2026-10-02T03:31:00Z');
    expect(e.conversation.last_message_at).toBe('2026-10-02T05:32:43Z');
    expect(e.conversation.context_name).toBe('Programming');
  });
});

describe('a restricted course: each assignment read from its own page', () => {
  const at4 = (kind: string, body: unknown, at = T0) => rec(kind, 4, body, at, `https://school.test/courses/4#page:${kind}`);
  // The live school's menu for such a course: Home, Announcements, Grades, People.
  const nav = at4('courseNav', { tabs: ['/courses/4', '/courses/4/announcements', '/courses/4/grades', '/courses/4/users'].map((href) => ({ href, label: href })) });
  const due41 = '2026-11-20T11:15:00+01:00';
  const due41Utc = '2026-11-20T10:15:00Z'; // as the app keeps it: in UTC
  const grades = at4('gradesPage', {
    assignment_groups: [{ id: '40', group_weight: 0, rules: {}, assignments: [{ id: '41', points_possible: 10, due_at: due41, submission_types: ['online_upload'] }, { id: '42', points_possible: 5, due_at: null, submission_types: ['none'] }] }],
    submissions: [{ assignment_id: '41', score: 7, workflow_state: 'graded' }],
    assignments: [{ id: '41', name: 'Ecuaciones', html_url: 'https://school.test/courses/4/assignments/41', assignment_group_id: '40' }, { id: '42', name: '', assignment_group_id: '40' }],
  });
  const rubric = [{ id: 'c1', description: 'Procedimiento', points: 10, ratings: [{ id: 'r1a', description: 'Completo', points: 10 }] }];
  const page41 = (extra: object = {}, at = T0 + 1000) =>
    at4('assignmentPage', { id: '41', course_id: '4', name: 'Ecuaciones (página)', html_url: 'https://school.test/courses/4/assignments/41', description: '<p>Resuelve los ejercicios.</p>', points_possible: 12, rubric, ...extra }, at);
  const page42 = at4('assignmentPage', { id: '42', course_id: '4', name: 'Práctica', html_url: 'https://school.test/courses/4/assignments/42', description: '' });
  const cards = rec('dashboardCards', null, [card('4', 'Álgebra')]);
  const api = (...more: CapturedRecord[]) => createExtensionApi(snap([cards, nav, grades, ...more]));

  it('fills instructions, points and the rubric from the assignment page, keeping the Grades page due date', async () => {
    const a = await api(page41({ points_possible: undefined })).getAssignment(4, 41);
    expect(a).toMatchObject({ id: 41, name: 'Ecuaciones', description: '<p>Resuelve los ejercicios.</p>', points_possible: 10, due_at: due41Utc });
    expect(a.rubric?.map((c) => c.description)).toEqual(['Procedimiento']);
    expect(a.instructions_unknown).toBeUndefined();
    // The list carries the same, from the page.
    const listed = (await api(page41()).getAssignments(4)).find((x) => x.id === 41);
    expect(listed).toMatchObject({ description: '<p>Resuelve los ejercicios.</p>', due_at: due41Utc, submission: { score: 7 } });
  });

  it('a newer page record beats an older API detail for the instructions, and an older one does not', async () => {
    const detail = (at: number) => rec('assignment', 4, { id: '41', name: 'Ecuaciones', description: '<p>From the API</p>', due_at: '2026-11-20T10:15:00Z' }, at, 'https://school.test/api/v1/courses/4/assignments/41');
    const newerPage = await api(detail(T0), page41({}, T0 + 5000)).getAssignment(4, 41);
    expect(newerPage.description).toBe('<p>Resuelve los ejercicios.</p>');
    expect(newerPage.due_at).toBe('2026-11-20T10:15:00Z'); // the page never carries a date
    const olderPage = await api(detail(T0 + 5000), page41({}, T0)).getAssignment(4, 41);
    expect(olderPage.description).toBe('<p>From the API</p>');
    expect(olderPage.rubric?.[0].id).toBe('c1'); // the API's detail had no rubric: the page's fills it
  });

  it('page title and points only fill gaps (the Grades page values stay); a row with no name gets the page title', async () => {
    const s = api(page41(), page42);
    const a = await s.getAssignment(4, 41);
    expect(a.name).toBe('Ecuaciones');
    expect(a.points_possible).toBe(10);
    const groups = await s.getAssignmentGroups(4);
    expect(groups[0].assignments?.map((x) => x.name)).toEqual(['Ecuaciones', 'Práctica']);
    // Without its page, the unnamed row still gets a placeholder.
    expect((await api().getAssignmentGroups(4))[0].assignments?.[1].name).toBe('Assignment 42');
  });

  it('lists an assignment only its page knows about, due date from planner items, outside the grade', async () => {
    const page43 = at4('assignmentPage', { id: '43', course_id: '4', name: 'Repaso', html_url: 'https://school.test/courses/4/assignments/43', points_possible: 100 });
    const planner = rec('plannerItems', null, [{ plannable_type: 'assignment', plannable_id: '43', course_id: '4', plannable: { title: 'Repaso', due_at: '2026-12-01T09:00:00Z' } }], T0, 'https://school.test/api/v1/planner/items');
    const s = api(page43, planner);
    const listed = await s.getAssignments(4);
    expect(listed.map((x) => x.id)).toEqual([41, 43, 42]); // by due date, undated last
    expect(listed.find((x) => x.id === 43)).toEqual({ id: 43, course_id: 4, name: 'Repaso', html_url: 'https://school.test/courses/4/assignments/43', points_possible: 100, due_at: '2026-12-01T09:00:00Z' });
    expect((await s.getAssignmentGroups(4)).flatMap((g) => g.assignments?.map((x) => x.id))).toEqual([41, 42]);
    const grade = (await s.getCourse(4)).enrollments?.find((e) => e.type === 'student')?.computed_current_score;
    expect(grade).toBeCloseTo(70); // 7 of 10; the 100 points of the page-only assignment are not counted
    expect(await s.getAssignment(4, 43)).toMatchObject({ name: 'Repaso', points_possible: 100 });
    expect((await s.getAssignment(4, 43)).instructions_unknown).toBe(true); // its page had no instructions element
  });

  it('says instructions are not synced (not "none") until a source carried them; an empty description reads as none', async () => {
    const before = await api().getAssignment(4, 41);
    expect(before.description).toBeUndefined();
    expect(before.instructions_unknown).toBe(true);
    const empty = await api(page42).getAssignment(4, 42);
    expect(empty.description).toBe('');
    expect(empty.instructions_unknown).toBeUndefined();
    // An API detail that says "none" (null) is an answer too.
    const none = await api(rec('assignment', 4, { id: '41', name: 'Ecuaciones', description: null }, T0, 'https://school.test/api/v1/courses/4/assignments/41')).getAssignment(4, 41);
    expect(none.instructions_unknown).toBeUndefined();
  });

  it('instructions dropped for a link that works without a login are known to exist, not "not synced yet"', async () => {
    // As stored after stripSensitive: the description is gone and a marker stands in its place.
    const stripped = at4('assignmentPage', { id: '41', course_id: '4', name: 'Ecuaciones', html_url: 'https://school.test/courses/4/assignments/41', description_removed: true }, T0 + 1000);
    const a = await api(stripped).getAssignment(4, 41);
    expect(a.description).toBeUndefined();
    expect(a.description_removed).toBe(true);
    expect(a.instructions_unknown).toBeUndefined();
    // Another source that kept the instructions wins, and the marker goes.
    const detail = rec('assignment', 4, { id: '41', name: 'Ecuaciones', description: '<p>From the API</p>' }, T0, 'https://school.test/api/v1/courses/4/assignments/41');
    const kept = await api(detail, stripped).getAssignment(4, 41);
    expect(kept.description).toBe('<p>From the API</p>');
    expect(kept.description_removed).toBeUndefined();
  });

  it('counts assignment pages as assignments data in the freshness chip', () => {
    const s = snap([cards, nav, page41({}, T0 + 7000)]);
    expect(freshnessByType(s, 4, T0 + 8000).find((f) => f.key === 'assignments')).toMatchObject({ updatedAt: T0 + 7000 });
    expect(freshnessByType(s, 4, T0 + 8000).find((f) => f.key === 'assignments')?.hidden).toBeUndefined();
  });

  it('discussions: an opened page (listPage) means none; a redirect leaves the hidden note; visited alone counts only when the menu shows the tab', async () => {
    const visited = { 'https://school.test/courses/4/discussion_topics': T0, 'https://school.test/courses/4/announcements': T0 };
    // Opened, and the landed page was the list: no discussions.
    const opened = createExtensionApi({ ...snap([cards, nav, at4('listPage', { path: 'discussion_topics' })]), visited });
    expect(await opened.getDiscussions(4)).toEqual([]);
    // Asked for, but Canvas redirected to the course home (no listPage): the menu leaves it out, so it is hidden.
    const redirected = createExtensionApi({ ...snap([cards, nav]), visited });
    await expect(redirected.getDiscussions(4)).rejects.toMatchObject({ kind: 'hidden' });
    // The menu shows Announcements: having opened it is enough (its list sends nothing when empty).
    expect(await redirected.getAnnouncements(4)).toEqual([]);
    // No menu captured: nothing is assumed hidden, so a visit still counts.
    expect(await createExtensionApi({ ...snap([cards]), visited }).getDiscussions(4)).toEqual([]);
  });
});

describe('values that do not add up', () => {
  const at9 = (kind: string, body: unknown, at = T0) => rec(kind, 9, body, at, `https://school.test/courses/9#page:${kind}`);
  const cards9 = rec('dashboardCards', null, [card('9', 'Calculus')]);
  const gradesPage = (assignments: object[], extra: object = {}, at = T0) =>
    at9('gradesPage', {
      assignment_groups: [{ id: '90', group_weight: 0, rules: {}, assignments }],
      submissions: [],
      assignments: assignments.map((a) => ({ id: (a as { id: string }).id, name: `Set ${(a as { id: string }).id}`, assignment_group_id: '90' })),
      ...extra,
    }, at);

  it('a Grades-page due date with an offset is shown in UTC and sorts with the API\'s dates', async () => {
    const fromApi = rec('assignments', 9, [{ id: '700', name: 'From the API', due_at: '2026-11-20T10:30:00Z', points_possible: 10 }]);
    // 11:15 in Madrid is 10:15 UTC: before the API's 10:30 UTC, though "11:15" sorts after "10:30" as text.
    const api = createExtensionApi(snap([cards9, fromApi, gradesPage([{ id: '701', points_possible: 10, due_at: '2026-11-20T11:15:00+01:00' }])]));
    const list = await api.getAssignments(9);
    expect(list.map((a) => [a.id, a.due_at])).toEqual([[701, '2026-11-20T10:15:00Z'], [700, '2026-11-20T10:30:00Z']]);
    expect(valueIssues(snap([cards9, fromApi]))).toEqual([]);
  });

  it('a due date the Grades page could not give is taken from planner items', async () => {
    const planner = rec('plannerItems', null, [{ plannable_type: 'assignment', plannable_id: '701', course_id: '9', plannable: { title: 'Set 701', due_at: '2026-11-20T10:15:00Z', created_at: '2026-10-01T08:00:00+02:00' } }]);
    const s = snap([cards9, planner, gradesPage([{ id: '701', points_possible: 10, due_at: '2026-11-20T11:15:00' }])]);
    const [a] = await createExtensionApi(s).getAssignments(9);
    expect(a).toMatchObject({ id: 701, due_at: '2026-11-20T10:15:00Z', created_at: '2026-10-01T06:00:00Z' });
    expect(valueIssues(s)).toEqual([{ kind: 'date', courseId: 9, itemId: 701, item: 'Set 701', field: 'due_at', value: '2026-11-20T11:15:00', reason: 'no time zone' }]);
  });

  it('valueIssues lists dropped statistics and unreadable dates for working courses only, once each', () => {
    const misread = { min: 0, lower_q: 375, median: 688, upper_q: 956, max: 1000, mean: 617 };
    const withStats = (stats: object, at: number) => {
      const r = gradesPage([{ id: '701', points_possible: 10, due_at: '20 de oct' }], {}, at);
      (r.body as { assignments: { score_statistics?: object }[] }).assignments[0].score_statistics = stats;
      return r;
    };
    // An older capture misread a score too; the newest one did not: only what the newest capture says is listed.
    const older = gradesPage([{ id: '702', points_possible: 'diez', due_at: null }], {}, T0 - 1000);
    const otherCourse = rec('gradesPage', 8, (gradesPage([{ id: '801', points_possible: 10, due_at: 'mañana' }]).body), T0, 'https://school.test/courses/8#page:gradesPage');
    const s = snap([cards9, rec('course', 8, { id: 8, name: 'Not pinned' }), older, withStats(misread, T0), otherCourse]);
    const issues = valueIssues(s);
    expect(issues.map((i) => [i.kind, i.courseId, i.itemId, i.field])).toEqual([
      ['date', 9, 701, 'due_at'],
      ['statistics', 9, 701, 'score_statistics'],
    ]);
    expect(valueIssues(s)).toBe(issues); // worked out once per snapshot
  });

  it('an object of another kind with the same id never fills an assignment', async () => {
    const other = (body: unknown) => Object.assign(rec('other', 9, body), { route: 'POST /api/graphql Something' });
    const s = snap([
      cards9,
      gradesPage([{ id: '41', points_possible: 10, due_at: null }]),
      other({ data: { user: { _id: '41', name: 'Ana', sortable_name: 'Ana', description: '<p>About me</p>' } } }),
      other({ data: { module: { id: '41', name: 'Unit 1', items_count: 2, description: '<p>Unit text</p>' } } }),
      other({ data: { assignment: { _id: '41', name: 'Elsewhere', description: '<p>Other course</p>', htmlUrl: 'https://school.test/courses/8/assignments/41' } } }),
    ]);
    const a = await createExtensionApi(s).getAssignment(9, 41);
    expect(a.name).toBe('Set 41');
    expect(a.description).toBeUndefined();
    expect(a.instructions_unknown).toBe(true);
  });

  it('announcements for course 17 do not pick up course 174293\'s list', async () => {
    const list = rec('announcements', null, [{ id: '1', title: 'Bienvenidos', context_code: 'course_174293', posted_at: '2026-10-01T10:00:00+02:00' }], T0, 'https://school.test/api/v1/announcements?context_codes[]=course_174293');
    const api = createExtensionApi(snap([list]));
    await expect(api.getAnnouncements(17)).rejects.toMatchObject({ kind: 'not_found' });
    expect((await api.getAnnouncements(174293)).map((x) => [x.title, x.posted_at])).toEqual([['Bienvenidos', '2026-10-01T08:00:00Z']]);
  });

  it('uses Canvas\'s own total from the Grades page (no grading periods) instead of an estimate', async () => {
    const page = (extra: object) => {
      const r = gradesPage([{ id: '701', points_possible: 10, due_at: null }], extra);
      (r.body as { submissions: object[] }).submissions = [{ assignment_id: '701', score: 7 }];
      return r;
    };
    const own = (await createExtensionApi(snap([cards9, page({ canvas_total: 72.5 })])).getCourse(9)).enrollments?.find((e) => e.type === 'student');
    expect(own).toMatchObject({ computed_current_score: 72.5 });
    expect(own?.estimated).toBeUndefined();
    expect(own?.computed_final_score).toBeUndefined();
    // A page showing one grading period shows that period's total, not the course's: worked out instead.
    const period = (await createExtensionApi(snap([cards9, page({ canvas_total: 72.5, grading_period_id: '12' })])).getCourse(9)).enrollments?.find((e) => e.type === 'student');
    expect(period).toMatchObject({ computed_current_score: 70, estimated: true });
    // "All grading periods" (0) shows the course's whole total: Canvas's own.
    const all = (await createExtensionApi(snap([cards9, page({ canvas_total: 72.5, grading_period_id: '0' })])).getCourse(9)).enrollments?.find((e) => e.type === 'student');
    expect(all).toMatchObject({ computed_current_score: 72.5 });
    expect(all?.estimated).toBeUndefined();
  });

  it('does not use the Grades page\'s total once a newer score was captured (it would be stale)', async () => {
    const page = gradesPage([{ id: '701', points_possible: 10, due_at: null }], { canvas_total: 80 });
    (page.body as { submissions: object[] }).submissions = [{ assignment_id: '701', score: 8 }];
    const enrollmentWith = async (records: CapturedRecord[]) => (await createExtensionApi(snap([cards9, page, ...records])).getCourse(9)).enrollments?.find((e) => e.type === 'student');
    // A day later the student's score came in through the submissions list: 2/10.
    const newer = rec('courseSubmissions', 9, [{ id: 's701', assignment_id: '701', workflow_state: 'graded', score: 2 }], T0 + 86400e3);
    expect(await enrollmentWith([newer])).toMatchObject({ computed_current_score: 20, estimated: true });
    // Or through gradebook groups that carry the submission.
    const groups = rec('assignmentGroups', 9, [{ id: '90', name: 'G', group_weight: 0, assignments: [{ id: '701', points_possible: 10, submission: { assignment_id: '701', score: 2 } }] }], T0 + 86400e3);
    expect(await enrollmentWith([groups])).toMatchObject({ estimated: true });
    // Groups without submissions say nothing about scores: Canvas's total still stands.
    const bare = rec('assignmentGroups', 9, [{ id: '90', name: 'G', group_weight: 0, assignments: [{ id: '701', points_possible: 10 }] }], T0 + 86400e3);
    expect(await enrollmentWith([bare])).toMatchObject({ computed_current_score: 80 });
    // A score captured before the Grades page is older than its total.
    const older = rec('courseSubmissions', 9, [{ id: 's701', assignment_id: '701', workflow_state: 'graded', score: 2 }], T0 - 86400e3);
    expect((await enrollmentWith([older]))?.estimated).toBeUndefined();
  });

  it('marks a worked-out grade as an estimate', async () => {
    const api = createExtensionApi(snap(base));
    const enrollment = (await api.getCourse(1)).enrollments?.find((e) => e.type === 'student');
    const model = toModel(await api.getAssignmentGroups(1));
    const expected = computeGrade(model.groups, model.items, { weighted: false });
    expect(enrollment).toMatchObject({ estimated: true, computed_current_score: expected.current, computed_final_score: expected.final });
  });

  it('takes the weighting from the Grades page when the course record does not say', async () => {
    const page = (scheme: string, course: CapturedRecord[] = []) => {
      const r = at9('gradesPage', {
        assignment_groups: [
          { id: '90', group_weight: 75, rules: {}, assignments: [{ id: '701', points_possible: 10 }] },
          { id: '91', group_weight: 25, rules: {}, assignments: [{ id: '702', points_possible: 10 }] },
        ],
        submissions: [{ assignment_id: '701', score: 10 }, { assignment_id: '702', score: 0 }],
        assignments: [],
        group_weighting_scheme: scheme,
      });
      return createExtensionApi(snap([cards9, ...course, r])).getCourse(9);
    };
    expect(await page('percent')).toMatchObject({ apply_assignment_group_weights: true, enrollments: [{ computed_current_score: 75 }] });
    expect(await page('equal')).toMatchObject({ apply_assignment_group_weights: false, enrollments: [{ computed_current_score: 50 }] });
    // The course record's own flag wins.
    expect(await page('percent', [rec('course', 9, { id: 9, name: 'Calculus', apply_assignment_group_weights: false })])).toMatchObject({ apply_assignment_group_weights: false });
  });

  it('names the term from a term object before the dashboard card', async () => {
    const cardFall = rec('dashboardCards', null, [{ ...card('9', 'Calculus'), term: 'Fall' }]);
    const course = rec('course', 9, { id: 9, name: 'Calculus' });
    const list = rec('userCourses', null, [{ id: '9', name: 'Calculus', term: { id: '3', name: '2026-27 First semester' } }]);
    const gql = rec('GetUserCourses', null, { data: { legacyNode: { enrollments: [{ concluded: false, course: { _id: '9', contextName: 'Calculus', term: { name: 'Primer semestre' } } }] } } });
    const termOf = async (records: CapturedRecord[]) => (await createExtensionApi(snap(records)).getCourse(9)).term?.name;
    expect(await termOf([cardFall, course, list, gql])).toBe('2026-27 First semester');
    expect(await termOf([cardFall, course, gql])).toBe('Primer semestre');
    expect(await termOf([cardFall, course])).toBe('Fall');
  });

  it('an unreadable rubric on an assignment page is listed', () => {
    const page = (extra: object, at = T0) => at9('assignmentPage', { id: '41', course_id: '9', name: 'Informe', html_url: 'https://school.test/courses/9/assignments/41', ...extra }, at);
    expect(valueIssues(snap([cards9, page({ rubric_unreadable: true })]))).toEqual([{ kind: 'rubric', courseId: 9, itemId: 41, item: 'Informe', field: 'rubric', value: null, reason: 'unreadable' }]);
    // Read again later, and readable this time: nothing to list.
    expect(valueIssues(snap([cards9, page({ rubric_unreadable: true }), page({}, T0 + 1000)]))).toEqual([]);
  });
});

describe('responses that failed their shape check are kept aside, not used', () => {
  const cards9 = rec('dashboardCards', null, [card('9', 'Calculus')]);
  const groups = rec('assignmentGroups', 9, [{ id: '90', name: 'G', group_weight: 0, assignments: [{ id: '701', name: 'Set 701', points_possible: 10, course_id: '9' }] }]);
  const rejected = (body: unknown, route: string, rejectedAs: string) =>
    Object.assign(rec('other', 9, body, T0 + 1000, 'https://school.test/api/v1/courses/9/assignments/701'), { route, rejectedAs });

  it('no field of an assignment is filled from a rejected body found by its id', async () => {
    const odd = rejected({ id: '701', name: 'Renamed', course_id: '9', description: '<p>From the rejected body</p>', due_at: '2026-11-20T10:15:00Z', unusual: true }, 'GET /courses/:id/assignments/:id', 'assignment');
    const a = await createExtensionApi(snap([cards9, groups, odd])).getAssignment(9, 701);
    expect(a.name).toBe('Set 701');
    expect(a.description).toBeUndefined();
    expect(a.due_at).toBeUndefined();
    // The same body, accepted as an ordinary (unread) response, would have filled them.
    const plain = Object.assign(rec('other', 9, odd.body, T0 + 1000, odd.url), { route: odd.route });
    expect((await createExtensionApi(snap([cards9, groups, plain])).getAssignment(9, 701)).description).toBe('<p>From the rejected body</p>');
  });

  it('nor are people read from a rejected class list', async () => {
    const people = rejected([{ id: '5', name: 'Zoe Prof', enrollments: [{ type: 'TeacherEnrollment' }] }], 'GET /courses/:id/users', 'enrollments');
    expect(await createExtensionApi(snap([cards9, people])).getCourseRecipients(9)).toEqual([]);
  });
});
