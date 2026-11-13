import type { QuizAnswerData, QuizQuestion } from '../api/types';
import { htmlToMarkdown } from './htmlToMarkdown';

// Question-by-question results of one classic-quiz attempt, for the AI export. Pure: the runner fetches
// the pieces and this lines them up. Canvas spreads them over two places:
//   - the questions (text, the answer options, the student's answer, and, only when the quiz shows the right
//     answers, each option's weight: 100 = right);
//   - the submission's history, whose submission_data says per question whether it was right and the points.
// Either can be missing (schools hide one or both from students); whatever is there is used.

export type QuestionOutcome = 'correct' | 'incorrect' | 'partial' | 'ungraded' | 'unknown';

export interface QuestionResult {
  number: number;
  name?: string;
  /** The question, as Markdown. */
  text?: string;
  type?: string;
  pointsPossible?: number;
  points?: number;
  outcome: QuestionOutcome;
  yourAnswer?: string;
  /** Only when Canvas shows the student the right answers. */
  correctAnswer?: string;
}

export interface QuizResult {
  quizId: number;
  assignmentId?: number;
  title: string;
  attempt?: number;
  score?: number | null;
  pointsPossible?: number | null;
  questions: QuestionResult[];
  /** Why the breakdown is missing or partial, in plain words. */
  note?: string;
}

const plain = (html: string | null | undefined) => (html ? htmlToMarkdown(html).replace(/\s+/g, ' ').trim() : '');

function outcomeOf(correct: unknown): QuestionOutcome {
  if (correct === true || correct === 'true') return 'correct';
  if (correct === false || correct === 'false') return 'incorrect';
  if (correct === 'partial') return 'partial';
  if (correct === 'undefined' || correct === null) return 'ungraded';
  return 'unknown';
}

type Answer = NonNullable<QuizQuestion['answers']>[number];

function answerText(a: Answer | undefined): string {
  if (!a) return '';
  const t = plain(a.html) || (a.text ?? '').trim();
  if (t) return t;
  if (a.left && a.right) return `${a.left} → ${a.right}`;
  if (a.left) return a.left;
  if (a.exact != null) return a.margin ? `${a.exact} (± ${a.margin})` : String(a.exact);
  return '';
}

