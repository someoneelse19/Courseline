import { beforeEach, describe, expect, it } from 'vitest';
import type { Submission } from '../api/types';
import { isUnseenFeedback, latestFeedback, markFeedbackSeen, newFeedbackFromCanvas, readFeedbackStore, resetFeedbackSeen, startFeedbackRecord } from './feedback';

beforeEach(() => {
  localStorage.clear();
  resetFeedbackSeen();
});

const ms = (iso: string) => Date.parse(iso);
const ME = 1;
const sub = (over: Partial<Submission> = {}): Submission => ({ workflow_state: 'graded', score: 8, graded_at: '2026-11-10T10:00:00Z', ...over });
const comment = (id: number, author_id: number, created_at: string) => ({ id, author_id, author_name: 'x', comment: 'hi', created_at });

describe('latestFeedback', () => {
  it('is the newest of the grade and the comments from someone else; my own comments do not count', () => {
    const s = sub({ submission_comments: [comment(1, 9, '2026-11-12T00:00:00Z'), comment(2, ME, '2026-11-15T00:00:00Z')] });
    expect(latestFeedback(s, ME)).toBe(ms('2026-11-12T00:00:00Z'));
  });

  it('a submission without a grade has no grade time; nothing at all is NaN', () => {
    expect(latestFeedback(sub({ score: null, grade: null }), ME)).toBeNaN();
    expect(latestFeedback(undefined, ME)).toBeNaN();
  });
});

describe('isUnseenFeedback', () => {
  it('nothing is unseen until the course record starts, and feedback from before the start was already there', () => {
    expect(isUnseenFeedback(7, 5, ms('2026-11-10T00:00:00Z'), readFeedbackStore())).toBe(false);
    startFeedbackRecord([7], ms('2026-11-11T00:00:00Z'));
    expect(isUnseenFeedback(7, 5, ms('2026-11-10T00:00:00Z'), readFeedbackStore())).toBe(false);
    expect(isUnseenFeedback(7, 5, ms('2026-11-12T00:00:00Z'), readFeedbackStore())).toBe(true);
  });

  it('opening the assignment marks its feedback seen; newer feedback is unseen again', () => {
    startFeedbackRecord([7], ms('2026-11-01T00:00:00Z'));
    markFeedbackSeen(7, 5, ms('2026-11-12T00:00:00Z'));
    expect(isUnseenFeedback(7, 5, ms('2026-11-12T00:00:00Z'), readFeedbackStore())).toBe(false);
    expect(isUnseenFeedback(7, 5, ms('2026-11-13T00:00:00Z'), readFeedbackStore())).toBe(true);
    expect(isUnseenFeedback(7, 6, ms('2026-11-12T00:00:00Z'), readFeedbackStore())).toBe(true);
  });

  it('marking never moves backwards, and starting a course twice keeps its first start', () => {
    markFeedbackSeen(7, 5, ms('2026-11-12T00:00:00Z'), ms('2026-11-01T00:00:00Z'));
    markFeedbackSeen(7, 5, ms('2026-11-10T00:00:00Z'));
    startFeedbackRecord([7], ms('2026-11-20T00:00:00Z'));
    expect(readFeedbackStore()).toEqual({ since: { 7: ms('2026-11-01T00:00:00Z') }, seen: { '7:5': ms('2026-11-12T00:00:00Z') } });
  });

  it('is kept in storage, and survives a broken value there', () => {
    markFeedbackSeen(7, 5, 2, 1);
    resetFeedbackSeen();
    expect(isUnseenFeedback(7, 5, 2, readFeedbackStore())).toBe(false);
    expect(isUnseenFeedback(7, 5, 3, readFeedbackStore())).toBe(true);
    localStorage.setItem('courseline.feedbackSeen', '{not json');
    resetFeedbackSeen();
    expect(readFeedbackStore()).toEqual({ since: {}, seen: {} });
  });
});

describe('newFeedbackFromCanvas', () => {
  const s = sub({ graded_at: '2026-11-10T10:00:00Z', submission_comments: [comment(1, 9, '2026-11-09T00:00:00Z'), comment(2, ME, '2026-11-11T00:00:00Z'), comment(3, 9, '2026-11-12T00:00:00Z')] });

  it('nothing is new when Canvas has the submission read', () => {
    const out = newFeedbackFromCanvas(s, ME, { unread: false, unreadComments: 0 });
    expect(out.grade).toBe(false);
    expect([...out.commentIds]).toEqual([]);
  });

  it('the unread comments are the newest from others; the grade is new unless it is older than them', () => {
    const one = newFeedbackFromCanvas(s, ME, { unread: true, unreadComments: 1 });
    expect([...one.commentIds]).toEqual([3]);
    expect(one.grade).toBe(false); // graded on the 10th, the new comment came on the 12th
    const two = newFeedbackFromCanvas(s, ME, { unread: true, unreadComments: 2 });
    expect([...two.commentIds].sort()).toEqual([1, 3]);
    expect(two.grade).toBe(true); // the grade came after the oldest new comment
  });

  it('unread with no unread comments: the grade is what is new', () => {
    expect(newFeedbackFromCanvas(s, ME, { unread: true, unreadComments: 0 })).toEqual({ grade: true, commentIds: new Set() });
    expect(newFeedbackFromCanvas(sub({ score: null, grade: null }), ME, { unread: true, unreadComments: 0 }).grade).toBe(false);
  });
});
