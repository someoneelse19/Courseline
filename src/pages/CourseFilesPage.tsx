import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CourseFile, Module, ModuleItem } from '../api/types';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useApi, useAuth } from '../context/AuthContext';
import { useCourseFiles, useModules, usePage } from '../hooks/useCanvasData';
import { useFileViewer } from '../context/FileViewerContext';
import { formatBytes, formatDay } from '../lib/format';
import { linkedFiles } from '../lib/html';

// The "Files by unit" tab. Header + tabs come from CourseLayout.
// "Units" are Canvas modules. Unit order and item order are the instructor's own
// (module.position / item.position), so we keep them rather than re-sorting.
// Files are matched to module items via item.content_id === file.id; files that
// live in the Files area but aren't in any unit go in a final "Not in a unit" group.

type Mode = 'files' | 'all';

const icons: Record<string, string> = {
  File: '📄',
  Page: '📃',
  Assignment: '📝',
  Quiz: '❓',
  Discussion: '💬',
  ExternalUrl: '🔗',
  ExternalTool: '🧩',
};

export function CourseFilesPage() {
  const courseId = Number(useParams().courseId);
  const modules = useModules(courseId);
  const files = useCourseFiles(courseId);
  const [mode, setMode] = useState<Mode>('files');
  const [query, setQuery] = useState('');

  if (modules.error) return <ErrorMessage error={modules.error} onRetry={modules.refetch} />;
  if (files.error) return <ErrorMessage error={files.error} onRetry={files.refetch} />;
  if (!modules.data || files.data === undefined) return <Spinner />;

  const fileById = new Map((files.data ?? []).map((f) => [f.id, f]));
  const q = query.trim().toLowerCase();
  const wanted = (item: ModuleItem) => {
    if (mode === 'files' && item.type !== 'File' && item.type !== 'Page') return false;
    return !q || item.title.toLowerCase().includes(q);
  };

  const units = modules.data
    .map((m) => ({ module: m, items: (m.items ?? []).filter(wanted) }))
    // In files mode, headers alone don't justify showing a unit.
    .filter((u) => u.items.some((i) => i.type !== 'SubHeader'));

  const usedFileIds = new Set(modules.data.flatMap((m) => (m.items ?? []).filter((i) => i.type === 'File').map((i) => i.content_id)));
  const loose = (files.data ?? []).filter((f) => !usedFileIds.has(f.id) && (!q || f.display_name.toLowerCase().includes(q)));
  const hiddenUnits = modules.data.length - units.length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="files">Files only</option>
          <option value="all">Everything in each unit</option>
        </select>
      </div>

      {modules.data.length === 0 && <EmptyState>This course doesn’t use units (modules), so there’s nothing to group by.</EmptyState>}
      {files.data === null && (
        <p className="mb-3 rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This course hides its Files area, so only files linked from units are shown (without size/date details).
        </p>
      )}

      <div className="space-y-3">
        {units.map(({ module, items }) => (
          <Unit key={module.id} module={module} items={items} courseId={courseId} fileById={fileById} />
        ))}

        {mode === 'files' && loose.length > 0 && (
          <details open className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <summary className="cursor-pointer px-4 py-3 font-semibold">
              Not in a unit <span className="font-normal text-neutral-500 dark:text-neutral-400">· {loose.length}</span>
            </summary>
            <ul className="divide-y divide-neutral-200 px-4 dark:divide-neutral-800">
              {loose.map((f) => (
                <FileRow key={f.id} courseId={courseId} title={f.display_name} file={f} />
              ))}
            </ul>
          </details>
        )}
      </div>

      {modules.data.length > 0 && units.length === 0 && loose.length === 0 && <EmptyState>Nothing matches.</EmptyState>}
      {hiddenUnits > 0 && units.length > 0 && !q && (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          {hiddenUnits} unit{hiddenUnits !== 1 ? 's' : ''} hidden because they contain no files. Switch to “Everything” to see them.
        </p>
      )}
    </>
  );
}

