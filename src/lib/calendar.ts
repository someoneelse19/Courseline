/** Local-time "YYYY-MM-DD" for a date (what a calendar cell stands for; never converts to UTC). */
export function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The days shown for one month: whole weeks, starting on `weekStart` (0 = Sunday, 1 = Monday),
 * including the neighbouring months' days that fill the first and last week.
 */
export function monthGrid(year: number, month: number, weekStart: 0 | 1): Date[] {
  const offset = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => new Date(year, month, 1 - offset + i));
}
