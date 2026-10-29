// Pure helpers for the Messages screen: thread layout (days, runs of messages by one person), who a conversation is
// with, and plain-text bodies with clickable links. No React.
import type { Conversation, ConversationMessage, ConversationParticipant, MessageAttachment } from '../api/types';
import { getLocale, t } from '../i18n';
import { withClock } from './systemClock';

export interface Bubble {
  message: ConversationMessage;
  mine: boolean;
  /** First of a run by the same person: show their name above (in group threads). */
  first: boolean;
  /** Last of a run: show the time under it. */
  last: boolean;
}

export interface DayGroup {
  day: string; // YYYY-MM-DD, local time
  bubbles: Bubble[];
}

const RUN_GAP_MS = 10 * 60e3; // a gap longer than this starts a new run, even from the same person

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Oldest first, grouped by day, each message marked as the start / end of a run by one author. */
export function threadDays(messages: readonly ConversationMessage[], meId: number | null): DayGroup[] {
  const sorted = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const days: DayGroup[] = [];
  sorted.forEach((m, i) => {
    const day = localDay(m.created_at);
    if (days.at(-1)?.day !== day) days.push({ day, bubbles: [] });
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const sameRun = (a?: ConversationMessage, b?: ConversationMessage) =>
      !!a && !!b && a.author_id === b.author_id && localDay(a.created_at) === localDay(b.created_at) && Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) < RUN_GAP_MS;
    days.at(-1)!.bubbles.push({ message: m, mine: meId !== null && Number(m.author_id) === meId, first: !sameRun(prev, m), last: !sameRun(m, next) });
  });
  return days;
}

/** The people a conversation is with: everyone but the student (by id, or by name when ids are unknown). */
export function otherPeople(c: Pick<Conversation, 'participants'>, meId: number | null, meName?: string | null): ConversationParticipant[] {
  const me = meName?.trim();
  const others = c.participants.filter((p) => (meId === null || Number(p.id) !== meId) && (!me || p.name.trim() !== me));
  return others.length ? others : c.participants;
}

/** "Ana, Luis and 3 others". */
export function peopleLabel(people: readonly ConversationParticipant[]): string {
  const names = people.map((p) => p.name).filter(Boolean);
  if (!names.length) return t('(no one)');
  if (names.length <= 2) return names.join(` ${t('and')} `);
  return t('{first}, {second} and {n} others', { first: names[0], second: names[1], n: names.length - 2 });
}

/** What a conversation is called, like a group chat: its subject, or who it is with when it has none. */
export function chatName(c: Pick<Conversation, 'subject'>, people: readonly ConversationParticipant[]): string {
  return c.subject?.trim() || peopleLabel(people);
}

/**
 * One list, like a texting app: the inbox and the sent folder together, each conversation once, newest activity
 * first. Where it is in both, the newer of its two last messages wins, and it is unread if the inbox says so.
 */
export function mergeFolders(inbox: readonly Conversation[], sent: readonly Conversation[]): Conversation[] {
  const byId = new Map<string, Conversation>();
  for (const c of [...inbox, ...sent]) {
    const key = String(c.id);
    const had = byId.get(key);
    if (!had) {
      byId.set(key, c);
      continue;
    }
    const newer = String(c.last_message_at ?? '') > String(had.last_message_at ?? '') ? c : had;
    byId.set(key, {
      ...had,
      ...c,
      last_message: newer.last_message,
      last_message_at: newer.last_message_at,
      workflow_state: had.workflow_state === 'unread' || c.workflow_state === 'unread' ? 'unread' : (had.workflow_state ?? c.workflow_state),
      participants: had.participants.length >= c.participants.length ? had.participants : c.participants,
    });
  }
  return [...byId.values()].sort((a, b) => String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? '')));
}

export type AttachmentKind = 'image' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'code' | 'video' | 'audio' | 'archive' | 'file';

/** What kind of file an attachment is, from Canvas's mime class, its content type, or its name. */
export function attachmentKind(a: Pick<MessageAttachment, 'display_name' | 'mime_class' | 'content-type'>): AttachmentKind {
  const type = (a['content-type'] ?? '').toLowerCase();
  const ext = /\.([a-z0-9]+)$/i.exec(a.display_name)?.[1]?.toLowerCase() ?? '';
  const mc = (a.mime_class ?? '').toLowerCase();
  if (mc === 'image' || type.startsWith('image/') || /^(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/.test(ext)) return 'image';
  if (mc === 'pdf' || type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mc === 'doc' || /^(docx?|odt|rtf|txt|md)$/.test(ext)) return 'doc';
  if (mc === 'xls' || /^(xlsx?|ods|csv)$/.test(ext)) return 'sheet';
  if (mc === 'ppt' || /^(pptx?|odp|key)$/.test(ext)) return 'slides';
  if (mc === 'code' || /^(java|py|js|ts|tsx|c|cpp|h|cs|rb|go|rs|html|css|json|xml|sql|m|r|ipynb)$/.test(ext)) return 'code';
  if (mc === 'video' || type.startsWith('video/') || /^(mp4|mov|webm|avi|mkv)$/.test(ext)) return 'video';
  if (mc === 'audio' || type.startsWith('audio/') || /^(mp3|wav|m4a|ogg|flac)$/.test(ext)) return 'audio';
  if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return 'archive';
  return 'file';
}

export type Segment = { text: string } | { href: string; text: string };

/** Plain text split into text and http(s) links (bodies are never rendered as HTML). */
export function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ href: m[0], text: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** For the list: the time today, the weekday this week, the date before that. */
export function listTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const locale = getLocale();
  if (localDay(iso) === localDay(now.toISOString())) return d.toLocaleTimeString(locale, withClock({ hour: 'numeric', minute: '2-digit' }));
  if (now.getTime() - d.getTime() < 6 * 86400e3) return d.toLocaleDateString(locale, { weekday: 'short' });
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

/** For a day separator in the thread: "Today", "Yesterday", or the date. */
export function dayHeading(day: string, now: Date = new Date()): string {
  const today = localDay(now.toISOString());
  const yesterday = localDay(new Date(now.getTime() - 86400e3).toISOString());
  if (day === today) return t('Today');
  if (day === yesterday) return t('Yesterday');
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(getLocale(), { weekday: 'long', month: 'long', day: 'numeric', ...(y !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(getLocale(), withClock({ hour: 'numeric', minute: '2-digit' }));

/**
 * Canvas's own compose link (…/conversations?context_id=course_1&user_id=5&user_name=Ana): which course and person
 * a new message is for. Courseline's /messages/new takes the same parameters.
 */
export function composeTarget(search: string): { courseId: number | null; userId: number | null; userName: string | null } {
  const q = new URLSearchParams(search);
  const course = /^course_(\d+)$/.exec(q.get('context_id') ?? '')?.[1] ?? q.get('course');
  const user = q.get('user_id') ?? q.get('to');
  return {
    courseId: course && /^\d+$/.test(course) ? Number(course) : null,
    userId: user && /^\d+$/.test(user) ? Number(user) : null,
    userName: q.get('user_name') ?? q.get('name'),
  };
}