function Unit({ module, items, courseId, fileById }: { module: Module; items: ModuleItem[]; courseId: number; fileById: Map<number, CourseFile> }) {
  const count = items.filter((i) => i.type !== 'SubHeader').length;
  return (
    <details open className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <summary className="cursor-pointer px-4 py-3 font-semibold">
        {module.name} <span className="font-normal text-neutral-500 dark:text-neutral-400">· {count}</span>
        {module.state === 'locked' && <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">🔒 locked</span>}
      </summary>
      <UnitItems items={items} courseId={courseId} fileById={fileById} className="px-4" />
    </details>
  );
}

/** The rows of one unit (module). Shared by Files-by-unit and the Pages tab. */
export function UnitItems({
  items,
  courseId,
  fileById,
  className = '',
}: {
  items: ModuleItem[];
  courseId: number;
  fileById: Map<number, CourseFile>;
  className?: string;
}) {
  return (
    <ul className={`divide-y divide-neutral-200 dark:divide-neutral-800 ${className}`}>
      {items.map((item) => {
        if (item.type === 'SubHeader')
          return (
            <li key={item.id} className="py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {item.title}
            </li>
          );
        if (item.type === 'File')
          return <FileRow key={item.id} courseId={courseId} title={item.title} file={fileById.get(item.content_id ?? -1)} item={item} />;
        return <ItemRow key={item.id} item={item} courseId={courseId} />;
      })}
    </ul>
  );
}

function rowShell(icon: string, indent: number, body: ReactNode, meta?: string) {
  return (
    <li className="flex items-center gap-3 py-2.5 text-sm" style={{ paddingLeft: indent * 16 }}>
      <span aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        {body}
        {meta && <span className="block text-xs text-neutral-500 dark:text-neutral-400">{meta}</span>}
      </span>
    </li>
  );
}

// Links go to Canvas's own file page (/courses/:courseId/files/:fileId?module_item_id=:itemId), which
// the viewer resolves through the API. Built from the module item (content_id is the file id), so it
// works even when the course hides its Files area and we have no file metadata.
function FileRow({ courseId, title, file, item }: { courseId: number; title: string; file?: CourseFile; item?: ModuleItem }) {
  const { openFile } = useFileViewer();
  const { baseUrl } = useAuth();
  const api = useApi();
  const fileId = item ? item.content_id : file?.id;
  const href = fileId ? (baseUrl ? `${baseUrl}/courses/${courseId}/files/${fileId}${item ? `?module_item_id=${item.id}` : ''}` : undefined) : item?.html_url;
  const locked = file?.locked || item?.content_details?.locked_for_user;
  const size = file?.size ?? item?.content_details?.size;
  const meta = [formatBytes(size), formatDay(file?.updated_at)].filter(Boolean).join(' · ');
  // `title` is the unit's own label for the item (instructors rename items), which is what
  // Canvas shows in modules; for loose files the caller passes the file's display name.
  const name = title;
  const body =
    locked || !href ? (
      <span className="text-neutral-500 dark:text-neutral-400">
        {name} {locked && '🔒'}
      </span>
    ) : (
      <button
        type="button"
        onClick={() => {
          openFile(href, name);
          // Canvas used to count a module-item click as "viewed" (for must-view requirements); keep that.
          if (item) api.markModuleItemRead(courseId, item.module_id, item.id).catch(() => {});
        }}
        className="text-left font-medium hover:underline"
      >
        {name}
      </button>
    );
  return rowShell(icons.File, item?.indent ?? 0, body, meta);
}

function ItemRow({ item, courseId }: { item: ModuleItem; courseId: number }) {
  const indent = item.indent ?? 0;
  const icon = icons[item.type] ?? '•';

  // Pages: fetch content and extract embedded files (slug comes from page_url, not html_url)
  if (item.type === 'Page' && item.page_url)
    return <PageItemRow key={item.id} item={item} courseId={courseId} pageUrl={item.page_url} indent={indent} />;

  // Assignments have an in-app page; everything else opens in Canvas.
  if (item.type === 'Assignment' && item.content_id)
    return rowShell(icon, indent, (
      <Link to={`/courses/${courseId}/assignments/${item.content_id}`} className="font-medium hover:underline">
        {item.title}
      </Link>
    ));
  const href = item.external_url ?? item.html_url;
  return rowShell(
    icon,
    indent,
    href ? (
      <a href={href} target="_blank" rel="noreferrer" className="font-medium hover:underline">
        {item.title} <span className="text-neutral-400">↗</span>
      </a>
    ) : (
      <span>{item.title}</span>
    ),
  );
}

function PageItemRow({ item, courseId, pageUrl, indent }: { item: ModuleItem; courseId: number; pageUrl: string; indent: number }) {
  const { openFile } = useFileViewer();
  const page = usePage(courseId, pageUrl);
  const body = page.data?.body ?? '';
  const files = useMemo(() => linkedFiles(body), [body]);

  return (
    <>
      {rowShell(
        icons.Page,
        indent,
        <a href={item.html_url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
          {item.title} <span className="text-neutral-400">↗</span>
        </a>,
      )}
      {files.map((file) => (
        <li key={file.id} className="flex items-center gap-3 py-2.5 text-sm" style={{ paddingLeft: (indent + 1) * 16 }}>
          <span aria-hidden>📄</span>
          <span className="min-w-0 flex-1">
            <button type="button" onClick={() => openFile(file.url, file.name)} className="text-left font-medium hover:underline">
              {file.name}
            </button>
          </span>
        </li>
      ))}
    </>
  );
}
