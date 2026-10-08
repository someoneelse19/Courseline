import { useRef, useState, type FormEvent } from 'react';
import type { Assignment } from '../api/types';
import { useApi } from '../context/AuthContext';
import { cleanEditorHtml, isEditorEmpty, RichTextEditor } from './RichTextEditor';
import { Card, ErrorMessage } from './ui';
import { t } from '../i18n';

interface SubmissionFormProps {
  courseId: number;
  assignmentId: number;
  assignment: Assignment;
  onSubmitted?: () => void;
}

// One picked file. `uploadedId` is set once Canvas has confirmed the upload, so a retry after a
// failed submit never uploads the same file twice.
interface PickedFile {
  key: number;
  file: File;
  uploadedId?: number;
  status: 'ready' | 'uploading' | 'uploaded' | 'error';
  error?: string;
}

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export function SubmissionForm({ courseId, assignmentId, assignment, onSubmitted }: SubmissionFormProps) {
  const api = useApi();
  const [tab, setTab] = useState<'upload' | 'text'>('upload');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const nextKey = useRef(0);

  const types = assignment.submission_types ?? [];
  const canUpload = types.includes('online_upload');
  const canText = types.includes('online_text_entry');
  const allowed = (assignment.allowed_extensions ?? []).map((e) => e.toLowerCase().replace(/^\./, ''));

  if (!canUpload && !canText) return null;
  // Whichever tab is not offered must not be the active one.
  const activeTab = tab === 'upload' && !canUpload ? 'text' : tab === 'text' && !canText ? 'upload' : tab;

  const update = (key: number, patch: Partial<PickedFile>) => setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next: PickedFile[] = Array.from(picked).map((file) => {
      const blocked = allowed.length > 0 && !allowed.includes(extensionOf(file.name));
      return {
        key: nextKey.current++,
        file,
        status: blocked ? 'error' : 'ready',
        error: blocked ? t('Not an allowed file type (allowed: {allowed})', { allowed: allowed.join(', ') }) : undefined,
      };
    });
    setFiles((prev) => [...prev, ...next]);
  };

  const removeFile = (key: number) => setFiles((prev) => prev.filter((f) => f.key !== key));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (activeTab === 'upload') {
        if (files.some((f) => f.status === 'error' && !f.uploadedId && f.error?.startsWith('Not an allowed'))) {
          throw new Error(t('Remove the files with the wrong type, then submit again.'));
        }
        // Upload one at a time (gentle on Canvas's rate limit); skip anything already uploaded.
        const ids: number[] = [];
        let failed = 0;
        for (const item of files) {
          if (item.uploadedId !== undefined) {
            ids.push(item.uploadedId);
            continue;
          }
          update(item.key, { status: 'uploading', error: undefined });
          try {
            const uploaded = await api.uploadSubmissionFile(courseId, assignmentId, item.file);
            ids.push(uploaded.id);
            update(item.key, { status: 'uploaded', uploadedId: uploaded.id });
          } catch (err) {
            failed++;
            update(item.key, { status: 'error', error: err instanceof Error ? err.message : t('Upload failed') });
          }
        }
        if (failed > 0) throw new Error(failed === 1 ? t('1 file could not be uploaded, so nothing was submitted. Fix or remove it and submit again.') : t('{n} files could not be uploaded, so nothing was submitted. Fix or remove them and submit again.', { n: failed }));
        if (ids.length === 0) throw new Error(t('Choose at least one file.'));
        await api.submitAssignment(courseId, assignmentId, { submission_type: 'online_upload', file_ids: ids });
        setFiles([]);
        onSubmitted?.();
      } else {
        if (isEditorEmpty(text)) throw new Error(t('Write something to submit.'));
        await api.submitAssignment(courseId, assignmentId, { submission_type: 'online_text_entry', body: cleanEditorHtml(text) });
        setText('');
        onSubmitted?.();
      }
    } catch (err) {
      setError(err as Error);
    } finally {
      setSubmitting(false);
    }
  };

  const tabClass = (active: boolean) =>
    `px-3 py-2 text-sm font-medium ${active ? 'border-b-2 border-accent-600 text-accent-700 dark:text-accent-300' : 'text-neutral-600 dark:text-neutral-400'}`;
  const canSubmit = activeTab === 'upload' ? files.length > 0 : !isEditorEmpty(text);

  return (
    <Card title={t('Submit assignment')}>
      <div className="mb-4 flex gap-2 border-b border-neutral-200 dark:border-neutral-800">
        {canUpload && (
          <button type="button" onClick={() => setTab('upload')} className={tabClass(activeTab === 'upload')}>
            📁 {t('File upload')}
          </button>
        )}
        {canText && (
          <button type="button" onClick={() => setTab('text')} className={tabClass(activeTab === 'text')}>
            📝 {t('Text entry')}
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {activeTab === 'upload' && (
          <>
            <label className="block cursor-pointer rounded-lg border-2 border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
              <span className="font-medium text-accent-600 dark:text-accent-400">{t('Click to choose files')}</span>
              <input
                type="file"
                multiple
                aria-label={t('Choose files to submit')}
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = ''; // lets the same file be picked again after removing it
                }}
                className="hidden"
              />
            </label>

            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.file.name}</p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">{megabytes(item.file.size)} MB</p>
                      {item.status === 'uploading' && <p className="text-xs text-accent-600 dark:text-accent-400">{t('Uploading…')}</p>}
                      {item.status === 'uploaded' && <p className="text-xs text-green-700 dark:text-green-400">✓ {t('Uploaded')}</p>}
                      {item.status === 'error' && <p className="text-xs text-red-700 dark:text-red-400">{item.error}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(item.key)}
                      disabled={item.status === 'uploading'}
                      aria-label={t('Remove {name}', { name: item.file.name })}
                      className="ml-2 shrink-0 rounded-sm px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-200 disabled:opacity-50 dark:hover:bg-neutral-700"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {activeTab === 'text' && (
          <RichTextEditor value={text} onChange={setText} ariaLabel={t('Your submission')} placeholder={t('Write your submission here…')} />
        )}

        {error && <ErrorMessage error={error} />}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !canSubmit}
            className="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
          >
            {submitting ? t('Submitting…') : t('Submit')}
          </button>
          {activeTab === 'upload' && allowed.length > 0 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('Allowed: {allowed}', { allowed: allowed.join(', ') })}</p>
          )}
        </div>
      </form>
    </Card>
  );
}
