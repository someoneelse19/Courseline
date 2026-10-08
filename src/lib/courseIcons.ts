// The icons a course can use. Keys are stored in localStorage; the drawings live in components/icons.tsx.
export const COURSE_ICON_KEYS = ['book', 'science', 'calculator', 'globe', 'code', 'art', 'music', 'health', 'physics', 'history', 'writing', 'business', 'nature'] as const;
export type CourseIconKey = (typeof COURSE_ICON_KEYS)[number];
export const DEFAULT_COURSE_ICON: CourseIconKey = 'book';

/** English display names (translated where shown). */
export const COURSE_ICON_LABELS: Record<CourseIconKey, string> = {
  book: 'Book',
  science: 'Science',
  calculator: 'Math',
  globe: 'World',
  code: 'Computing',
  art: 'Art',
  music: 'Music',
  health: 'Health',
  physics: 'Physics',
  history: 'History',
  writing: 'Writing',
  business: 'Business',
  nature: 'Nature',
};

export const isIconKey = (v: unknown): v is CourseIconKey => typeof v === 'string' && (COURSE_ICON_KEYS as readonly string[]).includes(v);
