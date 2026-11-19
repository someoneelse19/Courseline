import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CoursePerson } from '../api/types';
import { Card, EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { STUDENTS_FIRST } from '../api/canvas';
import { loadCoursePeople } from '../extension/bridge';
import { useCoursePeople } from '../hooks/useCanvasData';
import { t } from '../i18n';

// The "People" tab of a course: its teachers, TAs and students, each with a Message button (Messages' compose, with
// the course and the person filled in). Student id and email show only where Canvas gives them to the student: many
// schools do not (permissions read_sis / view_user_logins), and then only the student's own row has them, from their
// profile.

type Role = 'teacher' | 'ta' | 'student';
const ROLES: Role[] = ['teacher', 'ta', 'student'];
/** Anyone Canvas does not list as a teacher or TA is shown (and counted) as a student. */
const roleOf = (role: string | undefined): Role => (role === 'teacher' || role === 'ta' ? role : 'student');

function roleLabel(role: string | undefined): string {
  const r = roleOf(role);
  return r === 'teacher' ? t('Teacher') : r === 'ta' ? t('TA') : t('Student');
}

const roleGroup = (r: Role) => (r === 'teacher' ? t('Teachers') : r === 'ta' ? t('TAs') : t('Students'));

/** One chip of the role filter: the role, how many there are, and whether the list is narrowed to it. */
function RoleChip({ label, n, active, onClick }: { label: string; n: number | string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${
        active
          ? 'border-accent-600 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-950 dark:text-accent-300'
          : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
      }`}
    >
      {label} <span className="tabular-nums opacity-70">{n}</span>
    </button>
  );
}

function Avatar({ person }: { person: CoursePerson }) {
  const initials = person.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  // Canvas's placeholder picture says nothing: initials instead.
  const real = person.avatar_url && !/avatar-50\.png|\/images\/messages\//.test(person.avatar_url);
  return real ? (
    <img src={person.avatar_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" loading="lazy" />
  ) : (
    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
      {initials}
    </span>
  );
}

/** Rows drawn at first, and per "Show more": a university-wide list is tens of thousands. Search and counts use all. */
const ROWS_PAGE = 300;

export function CoursePeoplePage() {
  const courseId = Number(useParams().courseId);
  const { user, source } = useAuth();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [limit, setLimit] = useState(ROWS_PAGE);

  // A big course comes back cut short (the first STUDENTS_FIRST students with a token; with the extension, whoever
  // Canvas's own People page loaded). "Load everyone" reads the rest: with a token, the same list without the cut;
  // with the extension, the extension reads it from Canvas and it arrives as new captured data.
  const [everyone, setEveryone] = useState(false);
  const first = useCoursePeople(courseId);
  const all = useCoursePeople(courseId, everyone);
  const people = everyone && all.data ? all : first;
  const [extLoading, setExtLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadingEveryone = extLoading || (everyone && !all.data && !all.error);
  const loadEveryone = async () => {
    setLoadError(null);
    if (source !== 'extension') return setEveryone(true);
    setExtLoading(true);
    const result = await loadCoursePeople(courseId);
    setExtLoading(false);
    if (!result.ok) setLoadError(result.error);
  };

  // The student's own row: what their profile knows (their email, and their login, which is the student id at many schools).
  const rows = useMemo(
    () =>
      (people.data?.people ?? []).map((p) =>
        user && p.id === user.id ? { ...p, email: p.email ?? user.primary_email, student_id: p.student_id ?? user.login_id, self: true } : { ...p, self: false },
      ),
    [people.data, user],
  );

  if (people.error) return <ErrorMessage error={people.error} onRetry={people.refetch} />;
  if (!people.data) return <Spinner />;
  const { more, complete } = people.data;
  // With a token, a list read to its end is complete; with the extension, only once "Load everyone" has been done.
  const offerEveryone = source === 'extension' ? !complete : more;
  const plus = (n: number) => (more ? `${n}+` : n);

  const counts = new Map<Role, number>();
  for (const p of rows) counts.set(roleOf(p.role), (counts.get(roleOf(p.role)) ?? 0) + 1);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((p) => (!role || roleOf(p.role) === role) && (!q || `${p.name} ${p.email ?? ''} ${p.student_id ?? ''}`.toLowerCase().includes(q)));
  const hasId = rows.some((p) => p.student_id);
  const hasEmail = rows.some((p) => p.email);
  const othersHidden = !rows.some((p) => !p.self && (p.student_id || p.email));

  return (
    <Card
      title={t('People')}
      action={<span className="text-xs text-neutral-500 dark:text-neutral-400">{t('{n} people', { n: plus(rows.length) })}</span>}
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('Search people…')}
        aria-label={t('Search people…')}
        className="mb-3 w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t('Role')}>
        <RoleChip label={t('Everyone')} n={plus(rows.length)} active={role === null} onClick={() => setRole(null)} />
        {ROLES.filter((r) => counts.has(r)).map((r) => (
          <RoleChip key={r} label={roleGroup(r)} n={r === 'student' ? plus(counts.get(r)!) : counts.get(r)!} active={role === r} onClick={() => setRole(role === r ? null : r)} />
        ))}
      </div>
      {(offerEveryone || loadingEveryone || loadError || all.error) && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-300">
          <span className="min-w-0 flex-1">
            {loadingEveryone
              ? t('Loading everyone… A very big class can take a few minutes.')
              : loadError || all.error
                ? (loadError ?? all.error?.message)
                : source === 'extension'
                  ? t('This is who Canvas’s People page loaded, which in a big class is only the first few.')
                  : t('Showing the first {n} students.', { n: STUDENTS_FIRST })}
          </span>
          {!loadingEveryone && (offerEveryone || loadError || all.error) && (
            <button
              onClick={() => (all.error ? all.refetch() : void loadEveryone())}
              className="rounded-md border border-neutral-300 px-2.5 py-1 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {loadError || all.error ? t('Try again') : t('Load everyone')}
            </button>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState>{t('No people found.')}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="py-2 pr-3 font-medium">{t('Name')}</th>
                <th className="px-3 py-2 font-medium">{t('Role')}</th>
                {hasId && <th className="hidden px-3 py-2 font-medium sm:table-cell">{t('Student ID')}</th>}
                {hasEmail && <th className="hidden px-3 py-2 font-medium md:table-cell">{t('Email')}</th>}
                <th className="py-2 pl-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {shown.slice(0, limit).map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2.5">
                      <Avatar person={p} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {p.name}
                          {p.self && <span className="ml-1.5 text-xs font-normal text-neutral-500 dark:text-neutral-400">({t('you')})</span>}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{roleLabel(p.role)}</td>
                  {hasId && <td className="hidden px-3 py-2 tabular-nums text-neutral-600 dark:text-neutral-300 sm:table-cell">{p.student_id ?? '—'}</td>}
                  {hasEmail && (
                    <td className="hidden px-3 py-2 md:table-cell">
                      {p.email ? (
                        <a href={`mailto:${p.email}`} className="text-accent-700 underline dark:text-accent-300">
                          {p.email}
                        </a>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  )}
                  <td className="py-2 pl-3 text-right">
                    {!p.self && (
                      <Link
                        to={`/messages/new?context_id=course_${courseId}&user_id=${p.id}`}
                        aria-label={t('Message {name}', { name: p.name })}
                        className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                      >
                        {t('Message')}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > limit && (
            <button onClick={() => setLimit((n) => n + ROWS_PAGE)} className="mt-2 text-sm text-accent-700 hover:underline dark:text-accent-300">
              {t('Show more ({n} more)', { n: shown.length - limit })}
            </button>
          )}
        </div>
      )}
      {othersHidden && (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          {hasId || hasEmail
            ? t('Your school’s Canvas does not show students other people’s student IDs or emails, so only yours is listed.')
            : t('Your school’s Canvas does not show students other people’s student IDs or emails.')}
        </p>
      )}
    </Card>
  );
}
