// A stable color per course, derived from its id, so a class looks the same everywhere (cards,
// calendar, lists). Canvas has its own per-course colors at /users/self/colors; not used yet.
// Full class names (not built strings) so Tailwind can see them.
const COLORS = ['bg-accent-500', 'bg-emerald-500', 'bg-rose-500', 'bg-amber-500', 'bg-sky-500', 'bg-fuchsia-500'];

export const courseColor = (courseId: number): string => COLORS[courseId % COLORS.length];
