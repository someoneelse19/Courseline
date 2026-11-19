import type { CanvasId } from '../api/types';
import { useFileViewer } from '../context/FileViewerContext';
import { formatBytes } from '../lib/format';
import { attachmentKind, type AttachmentKind } from '../lib/messages';
import { t } from '../i18n';

// Files shown the way Messages shows them: images as thumbnails, other files as cards (a kind icon, the name, the
// size), all opening in the in-app viewer. Used for message attachments, an assignment's files, what you handed in and
// the files on feedback comments.

export interface AttachmentLike {
  id: CanvasId | string;
  display_name: string;
  /** Without one (the extension version leaves signed links out) the card calls `onMissing` instead. */
  url?: string;
  thumbnail_url?: string | null;
  'content-type'?: string;
  mime_class?: string;
  size?: number;
}

const KIND_ICON: Record<AttachmentKind, string> = { image: '🖼️', pdf: '📕', doc: '📝', sheet: '📊', slides: '📽️', code: '💻', video: '🎬', audio: '🎵', archive: '🗜️', file: '📄' };

/**
 * `tone`: `plain` on a page or card (bordered), `bubble` inside someone else's message bubble, `mine` inside your own
 * (accent-colored) one. `thumbnails`: show images as pictures; only for signed links (a plain Canvas file link needs a
 * session to load as an image, so those stay cards).
 */
export function Attachments({
  list,
  tone = 'plain',
  thumbnails = true,
  onMissing,
}: {
  list: AttachmentLike[];
  tone?: 'plain' | 'bubble' | 'mine';
  thumbnails?: boolean;
  onMissing?: () => void;
}) {
  const { openFile } = useFileViewer();
  const images = thumbnails ? list.filter((a) => attachmentKind(a) === 'image' && a.url) : [];
  const others = list.filter((a) => !images.includes(a));
  const open = (a: AttachmentLike) => {
    if (a.url) openFile(a.url, a.display_name, a['content-type']);
    else onMissing?.();
  };
  const card =
    tone === 'mine'
      ? 'bg-white/15 hover:bg-white/25'
      : tone === 'bubble'
        ? 'bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-950'
        : 'border border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800';
  return (
    <div className="space-y-1.5">
      {images.length > 0 && (
        <div className={`grid gap-1.5 ${images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {images.map((a) => (
            <button
              key={String(a.id)}
              type="button"
              onClick={() => open(a)}
              title={a.display_name}
              className="block overflow-hidden rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              <img src={a.thumbnail_url || a.url} alt={a.display_name} loading="lazy" className="max-h-64 w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {others.map((a) => {
        const meta = [a.size ? formatBytes(a.size) : null, a.url ? null : t('Open in Canvas')].filter(Boolean).join(' · ');
        return (
        <button
          key={String(a.id)}
          type="button"
          onClick={() => open(a)}
          title={a.url ? t('Open {name}', { name: a.display_name }) : t('Open in Canvas to see this file')}
          className={`flex w-full min-w-[12rem] items-center gap-2.5 rounded-xl px-3 py-2 text-left ${card}`}
        >
          <span aria-hidden className="text-xl">
            {KIND_ICON[attachmentKind(a)]}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{a.display_name}</span>
            {meta && <span className={`block text-[11px] ${tone === 'mine' ? 'text-white/80' : 'text-neutral-500 dark:text-neutral-400'}`}>{meta}</span>}
          </span>
        </button>
        );
      })}
    </div>
  );
}
