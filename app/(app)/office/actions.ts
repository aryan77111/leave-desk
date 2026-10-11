'use server';
import { revalidatePath } from 'next/cache';
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

export async function setPersonActive(personId: string, active: boolean): Promise<ActionResult> {
  await requireViewer('office');
  if (!UUID.test(personId)) return { error: 'Person not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_person_active', { p_person: personId, p_active: active });
  if (error) return { error: readableError(error) };
  revalidatePath('/office/people');
  return { ok: active ? 'Reactivated.' : 'Deactivated. They can no longer sign in.' };
}

const INT_FIELDS = ['notice_hours', 'medical_late_hours', 'medical_ahead_days', 'ack_hours', 'escalate_hours', 'doc_days', 'chair_max_days', 'max_leave_days'] as const;

export async function updateSettings(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { person } = await requireViewer('office');
  const patch: Record<string, unknown> = { updated_by: person.id };
  for (const k of INT_FIELDS) {
    const v = Number(form.get(k));
    if (!Number.isInteger(v) || v < 0 || v > 720) return { error: 'Use whole numbers between 0 and 720.' };
    patch[k] = v;
  }
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

  const supabase = await createClient();
  const { error, count } = await supabase.from('settings').update(patch, { count: 'exact' }).eq('id', 1);
  if (error) return { error: readableError(error) };
  if (count === 0) return { error: 'Only the Dean HRM Office can change the rules.' };
  revalidatePath('/', 'layout');
  return { ok: 'Saved. New rules apply to requests from now on.' };
}
