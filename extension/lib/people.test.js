import { describe, expect, it } from 'vitest';
import { PEOPLE_COMPLETE, cleanCourseId, isPeopleKey, isPeoplePage, peopleRecords, slimPerson } from './people.js';

const HOST = 'school.test';
const page = (url, body) => ({ url, body });

describe('class list pages', () => {
  it('only this course\'s users API on this Canvas, over https', () => {
    expect(isPeoplePage('https://school.test/api/v1/courses/9/users?page=bookmark:x&per_page=100', HOST, 9)).toBe(true);
    expect(isPeoplePage('https://school.test/api/v1/courses/8/users', HOST, 9)).toBe(false);
    expect(isPeoplePage('https://evil.test/api/v1/courses/9/users', HOST, 9)).toBe(false);
    expect(isPeoplePage('http://school.test/api/v1/courses/9/users', HOST, 9)).toBe(false);
    expect(isPeoplePage('https://school.test/api/v1/courses/9/users/5', HOST, 9)).toBe(false);
  });

  it('knows which saved records hold that list', () => {
    expect(isPeopleKey('cap:school.test/courses/9/users?enrollment_type[]=student&page=2', HOST, 9)).toBe(true);
    expect(isPeopleKey('cap:rejected:school.test/courses/9/users?x=1', HOST, 9)).toBe(true);
    expect(isPeopleKey('cap:school.test/courses/90/users?x=1', HOST, 9)).toBe(false);
    expect(isPeopleKey('cap:school.test/courses/9#peopleComplete', HOST, 9)).toBe(false);
  });

  it('course ids are positive whole numbers', () => {
    expect(cleanCourseId(9)).toBe(9);
    expect([cleanCourseId(0), cleanCourseId('9'), cleanCourseId(1.5)]).toEqual([null, null, null]);
  });
});

describe('peopleRecords', () => {
  it('saves each page trimmed to names and roles, and a marker with the count', () => {
    const student = { id: 7, name: 'Ana', sortable_name: 'Ana', email: 'ana@school.test', login_id: 'x1', avatar_url: 'https://a', enrollments: [{ type: 'StudentEnrollment', role: 'StudentEnrollment', grades: { current_score: 91 } }] };
    const out = peopleRecords(HOST, 9, [page('https://school.test/api/v1/courses/9/users?per_page=100', [student]), page('https://school.test/api/v1/courses/9/users?page=2', [{ id: 8, name: 'Bo', enrollments: [] }])], 100);
    expect(out.count).toBe(2);
    const first = out.records['cap:school.test/courses/9/users?courseline_everyone=0'];
    expect(first).toMatchObject({ kind: 'other', route: 'GET /courses/:id/users', courseId: 9, capturedAt: 100 });
    expect(first.body).toEqual([{ id: 7, name: 'Ana', sortable_name: 'Ana', enrollments: [{ type: 'StudentEnrollment', role: 'StudentEnrollment' }] }]);
    expect(out.records[`cap:school.test/courses/9#${PEOPLE_COMPLETE}`]).toMatchObject({ kind: PEOPLE_COMPLETE, courseId: 9, body: { count: 2, pages: 2 } });
  });

  it('saves nothing when any page is not this course\'s list', () => {
    expect(peopleRecords(HOST, 9, [page('https://school.test/api/v1/courses/8/users', [])], 1)).toBeNull();
    expect(peopleRecords(HOST, 9, [page('https://school.test/api/v1/courses/9/users', { not: 'a list' })], 1)).toBeNull();
    expect(peopleRecords(HOST, 9, [], 1)).toBeNull();
  });
});

describe('slimPerson', () => {
  it('keeps who and what role, nothing else', () => {
    expect(slimPerson({ id: 1, name: 'A', email: 'a@x', enrollments: [{ type: 'TaEnrollment', grades: {} }] })).toEqual({ id: 1, name: 'A', sortable_name: undefined, short_name: undefined, enrollments: [{ type: 'TaEnrollment', role: undefined }] });
    expect(slimPerson(null)).toBeNull();
  });
});
