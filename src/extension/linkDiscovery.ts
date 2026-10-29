// Finds the internal Canvas links inside everything that has been captured (assignment and page bodies, module
// items, discussion lists, "html_url" fields...), so each linked page can be opened and its own data captured.
// Pure: it only reads the snapshot.
import type { PullStep, Snapshot } from './bridge';
import { t } from '../i18n';

export type LinkKind = 'assignment' | 'page' | 'discussion' | 'quiz' | 'file' | 'moduleItem' | 'syllabus' | 'folder';

export interface DiscoveredLink {
  url: string;
  courseId: number;
  kind: LinkKind;
  /** The id or slug at the end of the address. */
  id: string;
  /** A name seen next to the link in the captured data, if any. */
  title: string | null;
}

const KIND_LABEL: Record<LinkKind, string> = {
  assignment: 'Assignment',
  page: 'Page',
  discussion: 'Discussion',
  quiz: 'Quiz',
  file: 'File',
  moduleItem: 'Unit item',
  syllabus: 'Syllabus',
  folder: 'Folder',
};

// Opened in this order within a course: what the screens need most first.
const ORDER: LinkKind[] = ['syllabus', 'assignment', 'page', 'discussion', 'quiz', 'moduleItem', 'folder', 'file'];

const LINK = /(?:https?:\/\/([a-z0-9.-]+(?::\d+)?))?\/courses\/(\d+)\/(assignments|pages|discussion_topics|announcements|quizzes|files|modules\/items)\/([A-Za-z0-9_%.-]+)/gi;

function kindOf(section: string, id: string): LinkKind | null {
  const numeric = /^\d+$/.test(id);
  switch (section.toLowerCase()) {
    case 'assignments':
      return id === 'syllabus' ? 'syllabus' : numeric ? 'assignment' : null;
    case 'pages':
      return id ? 'page' : null;
    case 'discussion_topics':
    case 'announcements':
      return numeric ? 'discussion' : null;
    case 'quizzes':
      return numeric ? 'quiz' : null;
    case 'files':
      return numeric ? 'file' : null;
    case 'modules/items':
      return numeric ? 'moduleItem' : null;
    default:
      return null;
  }
}

const MAX_DEPTH = 14;
const MAX_STRINGS = 400_000; // a ceiling, so one enormous response cannot stall the page

/** Every internal link on `host` found in the captured bodies, once each, for the given courses (null = any). */
export function discoverLinks(snapshot: Snapshot, host: string, courseIds: ReadonlySet<number> | null): DiscoveredLink[] {
  const found = new Map<string, DiscoveredLink>();
  const titles = new Map<string, string>();
  let seen = 0;

  const normalize = (text: string, onLink: (url: string, courseId: number, kind: LinkKind, id: string) => void) => {
    LINK.lastIndex = 0;
    for (let m = LINK.exec(text); m; m = LINK.exec(text)) {
      const [, linkHost, course, section, rawId] = m;
      if (linkHost && linkHost.toLowerCase() !== host.toLowerCase()) continue;
      const courseId = Number(course);
      if (courseIds && !courseIds.has(courseId)) continue;
      const id = rawId.replace(/[.-]+$/, '');
      const kind = kindOf(section, id);
      if (!kind) continue;
      const path = kind === 'syllabus' ? `assignments/syllabus` : `${section.toLowerCase().replace('announcements', 'discussion_topics')}/${id}`;
      onLink(`https://${host}/courses/${courseId}/${path}`, courseId, kind, id);
    }
  };

  const walk = (value: unknown, depth: number): void => {
    if (seen > MAX_STRINGS || depth > MAX_DEPTH) return;
    if (typeof value === 'string') {
      seen += 1;
      if (value.includes('/courses/')) {
        normalize(value, (url, courseId, kind, id) => {
          if (!found.has(url)) found.set(url, { url, courseId, kind, id, title: titles.get(url) ?? null });
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v, depth + 1);
      return;
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      // A name seen next to its address, to label the link.
      const href = typeof obj.html_url === 'string' ? obj.html_url : typeof obj.htmlUrl === 'string' ? obj.htmlUrl : null;
      const name = [obj.name, obj.title, obj.display_name].find((n): n is string => typeof n === 'string' && !!n.trim());
      if (href && name) normalize(href, (url) => titles.has(url) || titles.set(url, name.trim().slice(0, 80)));
      for (const v of Object.values(obj)) walk(v, depth + 1);
    }
  };

  for (const r of snapshot.records) walk(r.body, 0);
  // Subfolders: the Files page only loads the folder it shows, so each subfolder a folder listing names is a page to
  // open (its listing brings that folder's files). Canvas addresses a folder by its path under "course files".
  for (const r of snapshot.records) {
    if (r.kind !== 'folderContents' && !(r.kind === 'other' && r.route === 'GET /folders/:id/all')) continue;
    for (const f of Array.isArray(r.body) ? r.body : []) {
      if (!f || typeof f !== 'object') continue;
      const folder = f as Record<string, unknown>;
      const courseId = Number(folder.context_id);
      if (folder.context_type !== 'Course' || typeof folder.full_name !== 'string' || !Number.isInteger(courseId)) continue;
      if (courseIds && !courseIds.has(courseId)) continue;
      const path = folder.full_name.split('/').slice(1); // drop the root ("course files")
      if (!path.length) continue;
      const url = `https://${host}/courses/${courseId}/files/folder/${path.map(encodeURIComponent).join('/')}`;
      if (!found.has(url)) found.set(url, { url, courseId, kind: 'folder', id: String(folder.id ?? path.join('/')), title: path.join(' / ').slice(0, 80) });
    }
  }
  // Titles can be learned after a link was first seen.
  for (const link of found.values()) if (!link.title) link.title = titles.get(link.url) ?? null;
  return [...found.values()];
}

/** Links not opened within `ttlMs`, in the order they should be opened. */
export function pendingLinks(links: DiscoveredLink[], visited: Record<string, number> | undefined, now: number, ttlMs = 24 * 3600e3): DiscoveredLink[] {
  const fresh = (url: string) => {
    const at = visited?.[url];
    return typeof at === 'number' && now - at < ttlMs;
  };
  return links
    .filter((l) => !fresh(l.url))
    .sort((a, b) => a.courseId - b.courseId || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.url.localeCompare(b.url));
}

/** The next batch of steps, labelled with the course and item name. */
export function planLinks(links: DiscoveredLink[], courseNames: ReadonlyMap<number, string | null>, limit = Infinity): PullStep[] {
  return links.slice(0, limit).map((l) => ({
    url: l.url,
    label: `${courseNames.get(l.courseId) ?? t('Course {id}', { id: l.courseId })} · ${t(KIND_LABEL[l.kind])}${l.kind === 'syllabus' ? '' : ` · ${l.title ?? l.id}`}`,
  }));
}
