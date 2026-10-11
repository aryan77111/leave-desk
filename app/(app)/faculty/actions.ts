'use server';
import { revalidatePath } from 'next/cache';
import { readableError } from '@/lib/errors';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/types';

export async function respondToLeave(leaveId: string, kind: 'acknowledge' | 'note' | 'flag', note?: string): Promise<ActionResult> {
  await requireViewer('faculty');
  if (!/^[0-9a-f-]{36}$/i.test(leaveId)) return { error: 'Leave request not found.' };
  if (!['acknowledge', 'note', 'flag'].includes(kind)) return { error: 'Unknown response.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('respond_to_leave', { p_leave: leaveId, p_kind: kind, p_note: note ?? null });
  if (error) return { error: readableError(error) };
  revalidatePath('/faculty');
  revalidatePath('/faculty/history');
  return { ok: kind === 'flag' ? 'Concern sent to the approver.' : kind === 'note' ? 'Acknowledged. Your note was emailed to the student.' : 'Acknowledged.' };
}