/** What the student answered, from the history's per-question data. */
function answerFromData(d: QuizAnswerData, q: QuizQuestion | undefined): string {
  const byId = new Map((q?.answers ?? []).map((a) => [String(a.id), a]));
  const matchText = new Map((q?.matches ?? []).map((m) => [String(m.match_id), m.text]));
  const type = q?.question_type ?? '';
  if (d.answer_id != null && String(d.answer_id) !== '') return answerText(byId.get(String(d.answer_id))) || String(d.answer_id);

  // Fill in multiple blanks / dropdowns: answer_for_<blank>.
  const blanks = Object.entries(d).filter(([k, v]) => k.startsWith('answer_for_') && v != null && v !== '');
  if (blanks.length) {
    return blanks
      .map(([k, v]) => {
        const blank = k.slice('answer_for_'.length);
        const chosen = byId.get(String(d[`answer_id_for_${blank}`] ?? ''));
        return `${blank}: ${answerText(chosen) || plain(String(v))}`;
      })
      .join('; ');
  }

  // Matching (answer_<id> = match id) or multiple answers (answer_<id> = "1" when ticked).
  const keyed = Object.entries(d).filter(([k]) => /^answer_\d+$/.test(k));
  if (keyed.length) {
    const ticks = type === 'multiple_answers_question' || (type !== 'matching_question' && keyed.every(([, v]) => v === '0' || v === '1' || v === 0 || v === 1));
    if (ticks) {
      const chosen = keyed.filter(([, v]) => String(v) === '1').map(([k]) => answerText(byId.get(k.slice(7))) || k.slice(7));
      return chosen.length ? chosen.join('; ') : '(nothing ticked)';
    }
    return keyed
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${answerText(byId.get(k.slice(7))) || byId.get(k.slice(7))?.left || k.slice(7)} → ${matchText.get(String(v)) ?? String(v)}`)
      .join('; ');
  }

  return plain(d.text);
}

/** What the student answered, from a quiz submission's question (`answer`). */
function answerFromQuestion(q: QuizQuestion): string {
  const byId = new Map((q.answers ?? []).map((a) => [String(a.id), a]));
  const matchText = new Map((q.matches ?? []).map((m) => [String(m.match_id), m.text]));
  const a = q.answer;
  if (a == null || a === '') return '';
  if (typeof a === 'number' || (typeof a === 'string' && byId.has(a))) return answerText(byId.get(String(a))) || String(a);
  if (typeof a === 'string') return plain(a);
  if (Array.isArray(a)) {
    return a
      .map((x) => {
        if (x && typeof x === 'object' && 'answer_id' in x) {
          const m = x as { answer_id: unknown; match_id: unknown };
          return `${answerText(byId.get(String(m.answer_id))) || byId.get(String(m.answer_id))?.left || String(m.answer_id)} → ${matchText.get(String(m.match_id)) ?? String(m.match_id ?? '')}`;
        }
        return answerText(byId.get(String(x))) || String(x);
      })
      .join('; ');
  }
  if (typeof a === 'object') {
    return Object.entries(a as Record<string, unknown>)
      .map(([blank, v]) => `${blank}: ${answerText(byId.get(String(v))) || plain(String(v ?? ''))}`)
      .join('; ');
  }
  return String(a);
}

/** The right answer(s), when the answers carry weights (Canvas only sends them when it shows correct answers). */
function correctAnswerOf(q: QuizQuestion): string {
  const answers = q.answers ?? [];
  if (!answers.some((a) => typeof a.weight === 'number')) return '';
  if (q.question_type === 'matching_question') {
    const matchText = new Map((q.matches ?? []).map((m) => [String(m.match_id), m.text]));
    return answers.map((a) => `${a.left ?? a.text ?? ''} → ${a.right ?? matchText.get(String(a.match_id)) ?? ''}`).join('; ');
  }
  const right = answers.filter((a) => (a.weight ?? 0) > 0);
  if (!right.length) return '';
  const byBlank = right.some((a) => a.blank_id);
  if (byBlank) {
    const groups = new Map<string, string[]>();
    for (const a of right) groups.set(a.blank_id ?? '', [...(groups.get(a.blank_id ?? '') ?? []), answerText(a)]);
    return [...groups].map(([blank, texts]) => `${blank}: ${texts.join(' / ')}`).join('; ');
  }
  return right.map(answerText).filter(Boolean).join(' / ');
}

/** When there is no submission data, a single-choice answer can still be checked against the weights. */
function outcomeFromWeights(q: QuizQuestion): QuestionOutcome {
  const answers = q.answers ?? [];
  if (!answers.some((a) => typeof a.weight === 'number')) return 'unknown';
  const chosen = typeof q.answer === 'number' || typeof q.answer === 'string' ? answers.find((a) => String(a.id) === String(q.answer)) : undefined;
  if (!chosen) return 'unknown';
  return (chosen.weight ?? 0) > 0 ? 'correct' : 'incorrect';
}

export interface QuizResultInput {
  quizId: number;
  assignmentId?: number;
  title: string;
  attempt?: number;
  score?: number | null;
  pointsPossible?: number | null;
  /** From either questions endpoint; null when Canvas refused both. */
  questions: QuizQuestion[] | null;
  /** The attempt's submission_data; null when Canvas did not send it. */
  data: QuizAnswerData[] | null;
}

export function buildQuizResult(input: QuizResultInput): QuizResult {
  const { questions, data } = input;
  const base = { quizId: input.quizId, assignmentId: input.assignmentId, title: input.title, attempt: input.attempt, score: input.score, pointsPossible: input.pointsPossible };
  const byId = new Map((questions ?? []).map((q) => [String(q.id), q]));
  const dataById = new Map((data ?? []).map((d) => [String(d.question_id), d]));

  // The question order: the questions' own (by position when given), else the order of the data.
  const ordered = questions?.length ? [...questions].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((q) => String(q.id)) : (data ?? []).map((d) => String(d.question_id));
  // Text-only items ("text_only_question") are headings, not questions.
  const ids = ordered.filter((id) => byId.get(id)?.question_type !== 'text_only_question');

  const results: QuestionResult[] = ids.map((id, i) => {
    const q = byId.get(id);
    const d = dataById.get(id);
    const ungradable = q?.question_type === 'essay_question' || q?.question_type === 'file_upload_question';
    let outcome = d ? outcomeOf(d.correct) : q && typeof q.correct !== 'undefined' ? outcomeOf(q.correct) : q ? outcomeFromWeights(q) : 'unknown';
    if (outcome === 'unknown' && ungradable) outcome = 'ungraded';
    const yourAnswer = (d ? answerFromData(d, q) : '') || (q ? answerFromQuestion(q) : '');
    const correctAnswer = q ? correctAnswerOf(q) : '';
    const name = q?.question_name?.trim();
    const text = q?.question_text ? htmlToMarkdown(q.question_text).trim() : '';
    return {
      number: i + 1,
      ...(name && !/^question$/i.test(name) ? { name } : {}),
      ...(text ? { text } : {}),
      ...(q?.question_type ? { type: q.question_type } : {}),
      ...(q?.points_possible != null ? { pointsPossible: q.points_possible } : {}),
      ...(typeof d?.points === 'number' ? { points: d.points } : {}),
      outcome,
      ...(yourAnswer ? { yourAnswer } : {}),
      ...(correctAnswer ? { correctAnswer } : {}),
    };
  });

  let note: string | undefined;
  if (!results.length) note = 'Canvas does not show you the questions or answers of this quiz.';
  else if (!data) note = questions?.some((q) => q.answers?.some((a) => typeof a.weight === 'number')) ? undefined : 'Canvas does not show which answers were right for this quiz; only your answers are listed.';
  else if (!questions) note = 'Canvas does not show the questions of this quiz; only whether each answer was right.';
  return { ...base, questions: results, ...(note ? { note } : {}) };
}

export const outcomeLabel: Record<QuestionOutcome, string> = {
  correct: '✅ Right',
  incorrect: '❌ Wrong',
  partial: '🟡 Partly right',
  ungraded: '⏳ Not graded yet',
  unknown: '❔ Not shown',
};

/** "7 of 10 right" (+ partly right / not graded counts). Questions whose outcome is not shown are left out. */
export function tally(r: QuizResult): string {
  const n = (o: QuestionOutcome) => r.questions.filter((q) => q.outcome === o).length;
  const known = r.questions.length - n('unknown');
  if (!known) return '';
  return [`${n('correct')} of ${known} right`, n('partial') ? `${n('partial')} partly right` : '', n('ungraded') ? `${n('ungraded')} not graded yet` : ''].filter(Boolean).join(', ');
}
