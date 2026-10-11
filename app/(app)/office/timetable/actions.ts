'use server';
import { revalidatePath } from 'next/cache';
import { readableError } from '@/lib/errors';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/types';
import { extractFileId } from '@/lib/sheet-link';

const UUID = /^[0-9a-f-]{36}$/i;
const BATCH = /^[0-9A-Za-z][0-9A-Za-z -]{0,19}$/;

type SyncResult = { batch: string; status: string; message?: string; added?: number; restored?: number; changed?: number; cancelled?: number; would_cancel?: number; leaves_affected?: number };

function describe(r: SyncResult) {
  if (r.status === 'unchanged') return `${r.batch}: no changes in the sheet since the last sync.`;
  if (r.status === 'blocked') return `${r.batch}: not applied. It would cancel ${r.would_cancel} upcoming classes; check the sheet, then use Sync anyway if that is right.`;
  if (r.status === 'error') return `${r.batch}: ${r.message}`;
  const added = (r.added ?? 0) + (r.restored ?? 0);
  if (added + (r.changed ?? 0) + (r.cancelled ?? 0) === 0) return `${r.batch}: up to date.`;
  return `${r.batch}: ${added} added, ${r.changed ?? 0} changed, ${r.cancelled ?? 0} cancelled${r.leaves_affected ? `; ${r.leaves_affected} leave request(s) affected` : ''}.`;
}

export async function syncTimetable(batch: string | null, force: boolean): Promise<ActionResult> {
  await requireViewer('office');
  if (batch !== null && !BATCH.test(batch)) return { error: 'Unknown batch.' };
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('sync-timetable', { body: { ...(batch ? { batch } : {}), force } });
  revalidatePath('/office/timetable');
  if (error) return { error: 'The sync service could not be reached. Try again in a minute.' };
  const results = ((data as { results?: SyncResult[] })?.results ?? []);
  if (results.length === 0) return { error: 'No sheets are set up to sync.' };
  const text = results.map(describe).join(' ');
  return results.some((r) => r.status === 'error' || r.status === 'blocked') ? { error: text } : { ok: text };
}

export async function saveSource(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('office');
  const batch = String(form.get('batch') ?? '').trim();
  const link = String(form.get('link') ?? '');
  const label = String(form.get('label') ?? '').trim() || null;
  if (!BATCH.test(batch)) return { error: 'Write the batch the way students are recorded, for example 2025-27.' };
  const fileId = extractFileId(link);
  if (!fileId) return { error: 'Paste the sheet\'s link from the browser address bar or the Share button.' };
  const supabase = await createClient();
  const { data: updated, error: upErr } = await supabase.from('timetable_sources').update({ file_id: fileId, label, enabled: true }).eq('batch', batch).select('batch');
  if (upErr) return { error: readableError(upErr) };
  if (!updated?.length) {
    const { error } = await supabase.from('timetable_sources').insert({ batch, file_id: fileId, label });
    if (error) return { error: readableError(error) };
  }
  revalidatePath('/office/timetable');
  return { ok: `Sheet saved for ${batch}. Add its course codes, then sync.` };
}

export async function setSourceEnabled(batch: string, enabled: boolean): Promise<ActionResult> {
  await requireViewer('office');
  const supabase = await createClient();
  const { error } = await supabase.from('timetable_sources').update({ enabled }).eq('batch', batch);
  if (error) return { error: readableError(error) };
  revalidatePath('/office/timetable');
  return { ok: enabled ? 'Automatic sync resumed.' : 'Automatic sync paused. The timetable stays as it is.' };
}

export async function saveCourseCode(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('office');
  const id = String(form.get('id') ?? '');
  const row = {
    batch: String(form.get('batch') ?? '').trim(),
    course_code: String(form.get('course_code') ?? '').trim().toUpperCase(),
    variant: String(form.get('variant') ?? '').trim().toUpperCase().replace(/[\s_-]/g, ''),
    course_name: String(form.get('course_name') ?? '').trim(),
    faculty_id: String(form.get('faculty_id') ?? ''),
    sections: [...new Set(String(form.get('sections') ?? '').toUpperCase().split(/[\s,;/]+/).filter(Boolean))].sort(),
    elective: form.get('elective') === 'on',
  };
  if (!BATCH.test(row.batch)) return { error: 'Choose the batch.' };
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(row.course_code)) return { error: 'The course code should be 2–10 letters or digits, as written in the sheet (for example TAMA).' };
  if (!/^[A-Z0-9]{0,6}$/.test(row.variant)) return { error: 'The part after the code should be up to 6 letters or digits (for example A, SB or RGP), or empty.' };
  if (!row.course_name) return { error: 'Add the course name.' };
  if (!UUID.test(row.faculty_id)) return { error: 'Choose the faculty member.' };
  if (row.sections.length === 0 || row.sections.some((s) => !/^[A-Z0-9]{1,3}$/.test(s))) return { error: 'List the sections that attend, for example A or A, B.' };

  const supabase = await createClient();
  const { error } = id && UUID.test(id)
    ? await supabase.from('course_codes').update(row).eq('id', id)
    : await supabase.from('course_codes').insert(row);
  if (error) {
    if (error.code === '23505') return { error: `${row.course_code}${row.variant ? ` (${row.variant})` : ''} is already set up for ${row.batch}. Edit that one instead.` };
    if (error.code === '23503') return { error: 'Set up the sheet for this batch first.' };
    return { error: readableError(error) };
  }
  revalidatePath('/office/timetable/courses');
  revalidatePath('/office/timetable');
  return { ok: 'Saved. The next sync uses it.' };
}
