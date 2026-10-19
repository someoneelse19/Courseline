import { describe, expect, it } from 'vitest';
import { CanvasApiError } from '../api/client';
import type { CapturedRecord, Snapshot } from './bridge';
import { coverage, courseUpdatedAt, createExtensionApi, failingKinds, freshnessByType, knownCourses, lastUpdatedAt, normalizeIds, pinnedIds } from './extensionApi';

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

