// Helpers for the coverage view: decoding the API payload, finding gaps and
// binning days into on-screen cells. Days are counted from the Unix epoch, UTC.

export const DAY_MS = 86_400_000;

export interface Lane {
  source: string;
  total: number;
  undated: number;
  firstDay: number;
  lastDay: number;
  /** Absolute active days, ascending */
  days: Int32Array;
  counts: Int32Array;
  /** Every run of empty days between two active days, longest first */
  gaps: Gap[];
}

export interface Gap {
  /** First empty day */
  start: number;
  /** Last empty day */
  end: number;
  length: number;
}

export function decodeLane(s: {
  source: string;
  total: number;
  undated: number;
  firstDay: number;
  lastDay: number;
  days: number[];
  counts: number[];
}): Lane {
  const days = new Int32Array(s.days.length);
  let d = 0;
  for (let i = 0; i < s.days.length; i++) {
    d = i === 0 ? s.days[0] : d + s.days[i];
    days[i] = d;
  }
  const gaps: Gap[] = [];
  for (let i = 1; i < days.length; i++) {
    const length = days[i] - days[i - 1] - 1;
    if (length > 0) gaps.push({ start: days[i - 1] + 1, end: days[i] - 1, length });
  }
  gaps.sort((a, b) => b.length - a.length);
  return {
    source: s.source,
    total: s.total,
    undated: s.undated,
    firstDay: s.firstDay,
    lastDay: s.lastDay,
    days,
    counts: Int32Array.from(s.counts),
    gaps
  };
}

/** Index of the first active day >= day */
export function lowerBound(days: Int32Array, day: number): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Sum records per cell for the days from viewStart to viewEnd inclusive */
export function binLane(lane: Lane, viewStart: number, viewEnd: number, bins: number): Float64Array {
  const out = new Float64Array(bins);
  const span = viewEnd - viewStart + 1;
  for (let i = lowerBound(lane.days, viewStart); i < lane.days.length && lane.days[i] <= viewEnd; i++) {
    const b = Math.min(bins - 1, Math.floor(((lane.days[i] - viewStart) * bins) / span));
    out[b] += lane.counts[i];
  }
  return out;
}

/** Records between two days, inclusive */
export function countBetween(lane: Lane, start: number, end: number): number {
  let n = 0;
  for (let i = lowerBound(lane.days, start); i < lane.days.length && lane.days[i] <= end; i++) {
    n += lane.counts[i];
  }
  return n;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayToDate(day: number): Date {
  return new Date(day * DAY_MS);
}

export function dateToDay(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

export function formatDay(day: number): string {
  const d = dayToDate(day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatMonth(day: number): string {
  const d = dayToDate(day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A date range at the precision its length deserves */
export function formatRange(start: number, end: number): string {
  if (start === end) return formatDay(start);
  if (end - start > 120) {
    const a = formatMonth(start);
    const b = formatMonth(end);
    return a === b ? a : `${a} – ${b}`;
  }
  return `${formatDay(start)} – ${formatDay(end)}`;
}

/** 3 days, 5 weeks, 7 months, 2.5 years */
export function formatSpan(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  const years = days / 365.25;
  return `${years < 10 ? years.toFixed(1).replace(/\.0$/, '') : Math.round(years)} years`;
}

export function formatAgo(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${formatSpan(days)} ago`;
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export interface Tick {
  day: number;
  label: string;
  major: boolean;
}

/** Axis ticks spaced at least minPx apart across a track widthPx wide */
export function axisTicks(viewStart: number, viewEnd: number, widthPx: number, minPx = 56): Tick[] {
  const span = viewEnd - viewStart + 1;
  const pxPerDay = widthPx / span;
  const steps: { months?: number; days?: number }[] = [
    { days: 1 },
    { days: 7 },
    { months: 1 },
    { months: 3 },
    { months: 6 },
    { months: 12 },
    { months: 24 },
    { months: 60 },
    { months: 120 }
  ];
  const approxDays = (s: { months?: number; days?: number }) => s.days ?? (s.months ?? 1) * 30.44;
  const step = steps.find((s) => approxDays(s) * pxPerDay >= minPx) ?? steps[steps.length - 1];
  const ticks: Tick[] = [];
  const start = dayToDate(viewStart);

  if (step.days) {
    // Days or weeks (weeks start on Monday)
    let d = viewStart;
    if (step.days === 7) d += (8 - dayToDate(d).getUTCDay()) % 7;
    for (; d <= viewEnd; d += step.days) {
      const date = dayToDate(d);
      const first = date.getUTCDate() === 1 || d === viewStart;
      ticks.push({ day: d, label: first ? formatDay(d).replace(/, \d+$/, '') : String(date.getUTCDate()), major: first });
    }
    return ticks;
  }

  const months = step.months!;
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  // Align to the step: years to multiples of the step, months to quarters etc.
  if (months >= 12) {
    const years = months / 12;
    y = Math.ceil((y + (m > 0 ? 1 : 0)) / years) * years;
    m = 0;
  } else {
    m = Math.ceil(m / months) * months;
    if (start.getUTCDate() > 1 && m === start.getUTCMonth()) m += months;
  }
  for (;;) {
    while (m >= 12) {
      m -= 12;
      y += 1;
    }
    const day = dateToDay(new Date(Date.UTC(y, m, 1)));
    if (day > viewEnd) break;
    if (day >= viewStart) {
      ticks.push({ day, label: m === 0 ? String(y) : MONTHS[m], major: m === 0 });
    }
    m += months;
  }
  return ticks;
}
