import { describe, expect, it } from 'vitest';
import { classify, cleanPinnedIds, expiredKeys, keepCourse, keysToClear, sameOrigin, stripSensitive } from './capture.js';

const base = 'https://school.instructure.com/api/v1';

describe('classify', () => {
  it('recognises a course list and checks its shape', () => {
    const r = classify(`${base}/courses?enrollment_state=active`, [{ id: 1, name: 'Bio' }]);
    expect(r).toMatchObject({ kind: 'courses', courseId: null, shapeOk: true, host: 'school.instructure.com' });
  });

  it('pulls the course id out of nested routes', () => {
    expect(classify(`${base}/courses/42/assignments`, [])).toMatchObject({ kind: 'assignments', courseId: 42, shapeOk: true });
    expect(classify(`${base}/courses/42/modules/7/items`, [{ id: 1 }])).toMatchObject({ kind: 'moduleItems', courseId: 42 });
  });

  it('flags a known route whose shape changed instead of trusting it', () => {
    expect(classify(`${base}/courses/42/assignments`, { error: 'gone' })).toMatchObject({ kind: 'assignments', shapeOk: false });
    expect(classify(`${base}/courses/42/assignments/5`, { id: 5 })).toMatchObject({ kind: 'assignment', shapeOk: false });
  });

  it('recognises the other endpoints Canvas pages use', () => {
    expect(classify(`${base}/dashboard/dashboard_cards`, [{ id: 1 }])).toMatchObject({ kind: 'dashboardCards', shapeOk: true });
    expect(classify(`${base}/courses/9/discussion_topics`, [])).toMatchObject({ kind: 'discussions', courseId: 9 });
    expect(classify(`${base}/users/self/colors`, { custom_colors: {} })).toMatchObject({ kind: 'colors', shapeOk: true });
    expect(classify(`${base}/courses/9/front_page`, { url: 'home' })).toMatchObject({ kind: 'frontPage', courseId: 9 });
  });

  it('notes unread API addresses by shape only, with ids and query stripped', () => {
    expect(classify(`${base}/conversations/12345/messages`, [])).toMatchObject({ kind: null, unmapped: 'GET /conversations/:id/messages', courseId: null });
    expect(classify('https://school.instructure.com/api/graphql', {})).toMatchObject({ kind: null, unmapped: 'POST /api/graphql' });
    // The course id still comes through, so the pinned-course filter applies to addresses with no reader too.
    expect(classify(`${base}/courses/42/some_new_thing`, [])).toMatchObject({ kind: null, unmapped: 'GET /courses/:id/some_new_thing', courseId: 42 });
  });

  it('tells GraphQL calls apart by operation name, accepting only plain names', () => {
    const url = 'https://school.instructure.com/api/graphql';
    expect(classify(url, {}, 'CourseWorkQuery,Other')).toMatchObject({ kind: null, unmapped: 'POST /api/graphql CourseWorkQuery,Other' });
    expect(classify(url, {}, '<script>')).toMatchObject({ kind: null, unmapped: 'POST /api/graphql' });
    // Unnamed calls get a key from the shape of the answer, so different ones do not overwrite each other.
    const a = classify(url, { data: { user: {} } }, undefined, {});
    const b = classify(url, { data: { course: {} } }, undefined, {});
    expect(a.key).not.toBe(b.key);
  });

  it('reads whitelisted GraphQL operations, keyed by operation and variables, with the course id from them', () => {
    const url = 'https://school.instructure.com/api/graphql';
    const a = classify(url, { data: { x: 1 } }, 'GetCourseInstructorsPaginated', { courseId: '42', first: 10 });
    const b = classify(url, { data: { x: 1 } }, 'GetCourseInstructorsPaginated', { first: 10, courseId: '43' });
    expect(a).toMatchObject({ kind: 'GetCourseInstructorsPaginated', courseId: 42, shapeOk: true });
    expect(b.courseId).toBe(43);
    expect(a.key).not.toBe(b.key);
    expect(classify(url, { data: { x: 1 } }, 'GetUserCourseWork', {})).toMatchObject({ courseId: null, shapeOk: true });
  });

  it('flags a GraphQL answer with errors or no data, and saves an unread operation as "other"', () => {
    const url = 'https://school.instructure.com/api/graphql';
    expect(classify(url, { errors: [{ message: 'x' }] }, 'GetUserCourseWork', {}).shapeOk).toBe(false);
    expect(classify(url, { data: {}, errors: [{}] }, 'GetUserCourseWork', {}).shapeOk).toBe(false);
    expect(classify(url, { data: {} }, 'UpdateLearnerDashboardTabSelection', {})).toMatchObject({ kind: null, unmapped: 'POST /api/graphql UpdateLearnerDashboardTabSelection' });
  });

  it('reads the REST course list and never lists the token endpoint', () => {
    expect(classify(`${base}/users/self/courses?include[]=term`, [{ id: 1 }])).toMatchObject({ kind: 'userCourses', shapeOk: true });
  });

  it('keeps housekeeping reads, and never anything that carries credentials', () => {
    expect(classify(`${base}/release_notes/unread_count`, {})).toMatchObject({ kind: null });
    expect(classify(`${base}/users/5/settings`, {})).toMatchObject({ kind: null });
    expect(classify(`${base}/jwts`, { token: 'x' })).toBeNull();
    expect(classify(`${base}/users/self/tokens`, [])).toBeNull();
    expect(classify(`${base}/login/session_token`, {})).toBeNull();
  });

  it('gives every recognised route its address shape too, for keeping a response whose format did not match', () => {
    expect(classify(`${base}/courses/42/assignments/5`, {})).toMatchObject({ kind: 'assignment', route: 'GET /courses/:id/assignments/:id' });
    expect(classify('https://school.instructure.com/api/graphql', { data: {} }, 'GetUserCourses', {})).toMatchObject({ route: 'POST /api/graphql GetUserCourses' });
  });

  it('ignores non-API URLs', () => {
    expect(classify('https://school.instructure.com/courses/42', {})).toBeNull();
    expect(classify('not a url', {})).toBeNull();
  });

  it('keys identically regardless of query order, differently per page', () => {
    const a = classify(`${base}/courses?include[]=term&page=2`, []);
    const b = classify(`${base}/courses?page=2&include[]=term`, []);
    const c = classify(`${base}/courses?include[]=term&page=3`, []);
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });
});

