'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { readableError } from '@/lib/errors';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/types';

const UUID = /^[0-9a-f-]{36}$/i;
const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');

export async function submitLeave(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('student');
  const type = str(form.get('type'));
  if (!['medical', 'family', 'official'].includes(type)) return { error: 'Choose the purpose of leave.' };
  const away = form.get('away') === 'on';
  const sessionIds = form.getAll('session').map(String).filter((id) => UUID.test(id));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_leave', {
    p_type: type,
    p_reason: str(form.get('reason')),
    p_from: str(form.get('from')) || null,
    p_to: str(form.get('to')) || null,
    p_session_ids: sessionIds,
    p_away: away,
    p_return: away ? str(form.get('return_date')) || null : null,
    p_contact_name: away ? str(form.get('contact_name')) : null,
    p_contact_phone: away ? str(form.get('contact_phone')) : null,
    p_consent: form.get('consent') === 'on',
  });
  if (error) return { error: readableError(error) };
  revalidatePath('/student');
  redirect(`/student/leave/${data as string}?submitted=1`);
}

export async function withdrawLeave(leaveId: string, ref: string): Promise<ActionResult> {
  await requireViewer('student');
  if (!UUID.test(leaveId)) return { error: 'Leave request not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('withdraw_leave', { p_leave: leaveId });
  if (error) return { error: readableError(error) };
  revalidatePath(`/student/leave/${ref}`);
  revalidatePath('/student');
  return { ok: 'Request withdrawn. Your faculty and the Dean have been told.' };
}

export async function attachCertificate(leaveId: string, path: string, ref: string): Promise<ActionResult> {
  await requireViewer('student');
  if (!UUID.test(leaveId)) return { error: 'Leave request not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('attach_certificate', { p_leave: leaveId, p_path: path });
  if (error) return { error: readableError(error) };
  revalidatePath(`/student/leave/${ref}`);
  revalidatePath('/student');
  return { ok: 'Certificate uploaded. The Dean HRM Office will check it.' };
}
