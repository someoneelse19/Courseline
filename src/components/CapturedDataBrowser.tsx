import { useMemo, useState } from 'react';
import { buildCaptureExport, groupCaptured, previewJson } from '../extension/capturedData';
import type { Snapshot } from '../extension/bridge';
import { t } from '../i18n';
import { formatAgo } from '../lib/format';

/** Everything the extension captured, by kind or address, with the raw JSON one click away and a download. */
export function CapturedDataBrowser({ snapshot }: { snapshot: Snapshot }) {
  const groups = useMemo(() => groupCaptured(snapshot.records), [snapshot.records]);
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const download = () => {
    const blob = new Blob([JSON.stringify(buildCaptureExport(snapshot), null, 1)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `courseline-capture-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (groups.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('Nothing captured yet.')}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {t('{n} responses in {groups} kinds of data.', { n: snapshot.records.length, groups: groups.length })}
        </p>
        <button
          type="button"
          onClick={download}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {t('Download everything (JSON)')}
        </button>
      </div>

      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {groups.map((g) => (
          <li key={g.label}>
            <button
              type="button"
              aria-expanded={open === g.label}
              onClick={() => {
                setOpen(open === g.label ? null : g.label);
                setPicked(null);
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{g.label}</span>
              <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                {g.read ? t('shown in Courseline') : t('saved only')}
              </span>
              <span className="shrink-0 text-xs tabular-nums">×{g.count}</span>
              <span className="w-24 shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400">{formatAgo(g.lastAt)}</span>
            </button>
            {open === g.label && (
              <div className="space-y-2 bg-neutral-50 px-3 py-2 dark:bg-neutral-950">
                <ul className="max-h-40 space-y-0.5 overflow-auto text-xs">
                  {g.records.map((r) => (
                    <li key={r.url + r.capturedAt}>
                      <button
                        type="button"
                        onClick={() => setPicked(picked === r.url ? null : r.url)}
                        className={`w-full truncate text-left font-mono ${picked === r.url ? 'font-bold' : 'text-neutral-600 hover:underline dark:text-neutral-300'}`}
                      >
                        {r.url.replace(/^https:\/\/[^/]+/, '')}
                      </button>
                    </li>
                  ))}
                </ul>
                {picked && (() => {
                  const rec = g.records.find((r) => r.url === picked);
                  if (!rec) return null;
                  const { text, truncated } = previewJson(rec.body);
                  return (
                    <div>
                      <pre className="max-h-72 overflow-auto rounded-md bg-white p-2 text-xs dark:bg-neutral-900">{text}</pre>
                      {truncated && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('Shortened here. The download has the whole response.')}</p>}
                    </div>
                  );
                })()}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