describe('stripSensitive credentials', () => {
  it('removes token fields inside ordinary responses', () => {
    expect(stripSensitive({ name: 'x', token: 'abc', nested: { access_token: 'd', ok: 1 } })).toEqual({ name: 'x', nested: { ok: 1 } });
  });
});

describe('keepCourse', () => {
  it('keeps everything until the pinned set is known, then only pinned courses', () => {
    expect(keepCourse(5, undefined)).toBe(true);
    expect(keepCourse(5, [1, 2])).toBe(false);
    expect(keepCourse(1, [1, 2])).toBe(true);
    expect(keepCourse(null, [1, 2])).toBe(true); // not about one course
  });
});

describe('sameOrigin', () => {
  it('accepts a response whose URL is on the sending page, and nothing else', () => {
    expect(sameOrigin('https://school.test/api/v1/courses', 'https://school.test/courses/1')).toBe(true);
    expect(sameOrigin('https://evil.test/api/v1/courses', 'https://school.test/courses/1')).toBe(false);
    expect(sameOrigin('https://school.test/api/v1/courses', undefined)).toBe(false);
    expect(sameOrigin('not a url', 'https://school.test/')).toBe(false);
  });
});

describe('stripSensitive', () => {
  it('removes email, login and avatar fields at any depth and leaves the rest', () => {
    const out = stripSensitive({ data: { legacyNode: { email: 'a@b.c', id: '1', enrollments: [{ course: { _id: '2' }, primary_email: 'x', avatarUrl: 'u' }] } }, name: 'Bio' });
    expect(out).toEqual({ data: { legacyNode: { id: '1', enrollments: [{ course: { _id: '2' }, }] } }, name: 'Bio' });
    expect(JSON.stringify(out)).not.toMatch(/a@b|avatar|primary_email/);
  });
});

describe('expiredKeys', () => {
  it('lists only saved responses older than the limit', () => {
    const now = 1_000_000_000_000;
    const day = 86400e3;
    const keys = expiredKeys({ 'cap:old': { capturedAt: now - 100 * day }, 'cap:new': { capturedAt: now - 5 * day }, health: {}, 'cap:odd': {} }, now);
    expect(keys).toEqual(['cap:old']);
  });
});

describe('cleanPinnedIds', () => {
  it('accepts a list of positive whole numbers, de-duplicated, and rejects everything else', () => {
    expect(cleanPinnedIds([1, 2, 2, 3])).toEqual([1, 2, 3]);
    expect(cleanPinnedIds([])).toEqual([]);
    expect(cleanPinnedIds([1, '2'])).toBeNull();
    expect(cleanPinnedIds([0])).toBeNull();
    expect(cleanPinnedIds('1,2')).toBeNull();
    expect(cleanPinnedIds(Array.from({ length: 201 }, (_, i) => i + 1))).toBeNull();
  });
});

describe('capability URLs', () => {
  it('removes calendar feeds and file links that carry a verifier, which work for anyone who has them', () => {
    const out = stripSensitive({
      name: 'Bio',
      calendar: { ics: 'https://school.test/feeds/calendars/course_1_abc.ics' },
      files: [{ display_name: 'a.pdf', url: 'https://school.test/files/9/download?download_frd=1&verifier=SECRET' }],
      html_url: 'https://school.test/courses/1',
    });
    expect(JSON.stringify(out)).not.toMatch(/feeds|verifier|SECRET/);
    expect(out.name).toBe('Bio');
    expect(out.html_url).toBe('https://school.test/courses/1'); // ordinary links stay
    expect(out.files[0].display_name).toBe('a.pdf');
  });
});

describe('keysToClear', () => {
  it('removes captures and what is derived from them, but never the student\'s own settings', () => {
    const keys = keysToClear({ 'cap:a': {}, health: {}, visited: {}, pinned: [1], unmapped: {}, shapes: {}, canvasHost: 'x', appPinned: [2], appOrigin: 'http://localhost:5173' });
    expect(keys.sort()).toEqual(['cap:a', 'health', 'pinned', 'shapes', 'unmapped', 'visited']);
  });
});
