import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, ErrorMessage } from '../components/ui';
import { useApi } from '../context/AuthContext';
import { t } from '../i18n';
import { buildExportZip, ExportCancelled, scanCourse, type ExportProgress, type ExportSummary, type ScanResult } from '../lib/courseExportRunner';
import { formatBytes } from '../lib/format';

// The "AI export" tab: gathers the course's text, pages, assignments and files into one zip a
// language model can use to teach the course (what goes in it: lib/courseExport.ts). Everything
// happens in the browser and the zip is saved to the user's computer; nothing is sent anywhere.

type Phase = 'idle' | 'scanning' | 'ready' | 'building' | 'done';

const SIZE_LIMITS_MB = [10, 25, 50, 100];

function progressText(p: ExportProgress | null): string {
  if (!p || p.stage === 'reading') return t('Reading the course…');
  if (p.stage === 'finding-files') return t('Finding files ({done} of {total})…', { done: p.done, total: p.total });
  if (p.stage === 'files') return t('Downloading files ({done} of {total}): {name}', { done: p.done, total: p.total, name: p.name });
  return t('Packing the zip…');
}

export function CourseExportPage() {
  const courseId = Number(useParams().courseId);
  const api = useApi();
  const [phase, setPhase] = useState<Phase>('idle');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<{ url: string; summary: ExportSummary } | null>(null);
  const [includeOriginals, setIncludeOriginals] = useState(true);
  const [withText, setWithText] = useState(true);
  const [limitMb, setLimitMb] = useState(25);
  const abort = useRef<AbortController | null>(null);

  // Stop any work and free the zip when leaving the tab or building again.
  const objectUrl = result?.url;
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  const run = async (work: (signal: AbortSignal) => Promise<void>, back: Phase) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    try {
      await work(controller.signal);
    } catch (err) {
      if (err instanceof ExportCancelled || controller.signal.aborted) setPhase(back);
      else {
        setError(err as Error);
        setPhase(back);
      }
    }
  };

  const startScan = () => {
    setPhase('scanning');
    setProgress(null);
    return run(async (signal) => {
      setScan(await scanCourse(api, courseId, setProgress, signal));
      setPhase('ready');
    }, 'idle');
  };

  const startBuild = () => {
    if (!scan) return;
    setPhase('building');
    setProgress(null);
    return run(async (signal) => {
      const { blob, summary } = await buildExportZip(api, scan, { includeOriginals, extractText: withText, maxFileBytes: limitMb * 1024 * 1024 }, setProgress, signal);
      setResult({ url: URL.createObjectURL(blob), summary });
      setPhase('done');
    }, 'ready');
  };

  const cancel = () => abort.current?.abort();
  const busy = phase === 'scanning' || phase === 'building';
  const totalBytes = scan?.files.reduce((sum, f) => sum + (f.size ?? 0), 0) ?? 0;
  const button = 'rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50';
  const secondary = 'rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800';

  return (
    <div className="space-y-6">
      <Card title={t('AI export')}>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {t('Collect everything in this course (syllabus, units, pages, assignments and files) into one folder an AI can use to teach you any concept in it. It is saved as a zip on your computer; nothing is uploaded anywhere.')}
        </p>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          {t('Your own grades and submissions are not included. Images are not included, only their descriptions.')}
        </p>

        {phase === 'idle' && (
          <button type="button" onClick={startScan} className={`${button} mt-4`}>
            {t('Scan course')}
          </button>
        )}

        {busy && (
          <div className="mt-4 space-y-3" role="status">
            <p className="text-sm">{progressText(progress)}</p>
            {progress && 'total' in progress && progress.total > 0 && (
              <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800">
                <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </div>
            )}
            <button type="button" onClick={cancel} className={secondary}>
              {t('Cancel')}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4">
            <ErrorMessage error={error} onRetry={phase === 'ready' ? startBuild : startScan} />
          </div>
        )}
      </Card>

      {scan && (phase === 'ready' || phase === 'done') && (
        <Card title={t('What was found')}>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <li>{t('{n} units', { n: scan.modules.filter((m) => (m.items ?? []).length > 0).length })}</li>
            <li>{t('{n} pages', { n: scan.pages.length })}</li>
            <li>{t('{n} assignments', { n: scan.assignments.length })}</li>
            <li>{t('{n} files ({size})', { n: scan.files.length, size: formatBytes(totalBytes) })}</li>
          </ul>
          {scan.warnings.length > 0 && (
            <div className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">{t('Some parts could not be read:')}</p>
              <ul className="mt-1 list-disc pl-5">
                {scan.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {phase === 'ready' && (
            <div className="mt-4 space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={withText} onChange={(e) => setWithText(e.target.checked)} className="h-4 w-4 accent-accent-600" />
                {t('Read the text out of files (PDF, Word, PowerPoint, Excel, text)')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeOriginals} onChange={(e) => setIncludeOriginals(e.target.checked)} className="h-4 w-4 accent-accent-600" />
                {t('Also include the original files')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                {t('Skip files larger than')}
                <select
                  value={limitMb}
                  onChange={(e) => setLimitMb(Number(e.target.value))}
                  aria-label={t('Largest file to include')}
                  className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {SIZE_LIMITS_MB.map((mb) => (
                    <option key={mb} value={mb}>
                      {mb} MB
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={startBuild} className={button}>
                {t('Build export')}
              </button>
            </div>
          )}
        </Card>
      )}

      {phase === 'done' && result && (
        <Card title={t('Your export is ready')}>
          <p className="text-sm">
            {t('{docs} documents, {originals} original files, text from {text} files.', {
              docs: result.summary.documents,
              originals: result.summary.originals,
              text: result.summary.textFiles,
            })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={result.url} download={result.summary.fileName} className={button}>
              ⬇ {t('Download {name}', { name: result.summary.fileName })}
            </a>
            <button type="button" onClick={() => setPhase('ready')} className={secondary}>
              {t('Change options')}
            </button>
          </div>
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            {t('Unzip it, then give the folder (or just ALL_TEXT.md) to your AI. README.md inside explains how.')}
          </p>
          {result.summary.notes.length > 0 && (
            <div className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">{t('Files that are missing or incomplete:')}</p>
              <ul className="mt-1 list-disc pl-5">
                {result.summary.notes.map((n) => (
                  <li key={n.name}>
                    {n.name}: {n.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
