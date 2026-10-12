'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { readableError } from '@/lib/errors';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/types';

const UUID = /^[0-9a-f-]{36}$/i;

export async function reviewCertificate(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('office');
  const leaveId = String(form.get('leave_id') ?? '');
  const ref = String(form.get('ref') ?? '');
  const accept = form.get('decision') === 'accept';
  const note = String(form.get('note') ?? '').trim();
  if (!UUID.test(leaveId)) return { error: 'Leave request not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('review_certificate', { p_leave: leaveId, p_accept: accept, p_note: note || null });
  if (error) return { error: readableError(error) };
  revalidatePath(`/office/leave/${ref}`);
  revalidatePath('/office');
  return { ok: accept ? 'Certificate accepted. The leave is now approved.' : 'Certificate returned. The student has been asked for a new one.' };
}

export type ImportResult = ActionResult & { inserted?: number; updated?: number; errors?: { row: number; email?: string; message: string }[] };

export async function importPeople(rows: Record<string, string>[]): Promise<ImportResult> {
  await requireViewer('office');
  if (!Array.isArray(rows) || rows.length === 0) return { error: 'The file has no rows.' };
  if (rows.length > 5000) return { error: 'Import at most 5000 rows at a time.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('import_people', { p_rows: rows });
  if (error) return { error: readableError(error) };
  revalidatePath('/office/people');
  revalidatePath('/office');
  return { ok: 'Import finished.', ...(data as object) };
}

export async function importSessions(rows: Record<string, string>[]): Promise<ImportResult> {
  await requireViewer('office');
  if (!Array.isArray(rows) || rows.length === 0) return { error: 'The file has no rows.' };
  if (rows.length > 10000) return { error: 'Import at most 10000 rows at a time.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('import_sessions', { p_rows: rows });
  if (error) return { error: readableError(error) };
  revalidatePath('/office/timetable');
  revalidatePath('/office');
  return { ok: 'Import finished.', ...(data as object) };
}

// Kept for API compatibility; the People page now edits access on the person page.
export async function setPersonActive(personId: string, active: boolean): Promise<ActionResult> {
  await requireViewer('office');
  if (!UUID.test(personId)) return { error: 'Person not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_person_active', { p_person: personId, p_active: active });
  if (error) return { error: readableError(error) };
  revalidatePath('/office/people');
  return { ok: active ? 'Reactivated.' : 'Deactivated. They can no longer sign in.' };
}

const INT_FIELDS = ['notice_hours', 'medical_late_hours', 'medical_ahead_days', 'ack_hours', 'escalate_hours', 'doc_days', 'max_leave_days'] as const;
const RANGES: Record<string, [number, number, string]> = {
  link_days: [1, 30, 'Faculty links must last between 1 and 30 days.'],
  target_decision_pct: [0, 100, 'Targets are percentages from 0 to 100.'],
  target_ack_pct: [0, 100, 'Targets are percentages from 0 to 100.'],
  target_cert_pct: [0, 100, 'Targets are percentages from 0 to 100.'],
};

export async function updateSettings(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { person } = await requireViewer('office');
  const patch: Record<string, unknown> = { updated_by: person.id };
  for (const k of INT_FIELDS) {
    const v = Number(form.get(k));
    if (!Number.isInteger(v) || v < 0 || v > 720) return { error: 'Use whole numbers between 0 and 720.' };
    patch[k] = v;
  }
  for (const [k, [lo, hi, msg]] of Object.entries(RANGES)) {
    const v = Number(form.get(k));
    if (!Number.isInteger(v) || v < lo || v > hi) return { error: msg };
    patch[k] = v;
  }
  const sat = Number(form.get('target_satisfaction'));
  if (!Number.isFinite(sat) || sat < 1 || sat > 5) return { error: 'The satisfaction target is a rating from 1 to 5.' };
  patch.target_satisfaction = Math.round(sat * 10) / 10;
  patch.survey_open = form.get('survey_open') === 'on';

  const programme = String(form.get('programme_name') ?? '').trim();
  if (!programme) return { error: 'Add the programme name.' };
  patch.programme_name = programme;

  const appUrl = String(form.get('app_url') ?? '').trim().replace(/\/+$/, '');
  if (appUrl) {
    try {
      const u = new URL(appUrl);
      if (u.protocol !== 'https:' && u.hostname !== 'localhost') return { error: 'The app address must start with https://' };
    } catch {
      return { error: 'The app address is not a valid web address.' };
    }
  }
  patch.app_url = appUrl || null;

  const from = String(form.get('email_from') ?? '').trim();
  if (from && !/^[^<>]*<[^@\s]+@[^@\s]+\.[^@\s]+>$|^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
    return { error: 'Write the sender as "Leave Desk <leave@yourdomain>" or just the address.' };
  }
  patch.email_from = from || null;

  const domains = String(form.get('allowed_domains') ?? '')
    .split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  patch.allowed_domains = domains;

  const contactEmail = String(form.get('help_contact_email') ?? '').trim();
  if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) return { error: 'The contact email is not valid.' };
  patch.help_contact_name = String(form.get('help_contact_name') ?? '').trim().slice(0, 120) || null;
  patch.help_contact_email = contactEmail || null;
  patch.help_contact_phone = String(form.get('help_contact_phone') ?? '').trim().slice(0, 40) || null;

  const supabase = await createClient();
  const { error, count } = await supabase.from('settings').update(patch, { count: 'exact' }).eq('id', 1);
  if (error) return { error: readableError(error) };
  if (count === 0) return { error: 'Only the Dean HRM Office can change the rules.' };
  revalidatePath('/', 'layout');
  return { ok: 'Saved. New rules apply to requests from now on.' };
}

function personFields(form: FormData) {
  const roles = form.getAll('roles').map(String).filter((r) => ['student', 'faculty', 'dean', 'office'].includes(r));
  const isStudent = roles.includes('student');
  const val = (k: string) => String(form.get(k) ?? '').trim();
  return {
    full_name: val('full_name'),
    email: val('email').toLowerCase(),
    roles: roles.join(';'),
    student_no: isStudent ? val('student_no') : '',
    programme: isStudent ? val('programme') : '',
    batch: isStudent ? val('batch') : '',
    section: isStudent ? val('section') : '',
  };
}

export async function updatePerson(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('office');
  const id = String(form.get('id') ?? '');
  if (!UUID.test(id)) return { error: 'Person not found.' };
  const f = personFields(form);
  if (!f.roles) return { error: 'Choose at least one role.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_person', {
    p_person: id, p_full_name: f.full_name, p_email: f.email, p_roles: f.roles,
    p_student_no: f.student_no || null, p_programme: f.programme || null, p_batch: f.batch || null, p_section: f.section || null,
    p_active: form.get('active') === 'on',
  });
  if (error) return { error: readableError(error) };
  revalidatePath('/office/people');
  revalidatePath(`/office/people/${id}`);
  return { ok: 'Saved.' };
}

export async function addPerson(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('office');
  const f = personFields(form);
  if (!f.full_name) return { error: 'Add the name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return { error: 'Enter a valid email address.' };
  if (!f.roles) return { error: 'Choose at least one role.' };
  const supabase = await createClient();
  const { data: existing } = await supabase.from('people').select('id').eq('email', f.email).maybeSingle();
  if (existing) return { error: 'This email is already on the roster. Search for the person and edit them instead.' };
  const { data, error } = await supabase.rpc('import_people', { p_rows: [f] });
  if (error) return { error: readableError(error) };
  const res = data as { inserted: number; errors: { message: string }[] };
  if (res.errors?.length) {
    const msg = res.errors[0].message;
    if (/people_student_fields/.test(msg)) return { error: 'Students need a student ID, batch and section.' };
    if (/student_no/.test(msg)) return { error: 'Another student already has this student ID.' };
    return { error: 'Could not add this person. Check the details and try again.' };
  }
  revalidatePath('/office/people');
  return { ok: `${f.full_name} added. They can sign in with ${f.email}.` };
}

export async function setBatchActive(batch: string, section: string | null, active: boolean): Promise<ActionResult> {
  await requireViewer('office');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_batch_active', { p_batch: batch, p_section: section, p_active: active });
  if (error) return { error: readableError(error) };
  revalidatePath('/office/people');
  const n = data as number;
  return { ok: active ? `${n} student${n === 1 ? '' : 's'} restored.` : `${n} student${n === 1 ? '' : 's'} marked as graduated.` };
}

// ---------------------------------------------------------------------------
// Filing, correcting and cancelling requests for students
// ---------------------------------------------------------------------------
const s = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');
const sessionIds = (form: FormData) => form.getAll('session').map(String).filter((id) => UUID.test(id));

export async function fileLeave(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('office');
  const studentId = s(form.get('student_id'));
  const type = s(form.get('type'));
  if (!UUID.test(studentId)) return { error: 'Choose a student.' };
  if (!['medical', 'family', 'official'].includes(type)) return { error: 'Choose the purpose of leave.' };
  const away = form.get('away') === 'on';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('office_file_leave', {
    p_student: studentId,
    p_type: type,
    p_reason: s(form.get('reason')),
    p_from: s(form.get('from')) || null,
    p_to: s(form.get('to')) || null,
    p_session_ids: sessionIds(form),
    p_away: away,
    p_return: away ? s(form.get('return_date')) || null : null,
    p_contact_name: away ? s(form.get('contact_name')) : null,
    p_contact_phone: away ? s(form.get('contact_phone')) : null,
    p_office_note: s(form.get('office_note')),
  });
  if (error) return { error: readableError(error) };
  revalidatePath('/office/leave');
  revalidatePath('/office');
  redirect(`/office/leave/${data as string}?filed=1`);
}

export async function amendLeave(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('office');
  const leaveId = s(form.get('leave_id'));
  const ref = s(form.get('ref'));
  if (!UUID.test(leaveId)) return { error: 'Leave request not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('office_amend_leave', {
    p_leave: leaveId,
    p_from: s(form.get('from')) || null,
    p_to: s(form.get('to')) || null,
    p_session_ids: sessionIds(form),
    p_note: s(form.get('office_note')),
  });
  if (error) return { error: readableError(error) };
  revalidatePath(`/office/leave/${ref}`);
  redirect(`/office/leave/${ref}?corrected=1`);
}

export async function cancelLeave(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('office');
  const leaveId = s(form.get('leave_id'));
  const ref = s(form.get('ref'));
  if (!UUID.test(leaveId)) return { error: 'Leave request not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('office_cancel_leave', { p_leave: leaveId, p_note: s(form.get('note')) });
  if (error) return { error: readableError(error) };
  revalidatePath(`/office/leave/${ref}`);
  revalidatePath('/office/leave');
  return { ok: 'Cancelled. The student, and anyone still waiting on it, have been emailed.' };
}

export async function setFeedbackStatus(id: number, status: 'new' | 'seen' | 'done', note?: string): Promise<ActionResult> {
  await requireViewer('office');
  if (!Number.isInteger(id)) return { error: 'Feedback not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_feedback_status', { p_id: id, p_status: status, p_note: note ?? null });
  if (error) return { error: readableError(error) };
  revalidatePath('/office/feedback');
  return { ok: 'Saved.' };
}
