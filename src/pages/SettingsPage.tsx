import { useEffect, useState } from 'react';
import { CanvasConnection } from '../components/CanvasConnection';
import { CapturedDataBrowser } from '../components/CapturedDataBrowser';
import { TokenForm } from '../components/TokenForm';
import { useAuth } from '../context/AuthContext';
import { usePull } from '../context/PullContext';
import { extensionInstalled } from '../extension/bridge';
import { useExtensionSetup } from '../extension/useExtensionSetup';
import { useSearchParams } from 'react-router-dom';
import { Card, EmptyState, ErrorMessage, PageTitle, Spinner } from '../components/ui';
import { useCourseFilter } from '../context/CourseFilterContext';
import { useTheme } from '../context/ThemeContext';
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../lib/accent';
import { CourseIconShape } from '../components/icons';
import { useCourseStyles } from '../context/CourseStyleContext';
import { useCourseColors, useCourseIcons, useCourses, useVisibleCourses } from '../hooks/useCanvasData';
import { COURSE_ICON_KEYS, COURSE_ICON_LABELS } from '../lib/courseIcons';
import { t, LANGUAGES, type Language } from '../i18n';
import { useLanguage } from '../context/LanguageContext';

// Sections are grouped into tabs so the page stays short. The open tab lives in the URL
// (/settings?tab=courses) so it can be linked to and survives a reload. Add a section: put its
// card in the right tab below, or add a tab to TABS.
type Tab = 'connection' | 'appearance' | 'courses';
const TABS: { id: Tab; label: string }[] = [
  { id: 'connection', label: 'Connection' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'courses', label: 'Courses' },
];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  // With the extension installed, the first thing to look at is the connection; otherwise Appearance, as before.
  const fallback: Tab = extensionInstalled() ? 'connection' : 'appearance';
  const asked = params.get('tab');
  const tab: Tab = TABS.some((x) => x.id === asked) ? (asked as Tab) : fallback;

  return (
    <>
      <PageTitle>{t('Settings')}</PageTitle>
      <div role="tablist" className="mb-6 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setParams(x.id === fallback ? {} : { tab: x.id }, { replace: true })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === x.id
                ? 'border-accent-600 text-accent-700 dark:border-accent-400 dark:text-accent-300'
                : 'border-transparent text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
            }`}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      <div className="space-y-6">
        {tab === 'connection' ? (
          <ConnectionTab />
        ) : tab === 'appearance' ? (
          <>
            <LanguagePicker />
            <ThemePicker />
            <AccentPicker />
          </>
        ) : (
          <>
            <CourseStylePicker />
            <CoursePicker />
          </>
        )}
      </div>
    </>
  );
}

// How Courseline gets your Canvas data, and everything to set it up: the extension, the Canvas address, a sync, and
// the alternative of an access token.
function PullAPage() {
  const { pullAddress, running } = usePull();
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title={t('Pull a page')}>
      <p className="-mt-1 mb-3 text-sm text-neutral-500 dark:text-neutral-400">
        {t('Paste any page from your Canvas (or a path like /courses/12/announcements). It loads in a background tab and what it brings in is saved.')}
      </p>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(await pullAddress(address));
        }}
      >
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="https://yourschool.instructure.com/courses/12/announcements"
          aria-label={t('Canvas page address')}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
        <button
          disabled={running || !address.trim()}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {t('Pull')}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p>}
    </Card>
  );
}

function ConnectionTab() {
  const { source, baseUrl, enableExtension, logout } = useAuth();
  const setup = useExtensionSetup();
  const { requestSync } = usePull();
  const [params, setParams] = useSearchParams();
  const usingExtension = source === 'extension';

  // The extension's "Sync in Courseline" button lands here with ?sync=1: show the plan to confirm.
  useEffect(() => {
    if (params.get('sync') !== '1') return;
    requestSync();
    const next = new URLSearchParams(params);
    next.delete('sync');
    setParams(next, { replace: true });
  }, [params, requestSync, setParams]);

  return (
    <>
      <Card title={t('How Courseline gets your data')}>
        <p className="text-sm">
          {usingExtension
            ? t('Right now: the Courseline browser extension. No access token is stored.')
            : t('Right now: an access token for {host}.', { host: baseUrl ?? '—' })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {!usingExtension && (
            <button
              type="button"
              disabled={!setup.installed || setup.recordCount === 0}
              onClick={enableExtension}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {t('Use the extension instead')}
            </button>
          )}
          <button
            type="button"
            onClick={logout}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {t('Log out')}
          </button>
        </div>
        {!usingExtension && (!setup.installed || setup.recordCount === 0) && (
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            {t('Set up the extension below first; this switches as soon as it has your data.')}
          </p>
        )}
      </Card>

      <Card title={t('Browser extension')}>
        <CanvasConnection variant="settings" />
      </Card>

      {setup.installed && <PullAPage />}

      {setup.installed && setup.snapshot && (
        <Card title={t('Everything captured')}>
          <p className="-mt-1 mb-3 text-sm text-neutral-500 dark:text-neutral-400">
            {t('Every response Canvas’s own pages loaded, saved on this computer. Courseline shows some of it; the rest is kept so nothing is lost.')}
          </p>
          <CapturedDataBrowser snapshot={setup.snapshot} />
        </Card>
      )}

      {usingExtension && (
        <Card title={t('Use an access token instead')}>
          <p className="-mt-1 mb-3 text-sm text-neutral-500 dark:text-neutral-400">
            {t('A token gives full access, including opening files and submitting work, which the extension cannot do.')}
          </p>
          <TokenForm />
        </Card>
      )}
    </>
  );
}

function LanguagePicker() {
  const { language, setLanguage } = useLanguage();
  return (
    <Card title={t('Language')}>
      <p className="-mt-1 mb-3 text-sm text-neutral-500 dark:text-neutral-400">
        {t('Saved in this browser. Defaults to your browser’s language.')}
      </p>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
        aria-label={t('Language')}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </Card>
  );
}

function ThemePicker() {
  const { theme, toggle } = useTheme();
  return (
    <Card title={t('Theme')}>
      <p className="-mt-1 mb-3 text-sm text-neutral-500 dark:text-neutral-400">
        {t('Saved in this browser. Defaults to your system setting.')}
      </p>
      <button
        type="button"
        onClick={toggle}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        {theme === 'dark' ? t('☀️ Light mode') : t('🌙 Dark mode')}
      </button>
    </Card>
  );
}

function AccentPicker() {
  const { accent, setAccent } = useTheme();
  const current = (accent ?? DEFAULT_ACCENT).toLowerCase();
  return (
    <Card title={t('Accent color')}>
      <p className="-mt-1 mb-3 text-sm text-neutral-500 dark:text-neutral-400">
        {t('Used for links, buttons and the active tab. Saved in this browser.')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.hex}
            type="button"
            title={t(p.name)}
            aria-label={t(p.name)}
            aria-pressed={current === p.hex}
            onClick={() => setAccent(p.hex === DEFAULT_ACCENT ? null : p.hex)}
            style={{ backgroundColor: p.hex }}
            className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-neutral-900 ${
              current === p.hex ? 'ring-2 ring-neutral-900 dark:ring-white' : 'hover:ring-2 hover:ring-neutral-400'
            }`}
          />
        ))}
        <label className="ml-2 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="color"
            aria-label={t('Custom accent color')}
            value={current}
            onChange={(e) => setAccent(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded-sm border border-neutral-300 bg-transparent p-0.5 dark:border-neutral-700"
          />
          {t('Custom')}
        </label>
        {accent && (
          <button
            type="button"
            onClick={() => setAccent(null)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {t('Reset')}
          </button>
        )}
      </div>
    </Card>
  );
}

function CoursePicker() {
  const { data, error, refetch } = useCourses(); // full list, unfiltered
  const { selected, setSelected } = useCourseFilter();
  const [query, setQuery] = useState('');

  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!data) return <Spinner />;

  const checked = (id: number) => selected === null || selected.has(id);
  const current = new Set(selected ?? data.map((c) => c.id));

  const toggle = (id: number) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const q = query.trim().toLowerCase();
  const shown = data.filter((c) => !q || `${c.name} ${c.course_code ?? ''} ${c.term?.name ?? ''}`.toLowerCase().includes(q));
  const count = data.filter((c) => checked(c.id)).length;

  const btn = 'rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800';

  return (
    <Card title={t('Choose your courses')}>
      <p className="-mt-1 mb-3 text-sm text-neutral-500 dark:text-neutral-400">
        {t('Only ticked courses appear on the dashboard, courses, assignments and grades pages. Saved in this browser.')}
      </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search courses…')}
            className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
          {/* Select all / none act on the search results, so you can bulk-pick e.g. a term. */}
          <button className={btn} onClick={() => setSelected([...current, ...shown.map((c) => c.id)])}>
            {q ? t('Select matching') : t('Select all')}
          </button>
          <button className={btn} onClick={() => { const drop = new Set(shown.map((c) => c.id)); setSelected([...current].filter((id) => !drop.has(id))); }}>
            {q ? t('Clear matching') : t('Clear all')}
          </button>
          <button className={btn} onClick={() => setSelected(null)}>
            {t('Show everything')}
          </button>
        </div>

        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
          {t('{count} of {total} selected', { count, total: data.length })}
        </p>

        {shown.length === 0 ? (
          <EmptyState>{t('No courses match.')}</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {shown.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-3 py-2.5">
                  <input type="checkbox" checked={checked(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 accent-accent-600" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {[c.course_code, c.term?.name].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function CourseStylePicker() {
  const { data, error, refetch } = useVisibleCourses(); // only the courses chosen above
  const { styles, setStyle, reset } = useCourseStyles();
  const colorOf = useCourseColors();
  const iconOf = useCourseIcons();
  const [open, setOpen] = useState<number | null>(null);

  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!data) return <Spinner />;

  return (
    <Card title={t('Course colors and icons')}>
      <p className="-mt-1 mb-3 text-sm text-neutral-500 dark:text-neutral-400">
        {t('Pick how each of your selected courses looks in the sidebar, calendar and course cards. Saved in this browser.')}
      </p>
      {data.length === 0 && <EmptyState>{t('No courses selected. Tick some under “Choose your courses”.')}</EmptyState>}
      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {data.map((c) => {
          const name = c.name ?? c.course_code ?? `Course ${c.id}`;
          const customized = !!styles[c.id];
          return (
            <li key={c.id} className="py-2.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setOpen(open === c.id ? null : c.id)}
                  aria-expanded={open === c.id}
                  aria-label={t('Choose icon for {name}', { name })}
                  title={t('Choose icon')}
                  style={{ color: colorOf(c.id) }}
                  className="rounded-md border border-neutral-300 p-2 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  <CourseIconShape iconKey={iconOf(c.id)} className="h-5 w-5" />
                </button>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                <input
                  type="color"
                  aria-label={t('Color for {name}', { name })}
                  value={colorOf(c.id)}
                  onChange={(e) => setStyle(c.id, { color: e.target.value })}
                  className="h-8 w-10 cursor-pointer rounded-sm border border-neutral-300 bg-transparent p-0.5 dark:border-neutral-700"
                />
                <button
                  type="button"
                  disabled={!customized}
                  onClick={() => reset(c.id)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {t('Reset')}
                </button>
              </div>
              {open === c.id && (
                <div role="group" aria-label={t('Icons')} className="mt-2 flex flex-wrap gap-1.5">
                  {COURSE_ICON_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      title={t(COURSE_ICON_LABELS[key])}
                      aria-label={t(COURSE_ICON_LABELS[key])}
                      aria-pressed={iconOf(c.id) === key}
                      onClick={() => setStyle(c.id, { icon: key })}
                      style={{ color: colorOf(c.id) }}
                      className={`rounded-md border p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                        iconOf(c.id) === key ? 'border-neutral-900 dark:border-white' : 'border-neutral-300 dark:border-neutral-700'
                      }`}
                    >
                      <CourseIconShape iconKey={key} className="h-5 w-5" />
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
