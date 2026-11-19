import { beforeEach, describe, expect, it } from 'vitest';
import { isReadHere, markReadHere, resetReadHere, runLimited, submissionKey, topicKey } from './canvasRead';

beforeEach(() => resetReadHere());

describe('what was marked read here', () => {
  it('remembers announcements and submissions by course', () => {
    markReadHere([topicKey(1, 10), submissionKey(1, 5)]);
    expect(isReadHere(topicKey(1, 10))).toBe(true);
    expect(isReadHere(submissionKey(1, 5))).toBe(true);
    expect(isReadHere(topicKey(2, 10))).toBe(false);
    expect(isReadHere(submissionKey(1, 10))).toBe(false); // a topic and an assignment can share an id
  });
});

describe('runLimited', () => {
  it('runs every task, never more than the limit at once, and keeps going past failures', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    const task = (i: number) => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (i === 2) throw new Error('nope');
      done.push(i);
    };
    await runLimited([0, 1, 2, 3, 4, 5, 6].map(task), 3);
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([0, 1, 3, 4, 5, 6]);
  });
});
