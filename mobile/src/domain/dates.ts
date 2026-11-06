const DAY = 86400000;
const nbsp = (s: string) => s.replace(/ /g, ' ');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** List dates: "Today", "Yesterday", then "3 Nov". */
export function relDate(ms: number): string {
  const d = new Date(ms);
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / DAY); // round: a DST day is not 24 h
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return nbsp(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
}

/** Detail-screen date: "3 November 2026". */
export function fullDate(ms: number): string {
  return nbsp(new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }));
}

/** Section heading for a month of rows: "November 2026". */
export function monthKey(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
