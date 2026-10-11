'use server';
import { revalidatePath } from 'next/cache';
import { readableError } from '@/lib/errors';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/types';

export async function decideLeave(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('approver');
  const leaveId = String(form.get('leave_id') ?? '');
  const ref = String(form.get('ref') ?? '');
  const decision = String(form.get('decision') ?? '');
  const note = String(form.get('note') ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(leaveId)) return { error: 'Leave request not found.' };
  if (decision !== 'approve' && decision !== 'reject') return { error: 'Choose approve or reject.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('decide_leave', { p_leave: leaveId, p_approve: decision === 'approve', p_note: note || null });
  if (error) return { error: readableError(error) };
  revalidatePath('/approve');
  revalidatePath(`/approve/${ref}`);
  const status = data as string;
  return {
    ok: status === 'sanctioned'
      ? 'Sanctioned provisionally. The student has been asked to upload a certificate.'
      : status === 'approved' ? 'Approved. The student has been emailed.' : 'Rejected. The student has been emailed with your reason.',
  };
}
