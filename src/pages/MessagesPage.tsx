import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Conversation, ConversationMessage, MessageAttachment, Recipient } from '../api/types';
import { ErrorMessage, Spinner } from '../components/ui';
import { useApi, useAuth } from '../context/AuthContext';
import { useFileViewer } from '../context/FileViewerContext';
import { formatBytes } from '../lib/format';
import { useQueryStore } from '../context/DataContext';
import { refreshMail } from '../extension/bridge';
import { useConversation, useConversations, useCourseRecipients, useVisibleCourses } from '../hooks/useCanvasData';
import { attachmentKind, chatName, composeTarget, mergeFolders, type AttachmentKind, dayHeading, linkify, listTime, otherPeople, peopleLabel, threadDays, timeOf } from '../lib/messages';
import { t } from '../i18n';

// Messages, made to feel like texting: every conversation (received or sent) in one list on the left, the open one as a thread of bubbles on the right
// (yours on the right), and a reply box that sends on Enter. Canvas conversations also have a subject: it heads the
// thread and is asked for when starting a new message. Routes: /messages, /messages/:conversationId, /messages/new
// (?context_id=course_1&user_id=5, Canvas's own compose link, works too).

/** After sending: the lists and the thread load again (in place, the old copy stays until the new one arrives). */
function useMailRefresh() {
  const store = useQueryStore();
  const api = useApi();
  return (conversationId?: number) => {
    store.load('conversations:inbox', () => api.getConversations('inbox'), true);
    store.load('conversations:sent', () => api.getConversations('sent'), true);
    store.load('conversations:unread', api.getUnreadCount, true);
    if (conversationId) store.load(`conversation:${conversationId}`, () => api.getConversation(conversationId), true);
  };
}

// Extension mode: opening Messages has the extension read the inbox, the sent folder and every thread from Canvas (in a
// background Canvas tab). Once per visit to Messages, not again for every conversation opened (the extension also waits
// two minutes between reads). The new data arrives through the extension's usual change notice.
let mailAskedAt = 0;
type MailState = { state: 'idle' | 'loading' | 'done' | 'needsClick' } | { state: 'error'; error: string };
function useExtensionMail(): [MailState, () => void] {
  const { source } = useAuth();
  const [status, setStatus] = useState<MailState>({ state: 'idle' });
  const run = useCallback(() => {
    mailAskedAt = Date.now();
    setStatus({ state: 'loading' });
    void refreshMail().then((r) => {
      if (r.ok) return setStatus({ state: 'done' });
      if (r.needsClick) mailAskedAt = 0;
      setStatus(r.needsClick ? { state: 'needsClick' } : { state: 'error', error: r.error });
    });
  }, []);
  useEffect(() => {
    if (source === 'extension' && Date.now() - mailAskedAt > 2 * 60e3) run();
  }, [source, run]);
  return [status, run];
}

function MailStatus({ status, retry }: { status: MailState; retry: () => void }) {
  if (status.state === 'idle' || status.state === 'done') return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
      {status.state === 'loading' && <span>{t('Updating messages from Canvas…')}</span>}
      {status.state === 'needsClick' && (
        <button type="button" onClick={retry} className="rounded-md border border-neutral-300 px-2 py-1 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
          {t('Load latest messages')}
        </button>
      )}
      {status.state === 'error' && (
        <>
          <span className="min-w-0 flex-1 text-red-700 dark:text-red-300">{status.error}</span>
          <button type="button" onClick={retry} className="shrink-0 underline">
            {t('Try again')}
          </button>
        </>
      )}
    </div>
  );
}

