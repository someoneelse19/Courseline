// One color per course, used everywhere a class is shown (cards, sidebar, calendar, lists).
// Colors are handed out by a course's position among ALL the user's courses (sorted by id), not
// by hashing the id, so two courses never share a color. Hiding a course in Settings does not
// change the others' colors; a newly added course (Canvas ids only go up) takes the next free color.

// Twelve hues chosen to stay apart from each other (and readable on light and dark backgrounds).
const BASE = ['#2563eb', '#16a34a', '#e11d48', '#d97706', '#0891b2', '#c026d3', '#65a30d', '#7c3aed', '#ea580c', '#0d9488', '#db2777', '#4b5563'];

/** The `index`-th color: curated for the first twelve, then golden-angle hues (alternating lightness) so it never runs out. */
export function colorAt(index: number): string {
  if (index < BASE.length) return BASE[index];
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 65% ${index % 2 ? 40 : 58}%)`;
}

export const NEUTRAL_COURSE_COLOR = '#9ca3af'; // until the course list has loaded

export function buildCourseColors(courseIds: number[]): Map<number, string> {
  const sorted = [...new Set(courseIds)].sort((a, b) => a - b);
  return new Map(sorted.map((id, i) => [id, colorAt(i)]));
}
