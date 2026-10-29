import { describe, expect, it } from 'vitest';
import { attachmentKind, chatName, composeTarget, mergeFolders, linkify, otherPeople, peopleLabel, threadDays } from './messages';

const msg = (id: number, author: number, at: string, body = 'x') => ({ id, author_id: author, created_at: at, body });

describe('threadDays', () => {
  it('orders oldest first, splits by day, and marks runs by one person', () => {
    const days = threadDays(
      [msg(3, 1, '2026-10-02T09:05:00'), msg(1, 2, '2026-10-01T10:00:00'), msg(2, 1, '2026-10-02T09:00:00'), msg(4, 2, '2026-10-02T12:00:00')],
      1,
    );
    expect(days.map((d) => d.day)).toEqual(['2026-10-01', '2026-10-02']);
    expect(days[1].bubbles.map((b) => [b.message.id, b.mine, b.first, b.last])).toEqual([
      [2, true, true, false],
      [3, true, false, true],
      [4, false, true, true],
    ]);
  });
});

describe('people', () => {
  it('leaves the student out, and says who else is there', () => {
    const c = { participants: [{ id: 1, name: 'Me' }, { id: 2, name: 'Ana' }, { id: 3, name: 'Luis' }, { id: 4, name: 'Eva' }] };
    expect(otherPeople(c, 1).map((p) => p.name)).toEqual(['Ana', 'Luis', 'Eva']);
    expect(otherPeople({ participants: [{ id: -1, name: 'Me' }, { id: -2, name: 'Ana' }] }, 9, 'Me').map((p) => p.name)).toEqual(['Ana']);
    expect(peopleLabel(otherPeople(c, 1))).toBe('Ana, Luis and 1 others');
    expect(peopleLabel([{ id: 2, name: 'Ana' }])).toBe('Ana');
  });
});

describe('linkify', () => {
  it('turns http(s) addresses into links and leaves the rest as text', () => {
    expect(linkify('See https://x.test/a?b=1. Thanks')).toEqual([{ text: 'See ' }, { href: 'https://x.test/a?b=1', text: 'https://x.test/a?b=1' }, { text: '. Thanks' }]);
    expect(linkify('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }]);
  });
});

describe('composeTarget', () => {
  it('reads Canvas\'s own compose link', () => {
    expect(composeTarget('?context_id=course_174290&user_id=4390&user_name=SILVIA%20LAVADO')).toEqual({ courseId: 174290, userId: 4390, userName: 'SILVIA LAVADO' });
    expect(composeTarget('?course=5&to=x')).toEqual({ courseId: 5, userId: null, userName: null });
  });
});

describe('chatName', () => {
  it('is the subject, or who it is with when there is none', () => {
    expect(chatName({ subject: ' Pi ' }, [{ id: 2, name: 'Ana' }])).toBe('Pi');
    expect(chatName({ subject: '' }, [{ id: 2, name: 'Ana' }])).toBe('Ana');
    expect(chatName({ subject: null }, [{ id: 2, name: 'Ana' }, { id: 3, name: 'Luis' }])).toBe('Ana and Luis');
  });
});

describe('mergeFolders', () => {
  const c = (id: number, at: string, last: string, state = 'read', people = 1) => ({ id, subject: `S${id}`, workflow_state: state, last_message: last, last_message_at: at, message_count: 1, participants: Array.from({ length: people }, (_, i) => ({ id: i, name: `P${i}` })) });
  it('lists received and sent together, once each, newest first', () => {
    const merged = mergeFolders([c(1, '2026-10-01', 'theirs', 'unread', 2), c(2, '2026-10-05', 'b')], [c(1, '2026-10-03', 'mine'), c(3, '2026-10-04', 'c')]);
    expect(merged.map((x) => x.id)).toEqual([2, 3, 1]);
    expect(merged[2]).toMatchObject({ last_message: 'mine', last_message_at: '2026-10-03', workflow_state: 'unread' });
    expect(merged[2].participants).toHaveLength(2);
  });
});

describe('attachmentKind', () => {
  it('tells images and documents apart from Canvas\'s mime class, the content type, or the name', () => {
    expect(attachmentKind({ display_name: '1790919129.920741.jpg' })).toBe('image');
    expect(attachmentKind({ display_name: 'x', 'content-type': 'image/png' })).toBe('image');
    expect(attachmentKind({ display_name: 'Instructor guide.docx' })).toBe('doc');
    expect(attachmentKind({ display_name: 'Rubric.xlsx' })).toBe('sheet');
    expect(attachmentKind({ display_name: 'Calculat_trig_functions_and_pi.java' })).toBe('code');
    expect(attachmentKind({ display_name: 'notes', mime_class: 'pdf' })).toBe('pdf');
    expect(attachmentKind({ display_name: 'thing.bin' })).toBe('file');
  });
});
