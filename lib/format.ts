import type { AckStatus, ApproverLevel, LeaveStatus, LeaveType, Role } from './types.ts';

export const TIME_ZONE = 'Asia/Kolkata';

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayYearFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TIME_ZONE });
const stampFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TIME_ZONE,
});
const isoDayFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TIME_ZONE });

/** 'YYYY-MM-DD' → 'Mon 12 Oct' */
export function fmtDay(date: string, withYear = false) {
  const d = new Date(`${date}T00:00:00Z`);
  return (withYear ? dayYearFmt : dayFmt).format(d).replace(',', '');
}

/** Two 'YYYY-MM-DD' dates → 'Mon 12 Oct' or 'Mon 12 Oct – Tue 13 Oct' */
export function fmtRange(from: string, to: string) {
  return from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
}

/** Timestamp → 'Mon 12 Oct, 09:45' in college time */
export function fmtStamp(ts: string) {
  const p = Object.fromEntries(stampFmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

/** Timestamp → '09:45' in college time */
export function fmtTime(ts: string) {
  return timeFmt.format(new Date(ts));
}

/** Timestamp → 'YYYY-MM-DD' in college time */
export function localDate(ts: string | Date) {
  return isoDayFmt.format(typeof ts === 'string' ? new Date(ts) : ts);
}

/** Today's date in college time, 'YYYY-MM-DD' */
export function todayLocal(now: Date = new Date()) {
  return localDate(now);
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysInclusive(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;
}

/** Start of a college-local day as a Date (IST has no daylight saving). */
export function dayStart(date: string) {
  return new Date(`${date}T00:00:00+05:30`);
}

export function hoursBetween(a: Date | string, b: Date | string) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 36e5;
}

export function relativeHours(from: string, now: Date = new Date()) {
  const h = Math.floor(hoursBetween(from, now));
  if (h < 1) return 'under an hour';
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

export const TYPE_LABEL: Record<LeaveType, string> = {
  medical: 'Medical',
  family: 'Family reasons',
  official: 'University official',
};

export const STATUS_LABEL: Record<LeaveStatus, string> = {
  submitted: 'Awaiting decision',
  sanctioned: 'Sanctioned, certificate due',
  documents_in: 'Certificate in review',
  approved: 'Approved',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
  withdrawn: 'Withdrawn',
};

export const STATUS_TONE: Record<LeaveStatus, Tone> = {
  submitted: 'info',
  sanctioned: 'warn',
  documents_in: 'info',
  approved: 'ok',
  rejected: 'bad',
  cancelled: 'bad',
  withdrawn: 'quiet',
};

/** Where a medical request waiting for a decision stands. The certificate comes with the request,
 *  the Dean HRM Office checks it, then the Dean decides. null = not medical, decided, or with the Dean. */
export type MedicalStep = 'certificate' | 'office';
export function medicalStep(l: { type: LeaveType; status: LeaveStatus; doc_path: string | null; doc_checked_at: string | null }): MedicalStep | null {
  if (l.type !== 'medical' || l.status !== 'submitted' || l.doc_checked_at) return null;
  return l.doc_path ? 'office' : 'certificate';
}
export const STEP_LABEL: Record<MedicalStep, string> = { certificate: 'Certificate needed', office: 'Certificate check' };
export const STEP_TONE: Record<MedicalStep, Tone> = { certificate: 'warn', office: 'info' };

export const ACK_LABEL: Record<AckStatus, string> = {
  pending: 'Waiting',
  acknowledged: 'Acknowledged',
  noted: 'Acknowledged with note',
  flagged: 'Raised a concern',
  deemed: 'No reply (deemed acknowledged)',
};

export const ACK_TONE: Record<AckStatus, Tone> = {
  pending: 'quiet',
  acknowledged: 'ok',
  noted: 'ok',
  flagged: 'bad',
  deemed: 'quiet',
};

export const LEVEL_LABEL: Record<ApproverLevel, string> = { chair: 'Programme Chair', dean: 'Dean' };

export const ROLE_LABEL: Record<Role, string> = {
  student: 'Student',
  faculty: 'Faculty',
  approver: 'Dean',
  office: 'Dean HRM Office',
};

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'quiet';

/** Every request is decided by the Dean. */
export function routeLevel(): ApproverLevel {
  return 'dean';
}

export function homeFor(roles: Role[]) {
  if (roles.includes('office')) return '/office';
  if (roles.includes('approver')) return '/approve';
  if (roles.includes('faculty')) return '/faculty';
  return '/student';
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
