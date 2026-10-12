'use server';
import { revalidatePath } from 'next/cache';
import { readableError } from '@/lib/errors';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/types';

export async function sendFeedback(kind: string, message: string, page: string, agent: string): Promise<ActionResult> {
  await requireViewer();
  if (kind !== 'problem' && kind !== 'suggestion') return { error: 'Choose a problem or a suggestion.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_feedback', {
    p_kind: kind, p_message: String(message ?? '').slice(0, 2000), p_page: String(page ?? '').slice(0, 300), p_agent: String(agent ?? '').slice(0, 300),
  });
  if (error) return { error: readableError(error) };
  revalidatePath('/office/feedback');
  return { ok: kind === 'problem' ? 'Thank you. The Dean HRM Office has been told and will look into it.' : 'Thank you. Your suggestion has been passed on.' };
}

export async function answerSurvey(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer();
  const satisfaction = Number(form.get('satisfaction'));
  const ease = Number(form.get('ease'));
  const fasterRaw = String(form.get('faster') ?? '');
  const faster = fasterRaw === 'yes' ? true : fasterRaw === 'no' ? false : null;
  const comment = String(form.get('comment') ?? '').trim().slice(0, 2000);
  if (![1, 2, 3, 4, 5].includes(satisfaction) || ![1, 2, 3, 4, 5].includes(ease)) return { error: 'Choose a rating from 1 to 5 for both questions.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_survey', { p_satisfaction: satisfaction, p_ease: ease, p_faster: faster, p_comment: comment || null });
  if (error) return { error: readableError(error) };
  revalidatePath('/', 'layout');
  return { ok: 'Thank you. Your answers are saved. You can change them here until the survey closes.' };
}
