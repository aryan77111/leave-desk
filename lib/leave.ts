import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtStamp, LEVEL_LABEL, medicalStep, plural } from '@/lib/format';
import type { AckStatus, LeaveEvent, LeaveRequest, LeaveType } from '@/lib/types';

export type LeaveDetailData = LeaveRequest & {
  student: { id: string; full_name: string; student_no: string | null; email: string; batch: string | null; section: string | null; programme: string | null } | null;
  decider: { full_name: string } | null;
  filer: { full_name: string } | null;
  checker: { full_name: string } | null;
  leave_sessions: { session: { id: string; course_code: string; course_name: string | null; starts_at: string; faculty_id: string } | null }[];
  faculty_acks: { faculty_id: string; status: AckStatus; note: string | null; responded_at: string | null; faculty: { full_name: string } | null }[];
};

export type Concern = { id: number; concern: string; created_at: string; faculty: { full_name: string } | null };

const DETAIL_SELECT = `*,
  student:people!leave_requests_student_id_fkey(id, full_name, student_no, email, batch, section, programme),
  decider:people!leave_requests_decided_by_fkey(full_name),
  filer:people!leave_requests_filed_by_fkey(full_name),
  checker:people!leave_requests_doc_checked_by_fkey(full_name),
  leave_sessions(session:class_sessions(id, course_code, course_name, starts_at, faculty_id)),
  faculty_acks(faculty_id, status, note, responded_at, faculty:people(full_name))`;

export async function getLeaveByRef(supabase: SupabaseClient, ref: string) {
  if (!/^LV-\d+$/.test(ref)) return null;
  const { data } = await supabase.from('leave_requests').select(DETAIL_SELECT).eq('ref', ref).maybeSingle();
  return (data as LeaveDetailData | null) ?? null;
}

export async function getEvents(supabase: SupabaseClient, leaveId: string) {
  const { data } = await supabase.from('leave_events')
    .select('id, kind, message, created_at, visible_to_student, actor:people!leave_events_actor_id_fkey(full_name)')
    .eq('leave_id', leaveId).order('created_at').order('id');
  return (data ?? []) as unknown as LeaveEvent[];
}

export async function getConcerns(supabase: SupabaseClient, leaveId: string) {
  const { data } = await supabase.from('ack_concerns').select('id, concern, created_at, faculty:people(full_name)').eq('leave_id', leaveId).order('created_at');
  return (data ?? []) as unknown as Concern[];
}

/** Medical fields are needed to describe the certificate step; pass them whenever `type` is passed. */
type StepInput = Pick<LeaveRequest, 'status' | 'approver_level' | 'doc_deadline' | 'decision_note'> & {
  cancel_reason?: string | null;
  type?: LeaveType;
  doc_path?: string | null;
  doc_checked_at?: string | null;
  doc_return_note?: string | null;
};

export function nextStep(l: StepInput, audience: 'student' | 'staff', acks?: { status: AckStatus }[]) {
  const answered = acks ? acks.filter((a) => a.status !== 'pending').length : 0;
  const faculty = acks?.length ? ` Faculty responses: ${answered} of ${acks.length}.` : '';
  const due = l.doc_deadline ? fmtStamp(l.doc_deadline) : 'the deadline';
  switch (l.status) {
    case 'submitted': {
      const step = l.type ? medicalStep({ type: l.type, status: l.status, doc_path: l.doc_path ?? null, doc_checked_at: l.doc_checked_at ?? null }) : null;
      if (step === 'certificate') {
        if (l.doc_return_note) {
          return audience === 'student'
            ? `The Dean HRM Office returned your certificate: ${l.doc_return_note} Upload a new one by ${due}.`
            : `Certificate returned to the student: ${l.doc_return_note} New one due by ${due}.`;
        }
        return audience === 'student'
          ? `Upload your medical certificate by ${due}, or the request is cancelled automatically.`
          : `No certificate yet. Due by ${due}.`;
      }
      if (step === 'office') {
        return (audience === 'student'
          ? 'The Dean HRM Office is checking your certificate. Then it goes to the Dean.'
          : 'Certificate waiting for the Dean HRM Office to check it. The Dean decides after that.') + faculty;
      }
      return `Waiting for the ${LEVEL_LABEL[l.approver_level]}.${faculty}`;
    }
    case 'sanctioned':
      return audience === 'student'
        ? `Sanctioned provisionally. Upload your medical certificate by ${due}, or the leave is cancelled automatically.`
        : `Sanctioned provisionally. Certificate due by ${due}.`;
    case 'documents_in':
      return audience === 'student' ? 'Your certificate is with the Dean HRM Office for checking.' : 'Certificate uploaded and waiting for the Dean HRM Office to check it.';
    case 'approved':
      return 'Final. The sessions count as approved leave in attendance.';
    case 'rejected':
      return 'Not approved.';
    case 'cancelled':
      return l.cancel_reason && !/certificate was not uploaded/i.test(l.cancel_reason)
        ? `Cancelled by the Dean HRM Office: ${l.cancel_reason}`
        : 'Cancelled because the certificate was not uploaded by the deadline. The absence counts as unapproved.';
    case 'withdrawn':
      return 'Withdrawn by the student before a decision.';
  }
}

export function sessionsByFaculty(l: LeaveDetailData) {
  const groups = new Map<string, { faculty: string; sessions: { course_code: string; starts_at: string }[]; status: AckStatus; note: string | null; responded_at: string | null }>();
  for (const a of l.faculty_acks) {
    groups.set(a.faculty_id, { faculty: a.faculty?.full_name ?? 'Faculty', sessions: [], status: a.status, note: a.note, responded_at: a.responded_at });
  }
  for (const ls of l.leave_sessions) {
    if (!ls.session) continue;
    const g = groups.get(ls.session.faculty_id);
    if (g) g.sessions.push({ course_code: ls.session.course_code, starts_at: ls.session.starts_at });
  }
  return [...groups.values()]
    .map((g) => ({ ...g, sessions: g.sessions.sort((a, b) => a.starts_at.localeCompare(b.starts_at)) }))
    .sort((a, b) => (a.sessions[0]?.starts_at ?? '').localeCompare(b.sessions[0]?.starts_at ?? ''));
}

export function sessionCount(l: LeaveDetailData) {
  return plural(l.leave_sessions.length, 'session');
}
