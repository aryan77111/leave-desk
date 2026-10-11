'use server';
import { readableError } from '@/lib/errors';
import { createAnonClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/types';

export async function respondByToken(token: string, kind: 'acknowledge' | 'note' | 'flag', note?: string): Promise<ActionResult> {
  if (!/^[0-9a-f]{48}$/.test(token)) return { error: 'This link is not valid.' };
  if (!['acknowledge', 'note', 'flag'].includes(kind)) return { error: 'Unknown response.' };
  const supabase = createAnonClient();
  const { error } = await supabase.rpc('respond_by_token', { p_token: token, p_kind: kind, p_note: note ?? null });
  if (error) return { error: readableError(error) };
  return {
    ok: kind === 'flag'
      ? 'Thank you. Your concern has been sent to the approver.'
      : kind === 'note'
        ? 'Thank you. Your note has been emailed to the student.'
        : 'Thank you. Your acknowledgment is recorded.',
  };
}
