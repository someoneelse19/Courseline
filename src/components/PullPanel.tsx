import { usePull, type PullRow } from '../context/PullContext';
import { estimateSeconds } from '../extension/pullPlan';
import { t, tn } from '../i18n';

const button = 'rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800';
const primary = 'rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700';

function RowLine({ row }: { row: PullRow }) {
  const glyph = row.state === 'done' ? '✓' : row.state === 'error' ? '!' : row.state === 'visiting' ? '…' : '·';
  const tone =
    row.state === 'error' ? 'text-red-700 dark:text-red-300' : row.state === 'done' ? 'text-neutral-800 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400';
  const samples = row.items.flatMap((i) => i.sample).slice(0, 3);
  return (
    <li className={`flex gap-2 py-1 text-xs ${tone}`}>
      <span aria-hidden="true" className="w-3 shrink-0 text-center font-bold">{glyph}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{row.step.label}</p>
        {row.state === 'visiting' && <p>{t('Loading in the background…')}</p>}
        {row.state === 'error' && <p>{row.error}</p>}
        {row.state === 'done' && (
          <p className="truncate">
            {row.captured > 0 ? tn(row.captured, '{n} response', '{n} responses') : t('No data on this page')}
            {samples.length > 0 && ` · ${samples.join(', ')}`}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * The preview and the confirmation, inside the app. Bottom-right, never blocks the page. Phases: confirm (the plan,
 * Start and Cancel), running (a live line per page, Stop), done (what happened).
 */
export function PullPanel() {
  const { state, setDepth, start, stop, close, requestDeepSync } = usePull();
  if (!state) return null;

  const done = state.rows.filter((r) => r.state === 'done' || r.state === 'error').length;
  const total = state.rows.length;
  const saved = state.rows.reduce((n, r) => n + r.captured, 0);
  const failed = state.rows.filter((r) => r.state === 'error').length;
  const empty = state.rows.filter((r) => r.state === 'done' && r.captured === 0).length;

  return (
    <aside
      role="dialog"
      aria-label={state.title}
      className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      <h2 className="text-sm font-semibold">{state.title}</h2>

      {state.phase === 'confirm' && (
        <div className="mt-2 space-y-3 text-sm">
          <p className="text-neutral-600 dark:text-neutral-300">
            {state.planCount === null
              ? t('Working out which pages to open…')
              : tn(
                  state.planCount,
                  'This will open {n} Canvas page, in a background tab of this window. It closes itself. About {min} min. The page opens as if you had visited it, so Canvas may record the visit (for example marking items as viewed).',
                  'This will open {n} Canvas pages, one at a time, in background tabs of this window. Each closes itself. About {min} min. Pages open as if you had visited them, so Canvas may record the visits (for example marking items as viewed).',
                  { min: Math.max(1, Math.round(estimateSeconds(state.planCount) / 60)) },
                )}
          </p>
          {state.planTotal !== null && state.planCount !== null && state.planTotal > state.planCount && (
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              {t('{total} pages found; this run opens the first {n}. Run it again for the rest.', { total: state.planTotal, n: state.planCount })}
            </p>
          )}
          {state.depthChoice && (
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={state.depth === 'essential'} onChange={(e) => setDepth(e.target.checked ? 'essential' : 'everything')} className="mt-0.5" />
              <span>{t('Essentials only (faster): assignments, grades, units and pages')}</span>
            </label>
          )}
          {state.message && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{state.message}</p>}
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={state.planCount === null} onClick={start}>
              {t('Start')}
            </button>
            <button type="button" className={button} onClick={close}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}

      {state.phase === 'running' && (
        <div className="mt-2 space-y-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div className="h-full bg-accent-600 transition-[width]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <p role="status" className="text-xs text-neutral-600 dark:text-neutral-300">
            {t('Page {done} of {total}', { done: Math.min(done + 1, total), total })}
            {state.message ? ` · ${state.message}` : ''}
          </p>
          <ul className="max-h-56 overflow-auto" aria-live="polite">
            {state.rows.map((r) => (
              <RowLine key={r.step.url + r.step.label} row={r} />
            ))}
          </ul>
          <button type="button" className={button} onClick={stop}>
            {t('Stop')}
          </button>
        </div>
      )}

      {state.phase === 'done' && (
        <div className="mt-2 space-y-2 text-sm">
          <p role="status">
            {state.cancelled ? t('Stopped.') : t('Done.')}{' '}
            {total > 0 && t('Visited {done} of {total} pages and saved {n} responses.', { done, total, n: saved })}
          </p>
          {state.message && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{state.message}</p>}
          {empty > 0 && (
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              {t('{n} pages showed no data. They may be hidden in that course, or you may be signed out of Canvas.', { n: empty })}
            </p>
          )}
          {failed > 0 && <p className="text-xs text-red-700 dark:text-red-300">{t('{n} failed to load.', { n: failed })}</p>}
          <ul className="max-h-40 overflow-auto">
            {state.rows.map((r) => (
              <RowLine key={r.step.url + r.step.label} row={r} />
            ))}
          </ul>
          {state.remaining !== null && state.remaining > 0 && (
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              {tn(state.remaining, '{n} more linked page has not been opened yet (assignment instructions, page bodies, discussions…).', '{n} more linked pages have not been opened yet (assignment instructions, page bodies, discussions…).')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {state.remaining !== null && state.remaining > 0 && !state.cancelled && (
              <button type="button" className={primary} onClick={requestDeepSync}>
                {t('Pull linked pages')}
              </button>
            )}
            <button type="button" className={state.remaining ? button : primary} onClick={close}>
              {t('Close')}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
