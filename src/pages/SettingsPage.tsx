import { useState } from 'react';
import { Card, EmptyState, ErrorMessage, PageTitle, Spinner } from '../components/ui';
import { useCourseFilter } from '../context/CourseFilterContext';
import { useTheme } from '../context/ThemeContext';
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../lib/accent';
import { useCourses } from '../hooks/useCanvasData';
import { t, LANGUAGES, type Language } from '../i18n';
import { useLanguage } from '../context/LanguageContext';

export function SettingsPage() {
  return (
    <>
      <PageTitle>{t('Settings')}</PageTitle>
      <div className="space-y-6">
        <LanguagePicker />
        <ThemePicker />
        <AccentPicker />
        <CoursePicker />
      </div>
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
