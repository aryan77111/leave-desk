// How a pilot figure compares with its target. Pure, so it is unit-tested.

export type TargetState = 'met' | 'close' | 'below' | 'none';

/** Percentages: within 10 points of the target counts as "close". Ratings (1–5): within half a point. */
export function targetState(value: number | string | null | undefined, target: number, kind: 'pct' | 'rating' = 'pct'): TargetState {
  if (value === null || value === undefined || value === '') return 'none';
  const v = Number(value);
  if (!Number.isFinite(v)) return 'none';
  if (v >= target) return 'met';
  return v >= target - (kind === 'pct' ? 10 : 0.5) ? 'close' : 'below';
}

export const TARGET_LABEL: Record<TargetState, string> = {
  met: 'On target',
  close: 'Close',
  below: 'Below target',
  none: 'Not enough data yet',
};

export function fmtPct(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}
