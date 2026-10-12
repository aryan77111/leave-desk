'use server';
import { revalidatePath } from 'next/cache';
import { readableError } from '@/lib/errors';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/types';
import { extractFileId } from '@/lib/sheet-link';

const UUID = /^[0-9a-f-]{36}$/i;
const BATCH = /^[0-9A-Za-z][0-9A-Za-z -]{0,19}$/;

type SyncResult = {
  batch: string; term: string; status: string; message?: string; added?: number; restored?: number;
  changed?: number; cancelled?: number; would_cancel?: number; leaves_affected?: number;
};

function describe(r: SyncResult) {
  const who = `${r.batch} ${r.term}`;
  if (r.status === 'unchanged') return `${who}: no changes since the last sync.`;
  if (r.status === 'blocked') return `${who}: not applied. It would cancel ${r.would_cancel} upcoming classes; check the sheet, then use Sync anyway if that is right.`;
  if (r.status === 'error') return `${who}: ${r.message}`;
  const added = (r.added ?? 0) + (r.restored ?? 0);
  if (added + (r.changed ?? 0) + (r.cancelled ?? 0) === 0) return `${who}: up to date.`;
  return `${who}: ${added} added, ${r.changed ?? 0} changed, ${r.cancelled ?? 0} cancelled${r.leaves_affected ? `; ${r.leaves_affected} leave request(s) affected` : ''}.`;
}

function done(paths: string[] = []) {
  revalidatePath('/office/timetable');
  for (const p of paths) revalidatePath(p);
}

export async function syncTimetable(sheetId: string | null, force: boolean): Promise<ActionResult> {
  await requireViewer('office');
  if (sheetId !== null && !UUID.test(sheetId)) return { error: 'Unknown sheet.' };
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('sync-timetable', { body: { ...(sheetId ? { sheet: sheetId } : {}), force } });
  done();
  if (error) return { error: 'The sync service could not be reached. Try again in a minute.' };
  const results = ((data as { results?: SyncResult[] })?.results ?? []);
  if (results.length === 0) return { error: 'No active sheets to sync.' };
  const text = results.map(describe).join(' ');
  return results.some((r) => r.status === 'error' || r.status === 'blocked') ? { error: text } : { ok: text };
}

/** Adds a term's sheet, or changes the link or name of an existing one. */
export async function saveSheet(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('office');
  const id = String(form.get('id') ?? '');
  const batch = String(form.get('batch') ?? '').trim();
  const term = String(form.get('term') ?? '').trim().replace(/\s+/g, ' ');
  const fileId = extractFileId(String(form.get('link') ?? ''));
  if (!term || term.length > 40) return { error: 'Name the term, for example Term III.' };
  if (!fileId) return { error: 'Paste the sheet\'s link from the browser address bar or the Share button.' };
  const supabase = await createClient();
  if (id) {
    if (!UUID.test(id)) return { error: 'Unknown sheet.' };
    const { error } = await supabase.from('timetable_sheets').update({ term, file_id: fileId }).eq('id', id);
    if (error) return { error: error.code === '23505' ? `This batch already has a sheet called ${term}.` : readableError(error) };
    done();
    return { ok: 'Saved. The next sync reads the new link.' };
  }
  if (!BATCH.test(batch)) return { error: 'Write the batch the way students are recorded, for example 2025-27.' };
  const { error } = await supabase.from('timetable_sheets').insert({ batch, term, file_id: fileId });
  if (error) return { error: error.code === '23505' ? `${batch} already has a sheet called ${term}.` : readableError(error) };
  done(['/office/timetable/courses']);
  return { ok: `${batch} ${term} added. Next, add its course codes; the sheet is read once they are in.` };
}

export async function setSheetEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  await requireViewer('office');
  if (!UUID.test(id)) return { error: 'Unknown sheet.' };
  const supabase = await createClient();
  const { error } = await supabase.from('timetable_sheets').update({ enabled }).eq('id', id);
  if (error) return { error: readableError(error) };
  done();
  return { ok: enabled ? 'Automatic sync resumed.' : 'Automatic sync paused. The timetable stays as it is.' };
}

export async function setSheetArchived(id: string, archived: boolean): Promise<ActionResult> {
  await requireViewer('office');
  if (!UUID.test(id)) return { error: 'Unknown sheet.' };
  const supabase = await createClient();
  const { error } = await supabase.from('timetable_sheets')
    .update(archived ? { archived_at: new Date().toISOString(), enabled: false } : { archived_at: null, enabled: true }).eq('id', id);
  if (error) return { error: readableError(error) };
  done(['/office/timetable/courses']);
  return { ok: archived ? 'Archived. Its classes stay as they are and are no longer synced.' : 'Back in use. It is read at the next sync.' };
}

export async function saveCourseCode(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireViewer('office');
  const id = String(form.get('id') ?? '');
  const row = {
    sheet_id: String(form.get('sheet_id') ?? ''),
    course_code: String(form.get('course_code') ?? '').trim().toUpperCase(),
    variant: String(form.get('variant') ?? '').trim().toUpperCase().replace(/[\s_-]/g, ''),
    course_name: String(form.get('course_name') ?? '').trim(),
    faculty_id: String(form.get('faculty_id') ?? ''),
    sections: [...new Set(String(form.get('sections') ?? '').toUpperCase().split(/[\s,;/]+/).filter(Boolean))].sort(),
    elective: form.get('elective') === 'on',
  };
  if (!UUID.test(row.sheet_id)) return { error: 'Choose the term sheet.' };
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(row.course_code)) return { error: 'The course code should be 2–10 letters or digits, as written in the sheet (for example TAMA).' };
  if (!/^[A-Z0-9]{0,6}$/.test(row.variant)) return { error: 'The part after the code should be up to 6 letters or digits (for example A, SB or RGP), or empty.' };
  if (!row.course_name) return { error: 'Add the course name.' };
  if (!UUID.test(row.faculty_id)) return { error: 'Choose the faculty member.' };
  if (row.sections.length === 0 || row.sections.some((s) => !/^[A-Z0-9]{1,3}$/.test(s))) return { error: 'List the sections that attend, for example A or A, B.' };

  const supabase = await createClient();
  const { error } = id && UUID.test(id)
    ? await supabase.from('sheet_course_codes').update(row).eq('id', id)
    : await supabase.from('sheet_course_codes').insert(row);
  if (error) {
    if (error.code === '23505') return { error: `${row.course_code}${row.variant ? ` (${row.variant})` : ''} is already set up for this term. Edit that one instead.` };
    return { error: readableError(error) };
  }
  done(['/office/timetable/courses']);
  return { ok: 'Saved. The next sync uses it.' };
}

export async function deleteCourseCode(id: string): Promise<ActionResult> {
  await requireViewer('office');
  if (!UUID.test(id)) return { error: 'Unknown course code.' };
  const supabase = await createClient();
  const { error } = await supabase.from('sheet_course_codes').delete().eq('id', id);
  if (error) return { error: readableError(error) };
  done(['/office/timetable/courses']);
  return { ok: 'Removed.' };
}
