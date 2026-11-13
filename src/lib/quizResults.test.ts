import { describe, expect, it } from 'vitest';
import type { QuizQuestion } from '../api/types';
import { buildQuizResult, tally } from './quizResults';

const mc = (id: number, position: number, extra: Partial<QuizQuestion> = {}): QuizQuestion => ({
  id,
  position,
  question_name: `Q${id}`,
  question_type: 'multiple_choice_question',
  question_text: `<p>What is ${id}?</p>`,
  points_possible: 1,
  answers: [
    { id: 1, text: 'Right' },
    { id: 2, text: 'Wrong' },
  ],
  ...extra,
});

const base = { quizId: 5, assignmentId: 9, title: 'Quiz 1', attempt: 2, score: 1, pointsPossible: 3 };

describe('buildQuizResult', () => {
  it('lines up the questions with the per-question data: right, wrong, partly right, and the answer given', () => {
    const r = buildQuizResult({
      ...base,
      questions: [mc(11, 1), mc(12, 2), { id: 13, position: 3, question_type: 'fill_in_multiple_blanks_question', question_text: '<p>Fill [a]</p>', answers: [{ id: 7, text: 'cell', blank_id: 'a' }] }],
      data: [
        { question_id: 12, correct: false, points: 0, answer_id: 2 },
        { question_id: 11, correct: true, points: 1, answer_id: 1 },
        { question_id: 13, correct: 'partial', points: 0.5, answer_for_a: 'cel', answer_id_for_a: null },
      ],
    });
    expect(r.questions.map((q) => [q.number, q.outcome, q.yourAnswer, q.points])).toEqual([
      [1, 'correct', 'Right', 1],
      [2, 'incorrect', 'Wrong', 0],
      [3, 'partial', 'a: cel', 0.5],
    ]);
    expect(r.questions[0].text).toBe('What is 11?');
    expect(r.note).toBeUndefined();
    expect(tally(r)).toBe('1 of 3 right, 1 partly right');
  });

  it('shows the right answer only when the answers carry weights, and can judge a choice by them', () => {
    const weighted = mc(11, 1, { answer: 2, answers: [{ id: 1, text: 'Right', weight: 100 }, { id: 2, text: 'Wrong', weight: 0 }] });
    const r = buildQuizResult({ ...base, questions: [weighted], data: null });
    expect(r.questions[0]).toMatchObject({ outcome: 'incorrect', yourAnswer: 'Wrong', correctAnswer: 'Right' });
    expect(r.note).toBeUndefined();

    const censored = buildQuizResult({ ...base, questions: [mc(11, 1, { answer: 2 })], data: null });
    expect(censored.questions[0]).toMatchObject({ outcome: 'unknown', yourAnswer: 'Wrong' });
    expect(censored.questions[0].correctAnswer).toBeUndefined();
    expect(censored.note).toMatch(/does not show which answers were right/);
    expect(tally(censored)).toBe('');
  });

  it('works from the per-question data alone, and says when there is nothing', () => {
    const r = buildQuizResult({ ...base, questions: null, data: [{ question_id: 1, correct: true, text: '<p>42</p>' }, { question_id: 2, correct: 'undefined' }] });
    expect(r.questions.map((q) => q.outcome)).toEqual(['correct', 'ungraded']);
    expect(r.questions[0].yourAnswer).toBe('42');
    expect(r.note).toMatch(/does not show the questions/);
    expect(buildQuizResult({ ...base, questions: null, data: null }).note).toMatch(/does not show you the questions or answers/);
  });

  it('reads multiple-answer ticks and matching pairs', () => {
    const multi: QuizQuestion = { id: 1, question_type: 'multiple_answers_question', answers: [{ id: 3, text: 'A' }, { id: 4, text: 'B' }, { id: 5, text: 'C' }] };
    const match: QuizQuestion = { id: 2, question_type: 'matching_question', answers: [{ id: 6, left: 'Dog' }], matches: [{ match_id: 90, text: 'Bark' }] };
    const r = buildQuizResult({ ...base, questions: [multi, match], data: [{ question_id: 1, correct: false, answer_3: '1', answer_4: '0', answer_5: '1' }, { question_id: 2, correct: true, answer_6: '90' }] });
    expect(r.questions.map((q) => q.yourAnswer)).toEqual(['A; C', 'Dog → Bark']);
  });

  it('leaves out text-only items', () => {
    const r = buildQuizResult({ ...base, questions: [{ id: 1, question_type: 'text_only_question', question_text: 'Read this' }, mc(2, 2)], data: [{ question_id: 2, correct: true, answer_id: 1 }] });
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].number).toBe(1);
  });
});
