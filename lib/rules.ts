// Client-side preview of the timing rules. The database enforces the same rules on submit.
import { addDays, dayStart, daysInclusive, fmtDay, todayLocal } from './format.ts';
import type { LeaveType } from './types.ts';

export type Rules = {
  noticeHours: number;
  medicalLateHours: number;
  medicalAheadDays: number;
  docDays: number;
  maxLeaveDays: number;
};

export function earliestPlannedStart(now: Date, noticeHours: number) {
  let d = todayLocal(now);
  while (dayStart(d).getTime() - now.getTime() < noticeHours * 36e5) d = addDays(d, 1);
  return d;
}

export function timingProblems(type: LeaveType, from: string, to: string, rules: Rules, now: Date = new Date()): string[] {
  const out: string[] = [];
  if (!from || !to) return out;
  if (to < from) return ['The last day is before the first day.'];
  if (daysInclusive(from, to) > rules.maxLeaveDays) {
    out.push(`Leave longer than ${rules.maxLeaveDays} days is handled by the Dean HRM Office directly.`);
  }
  if (type === 'medical') {
    const late = dayStart(addDays(from, 1)).getTime() + rules.medicalLateHours * 36e5;
    if (now.getTime() > late) out.push(`Medical leave must be applied within ${rules.medicalLateHours} hours of the first day of absence. Contact the Dean HRM Office.`);
    if (from > addDays(todayLocal(now), rules.medicalAheadDays)) out.push(`Medical leave can be applied at most ${rules.medicalAheadDays} days ahead.`);
  } else if (dayStart(from).getTime() - now.getTime() < rules.noticeHours * 36e5) {
    out.push(`This leave needs ${rules.noticeHours} hours' notice. The earliest first day you can choose is ${fmtDay(earliestPlannedStart(now, rules.noticeHours))}.`);
  }
  return out;
}
