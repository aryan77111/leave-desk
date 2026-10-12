'use server';
import { revalidatePath } from 'next/cache';
import { readableError } from '@/lib/errors';
import { requireOneOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/types';

export async function addDelegation(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireOneOf(['approver', 'office']);
  const delegate = String(form.get('delegate') ?? '');
  const from = String(form.get('from') ?? '');
  const to = String(form.get('to') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(delegate)) return { error: 'Choose who will decide.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_delegation', {
    p_delegate: delegate, p_from: from || null, p_to: to || null, p_reason: String(form.get('reason') ?? '').trim() || null,
  });
  if (error) return { error: readableError(error) };
  revalidatePath('/away');
  return { ok: 'Saved. They have been emailed, and the Dean HRM Office has been told.' };
}

export async function endDelegation(id: string): Promise<ActionResult> {
  await requireOneOf(['approver', 'office']);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: 'Delegation not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('end_delegation', { p_id: id });
  if (error) return { error: readableError(error) };
  revalidatePath('/away');
  return { ok: 'Ended. Requests go back to the Dean only.' };
}