export function MessagesPage() {
  const params = useParams();
  const { pathname, search } = useLocation();
  const composing = pathname.endsWith('/messages/new');
  const openId = !composing && params.conversationId ? Number(params.conversationId) : null;
  const [mail, reloadMail] = useExtensionMail();
  const paneOpen = composing || openId !== null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* The list: always on wide screens, alone on a phone until a conversation is opened. */}
      <section aria-label={t('Conversations')} className={`${paneOpen ? 'hidden md:flex' : 'flex'} w-full min-w-0 flex-col border-r border-neutral-200 md:w-80 md:shrink-0 dark:border-neutral-800`}>
        <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h1 className="text-lg font-semibold">{t('Messages')}</h1>
          <Link to="/messages/new" className="rounded-full bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700">
            {t('New message')}
          </Link>
        </div>
        <MailStatus status={mail} retry={reloadMail} />
        <ConversationList openId={openId} />
      </section>

      <section aria-label={composing ? t('New message') : t('Conversation')} className={`${paneOpen ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {composing ? <NewMessage search={search} /> : openId ? <Thread key={openId} id={openId} /> : <EmptyPane />}
      </section>
    </div>
  );
}

function EmptyPane() {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
      <p>{t('Choose a conversation, or start a new message.')}</p>
    </div>
  );
}

/** Every conversation, received or sent, in one list (Canvas keeps two folders; texting does not). */
function ConversationList({ openId }: { openId: number | null }) {
  const inbox = useConversations('inbox');
  const sent = useConversations('sent');
  const { user } = useAuth();
  const meId = user ? Number(user.id) : null;
  const data = useMemo(() => (inbox.data && sent.data ? mergeFolders(inbox.data, sent.data) : inbox.data && sent.error ? inbox.data : undefined), [inbox.data, sent.data, sent.error]);
  if (inbox.error) return <div className="p-4"><ErrorMessage error={inbox.error} onRetry={inbox.refetch} /></div>;
  if (!data) return <Spinner />;
  if (data.length === 0) return <p className="p-4 text-sm text-neutral-500 dark:text-neutral-400">{t('No messages.')}</p>;
  return (
    <ul className="min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800">
      {data.map((c) => {
        const unread = c.workflow_state === 'unread';
        const active = c.id === openId;
        const people = otherPeople(c, meId, user?.name);
        return (
          <li key={c.id}>
            <Link
              to={`/messages/${c.id}`}
              aria-current={active ? 'page' : undefined}
              className={`flex gap-3 px-4 py-3 ${active ? 'bg-accent-50 dark:bg-accent-950' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'}`}
            >
              <Avatar name={chatName(c, people)} />
              <span className="min-w-0 flex-1">
                {/* Named like a group chat: the subject, with who it is with underneath. */}
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${unread ? 'font-semibold' : 'font-medium'}`}>{chatName(c, people)}</span>
                  <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{listTime(c.last_message_at)}</span>
                </span>
                <span className={`block truncate text-xs ${unread ? 'font-semibold text-neutral-800 dark:text-neutral-100' : 'text-neutral-600 dark:text-neutral-300'}`}>{peopleLabel(people)}</span>
                <span className="flex items-center gap-2">
                  <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">{c.last_message ?? ''}</span>
                  {unread && <span aria-label={t('Unread')} className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent-600" />}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Avatar({ name }: { name: string }) {
  // Initials from the words that start with a letter ("Class 30 Oct." -> "CO").
  const initials = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  return (
    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
      {initials}
    </span>
  );
}

function Body({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((s, i) =>
        'href' in s ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="underline">
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

const KIND_ICON: Record<AttachmentKind, string> = { image: '🖼️', pdf: '📕', doc: '📝', sheet: '📊', slides: '📽️', code: '💻', video: '🎬', audio: '🎵', archive: '🗜️', file: '📄' };

/**
 * A message's attachments, like a texting app: images as thumbnails, other files as cards, both opening in the in-app
 * viewer. Without a file link (the extension version leaves those out: they work for anyone who has them) a card
 * opens the conversation in Canvas instead.
 */
function Attachments({ list, mine }: { list: MessageAttachment[]; mine: boolean }) {
  const { openFile } = useFileViewer();
  const { baseUrl } = useAuth();
  const images = list.filter((a) => attachmentKind(a) === 'image' && a.url);
  const others = list.filter((a) => !images.includes(a));
  const open = (a: MessageAttachment) => {
    if (a.url) openFile(a.url, a.display_name, a['content-type']);
    else if (baseUrl) window.open(`${baseUrl}/conversations`, '_blank', 'noopener,noreferrer');
  };
  const card = mine ? 'bg-white/15 hover:bg-white/25' : 'bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-950';
  return (
    <div className="mt-2 space-y-1.5">
      {images.length > 0 && (
        <div className={`grid gap-1.5 ${images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {images.map((a) => (
            <button key={String(a.id)} type="button" onClick={() => open(a)} title={a.display_name} className="block overflow-hidden rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400">
              <img src={a.thumbnail_url || a.url} alt={a.display_name} loading="lazy" className="max-h-64 w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {others.map((a) => {
        const kind = attachmentKind(a);
        return (
          <button
            key={String(a.id)}
            type="button"
            onClick={() => open(a)}
            title={a.url ? t('Open {name}', { name: a.display_name }) : t('Open in Canvas to see this file')}
            className={`flex w-full min-w-[12rem] items-center gap-2.5 rounded-xl px-3 py-2 text-left ${card}`}
          >
            <span aria-hidden className="text-xl">{KIND_ICON[kind]}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{a.display_name}</span>
              <span className={`block text-[11px] ${mine ? 'text-white/80' : 'text-neutral-500 dark:text-neutral-400'}`}>
                {[a.size ? formatBytes(a.size) : null, a.url ? null : t('Open in Canvas')].filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Thread({ id }: { id: number }) {
  const { data, error, refetch } = useConversation(id);
  const { user } = useAuth();
  const meId = user ? Number(user.id) : null;
  const [pending, setPending] = useState<ConversationMessage[]>([]); // sent, not yet in the loaded thread
  const bottom = useRef<HTMLDivElement>(null);

  const messages = useMemo(() => {
    const loaded = data?.messages ?? [];
    const ids = new Set(loaded.map((m) => String(m.id)));
    return [...loaded, ...pending.filter((m) => !ids.has(String(m.id)))];
  }, [data, pending]);
  const days = useMemo(() => threadDays(messages, meId), [messages, meId]);
  const group = (data?.participants.length ?? 0) > 2;
  const byId = useMemo(() => new Map((data?.participants ?? []).map((p) => [Number(p.id), p.name])), [data]);

  // Opening an unread conversation marks it read (token mode; in Canvas too), and the list and the sidebar count update.
  const api = useApi();
  const { source } = useAuth();
  const refresh = useMailRefresh();
  // Canvas marks it read while answering the GET, so the thread itself may already say "read": the inbox list's copy
  // is the one that still says unread.
  const inbox = useConversations('inbox');
  const listedUnread = inbox.data?.some((c) => Number(c.id) === id && c.workflow_state === 'unread') ?? false;
  const markedRef = useRef(false);
  useEffect(() => {
    if (!data || markedRef.current || source !== 'token' || !(listedUnread || data.workflow_state === 'unread')) return;
    markedRef.current = true;
    void api.markConversationRead(id).then(() => refresh(), () => refresh());
  }, [data, source, api, id, refresh, listedUnread]);

  // Braces on purpose: an effect's return value is its cleanup, and scrollIntoView() returns a Promise in recent
  // Chrome, which React would then try to call when the thread closes.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (error) return <div className="p-4"><ErrorMessage error={error} onRetry={refetch} /></div>;
  if (!data) return <Spinner />;
  const people = otherPeople(data, meId, user?.name);

  return (
    <>
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Link to="/messages" className="rounded-md px-1 text-lg text-neutral-500 hover:text-neutral-800 md:hidden dark:hover:text-neutral-100" aria-label={t('Back to conversations')}>
          ‹
        </Link>
        <Avatar name={chatName(data, people)} />
        {/* The conversation's name (its subject) heads the chat, as in a group chat; who and which course below. */}
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold leading-tight">{chatName(data, people)}</h2>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {peopleLabel(people)}
            {data.context_name ? ` · ${data.context_name}` : ''}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {data.message_count > messages.length && (
          <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
            {t('Only the newest messages of this conversation have come through yet. They load when you open Messages (the extension reads them from Canvas).')}
          </p>
        )}
        {days.map((d) => (
          <div key={d.day} className="space-y-1">
            <p className="py-2 text-center text-xs font-medium text-neutral-500 dark:text-neutral-400">{dayHeading(d.day)}</p>
            {d.bubbles.map(({ message: m, mine, first, last }) => (
              <div key={String(m.id)} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                {group && !mine && first && <span className="mb-0.5 px-3 text-xs text-neutral-500 dark:text-neutral-400">{byId.get(Number(m.author_id)) ?? m.author_name ?? ''}</span>}
                <div
                  className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
                    mine ? 'bg-accent-600 text-white' : 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                  } ${mine ? (last ? 'rounded-br-md' : '') : last ? 'rounded-bl-md' : ''}`}
                >
                  <Body text={m.body} />
                  {m.attachments?.length ? <Attachments list={m.attachments} mine={mine} /> : null}
                </div>
                {last && <span className="mt-0.5 px-2 text-[11px] text-neutral-500 dark:text-neutral-400">{timeOf(m.created_at)}</span>}
              </div>
            ))}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <ReplyBox conversation={data} onSent={(m) => setPending((p) => [...p, m])} />
    </>
  );
}

const MAX_FILES = 10;
const MAX_FILES_BYTES = 25 * 1024 * 1024; // the extension takes the same (extension/lib/message.js)

/** Files to attach: adding (within the limits), removing, and an error when a limit is hit. */
function useAttachments() {
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const add = (picked: FileList | null) => {
    if (!picked?.length) return;
    const next = [...files, ...Array.from(picked)];
    if (next.length > MAX_FILES) return setProblem(t('Up to {n} files per message.', { n: MAX_FILES }));
    if (next.reduce((n, f) => n + f.size, 0) > MAX_FILES_BYTES) return setProblem(t('Attachments can be up to 25 MB in all.'));
    setProblem(null);
    setFiles(next);
  };
  const remove = (i: number) => setFiles((list) => list.filter((_, j) => j !== i));
  return { files, add, remove, clear: () => setFiles([]), problem };
}

function AttachButton({ onPick, disabled }: { onPick: (files: FileList | null) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-label={t('Attach files')}
        title={t('Attach files')}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L15.5 7" />
        </svg>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = ''; // the same file can be picked again after removing it
        }}
      />
    </>
  );
}

function AttachedFiles({ files, onRemove, disabled }: { files: File[]; onRemove: (i: number) => void; disabled: boolean }) {
  if (!files.length) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={t('Attached files')}>
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pl-2.5 pr-1 text-xs dark:bg-neutral-800">
          <span aria-hidden>📎</span>
          <span className="max-w-[12rem] truncate">{f.name}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(i)}
            aria-label={t('Remove {name}', { name: f.name })}
            className="rounded-full px-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A textarea that sends on Enter (Shift+Enter for a new line) and grows with its text. */
function MessageInput({ value, onChange, onSend, disabled, label }: { value: string; onChange: (v: string) => void; onSend: () => void; disabled: boolean; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      disabled={disabled}
      aria-label={label}
      placeholder={label}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className="max-h-40 min-h-[2.5rem] w-full resize-none rounded-2xl border border-neutral-300 bg-white px-3.5 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
    />
  );
}

function ReplyBox({ conversation, onSent }: { conversation: Conversation; onSent: (m: ConversationMessage) => void }) {
  const api = useApi();
  const { user } = useAuth();
  const refresh = useMailRefresh();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attach = useAttachments();

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const answer = await api.replyToConversation(Number(conversation.id), body, attach.files);
      const sent = answer?.messages?.[0];
      const local = { id: `local-${Date.now()}`, body, created_at: new Date().toISOString(), author_id: Number(user?.id ?? 0), attachments: attach.files.map((f, i) => ({ id: -i - 1, display_name: f.name, 'content-type': f.type, size: f.size, url: URL.createObjectURL(f) })) };
      onSent(sent ?? local);
      setText('');
      attach.clear();
      refresh(Number(conversation.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  return (
    <form onSubmit={onSubmit} className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
      {(error ?? attach.problem) && <p role="alert" className="mb-2 text-xs text-red-700 dark:text-red-300">{error ?? attach.problem}</p>}
      <AttachedFiles files={attach.files} onRemove={attach.remove} disabled={sending} />
      <div className="flex items-end gap-2">
        <AttachButton onPick={attach.add} disabled={sending} />
        <MessageInput value={text} onChange={setText} onSend={() => void send()} disabled={sending} label={t('Message')} />
        <button type="submit" disabled={sending || !text.trim()} className="shrink-0 rounded-full bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50">
          {sending ? t('Sending…') : t('Send')}
        </button>
      </div>
    </form>
  );
}

function PeopleChips({ people, chosen, onToggle }: { people: Recipient[]; chosen: number[]; onToggle: (id: number) => void }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {people.map((p) => {
        const on = chosen.includes(Number(p.id));
        return (
          <li key={p.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(Number(p.id))}
              className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-accent-600 bg-accent-600 text-white' : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}`}
            >
              {p.name}
              {p.role === 'ta' ? ` · ${t('TA')}` : ''}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function NewMessage({ search }: { search: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const refresh = useMailRefresh();
  const target = useMemo(() => composeTarget(search), [search]);
  const { data: courses } = useVisibleCourses();
  const [courseId, setCourseId] = useState<number | null>(target.courseId);
  const roster = useCourseRecipients(courseId);
  const { user } = useAuth();
  const [to, setTo] = useState<number[]>(target.userId ? [target.userId] : []);
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attach = useAttachments();

  // Everyone in the course but the student; someone named in the link who is not (or not yet) in the class list still
  // shows as chosen.
  const people = useMemo(() => {
    const list = (roster.data ?? []).filter((p) => !user || Number(p.id) !== Number(user.id));
    if (target.userId && !list.some((p) => Number(p.id) === target.userId)) list.unshift({ id: target.userId, name: target.userName ?? t('Person {id}', { id: target.userId }), role: 'teacher' });
    return list;
  }, [roster.data, target, user]);
  const teachers = people.filter((p) => p.role !== 'student');
  const classmates = people.filter((p) => p.role === 'student');
  const q = query.trim().toLowerCase();
  const shownClassmates = q ? classmates.filter((p) => p.name.toLowerCase().includes(q)) : classmates;
  const nameOf = (id: number) => people.find((p) => Number(p.id) === id)?.name ?? t('Person {id}', { id });

  const toggle = (id: number) => setTo((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const send = async () => {
    if (sending || !to.length || !body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const created = await api.createConversation({ recipients: to, subject: subject.trim(), body: body.trim(), contextCode: courseId ? `course_${courseId}` : undefined, files: attach.files });
      refresh();
      const first = created[0];
      navigate(first ? `/messages/${first.id}` : '/messages', { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const field = 'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Link to="/messages" className="rounded-md px-1 text-lg text-neutral-500 hover:text-neutral-800 md:hidden dark:hover:text-neutral-100" aria-label={t('Back to conversations')}>
          ‹
        </Link>
        <h2 className="text-sm font-semibold">{t('New message')}</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('Course')}</span>
          <select value={courseId ?? ''} onChange={(e) => setCourseId(e.target.value ? Number(e.target.value) : null)} className={field}>
            <option value="">{t('Choose a course')}</option>
            {(courses ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('To')}</legend>
          {/* Who is chosen, removable. */}
          {to.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t('Recipients')}>
              {to.map((id) => (
                <li key={id} className="flex items-center gap-1 rounded-full bg-accent-600 py-0.5 pl-3 pr-1 text-xs text-white">
                  {nameOf(id)}
                  <button type="button" onClick={() => toggle(id)} aria-label={t('Remove {name}', { name: nameOf(id) })} className="rounded-full px-1.5 hover:bg-accent-700">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {roster.error ? (
            <ErrorMessage error={roster.error} onRetry={roster.refetch} />
          ) : courseId && !roster.data ? (
            <Spinner />
          ) : !courseId ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('Choose a course to see its teachers and classmates.')}</p>
          ) : people.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('No one found for this course. Open its People page in Canvas, or press Sync now.')}</p>
          ) : (
            <>
              {teachers.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{t('Teachers')}</p>
                  <PeopleChips people={teachers} chosen={to} onToggle={toggle} />
                </div>
              )}
              {classmates.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{t('Classmates')}</p>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('Search classmates')}
                      aria-label={t('Search classmates')}
                      className="w-44 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {shownClassmates.length ? <PeopleChips people={shownClassmates} chosen={to} onToggle={toggle} /> : <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('No classmate matches.')}</p>}
                  </div>
                </div>
              )}
            </>
          )}
        </fieldset>

        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('Subject')}</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={255} className={field} />
        </label>
      </div>
      <div className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        {(error ?? attach.problem) && <p role="alert" className="mb-2 text-xs text-red-700 dark:text-red-300">{error ?? attach.problem}</p>}
        <AttachedFiles files={attach.files} onRemove={attach.remove} disabled={sending} />
        <div className="flex items-end gap-2">
          <AttachButton onPick={attach.add} disabled={sending} />
          <MessageInput value={body} onChange={setBody} onSend={() => void send()} disabled={sending} label={t('Message')} />
          <button type="submit" disabled={sending || !to.length || !body.trim()} className="shrink-0 rounded-full bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50">
            {sending ? t('Sending…') : t('Send')}
          </button>
        </div>
      </div>
    </form>
  );
}
