import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CoursePerson } from '../api/types';
import { Card, EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useCoursePeople } from '../hooks/useCanvasData';
import { t } from '../i18n';

// The "People" tab of a course: its teachers, TAs and students, each with a Message button (Messages' compose, with
// the course and the person filled in). Student id and email show only where Canvas gives them to the student: many
// schools do not (permissions read_sis / view_user_logins), and then only the student's own row has them, from their
// profile.

function roleLabel(role: string | undefined): string {
  return role === 'teacher' ? t('Teacher') : role === 'ta' ? t('TA') : t('Student');
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

export function CoursePeoplePage() {
  const courseId = Number(useParams().courseId);
  const people = useCoursePeople(courseId);
  const { user } = useAuth();
  const [query, setQuery] = useState('');

  // The student's own row: what their profile knows (their email, and their login, which is the student id at many schools).
  const rows = useMemo(
    () =>
      (people.data ?? []).map((p) =>
        user && p.id === user.id ? { ...p, email: p.email ?? user.primary_email, student_id: p.student_id ?? user.login_id, self: true } : { ...p, self: false },
      ),
    [people.data, user],
  );

  if (people.error) return <ErrorMessage error={people.error} onRetry={people.refetch} />;
  if (!people.data) return <Spinner />;

  const q = query.trim().toLowerCase();
  const shown = rows.filter((p) => !q || `${p.name} ${p.email ?? ''} ${p.student_id ?? ''}`.toLowerCase().includes(q));
  const hasId = rows.some((p) => p.student_id);
  const hasEmail = rows.some((p) => p.email);
  const othersHidden = !rows.some((p) => !p.self && (p.student_id || p.email));

  return (
    <Card
      title={t('People')}
      action={<span className="text-xs text-neutral-500 dark:text-neutral-400">{t('{n} people', { n: rows.length })}</span>}
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('Search people…')}
        aria-label={t('Search people…')}
        className="mb-3 w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
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
              {shown.map((p) => (
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
