'use client';
import { useActionState, useState, useTransition } from 'react';
import { Field } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import type { ActionResult } from '@/lib/types';
import { deleteCourseCode, saveCourseCode } from '../actions';

export type CourseCodeRow = {
  id: string; sheet_id: string; course_code: string; variant: string; course_name: string;
  faculty_id: string; sections: string[]; elective: boolean;
};
export type SheetOption = { id: string; label: string };

export function CourseForm({ row, sheets, faculty, defaultSheet, onDone }: {
  row?: CourseCodeRow;
  sheets: SheetOption[];
  faculty: { id: string; full_name: string }[];
  defaultSheet?: string;
  onDone?: () => void;
}) {
  const [state, action] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const res = await saveCourseCode(prev, form);
    if (res.ok && onDone) onDone();
    return res;
  }, null);
  const k = row?.id ?? 'new';
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
      {row && <input type="hidden" name="id" value={row.id} />}
      <Field label="Term sheet" htmlFor={`cc-sheet-${k}`} className="sm:col-span-2 lg:col-span-2">
        <select id={`cc-sheet-${k}`} name="sheet_id" required defaultValue={row?.sheet_id ?? defaultSheet ?? sheets[0]?.id} className="field-input">
          {sheets.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="Code in the sheet" htmlFor={`cc-code-${k}`} hint="e.g. TAMA" className="lg:col-span-1">
        <input id={`cc-code-${k}`} name="course_code" required maxLength={10} defaultValue={row?.course_code} className="field-input uppercase" />
      </Field>
      <Field label="Followed by" htmlFor={`cc-variant-${k}`} hint="A in TAMA_A12, SB in DTHR_SB3; empty for MDI_7" className="lg:col-span-1">
        <input id={`cc-variant-${k}`} name="variant" maxLength={6} defaultValue={row?.variant} className="field-input uppercase" placeholder="(nothing)" />
      </Field>
      <Field label="Course name" htmlFor={`cc-name-${k}`} className="sm:col-span-2 lg:col-span-2">
        <input id={`cc-name-${k}`} name="course_name" required maxLength={120} defaultValue={row?.course_name} className="field-input" />
      </Field>
      <Field label="Faculty" htmlFor={`cc-fac-${k}`} hint="Not listed? Add them on People first." className="sm:col-span-2 lg:col-span-3">
        <select id={`cc-fac-${k}`} name="faculty_id" required defaultValue={row?.faculty_id ?? ''} className="field-input">
          <option value="" disabled>Choose…</option>
          {faculty.map((f) => <option key={f.id} value={f.id}>{f.full_name}</option>)}
        </select>
      </Field>
      <Field label="Sections attending" htmlFor={`cc-sec-${k}`} hint="A, or A, B for the whole batch" className="lg:col-span-1">
        <input id={`cc-sec-${k}`} name="sections" required defaultValue={row?.sections.join(', ') ?? 'A, B'} className="field-input uppercase" />
      </Field>
      <label className="flex items-start gap-2.5 text-sm lg:col-span-2 lg:pt-7">
        <input type="checkbox" name="elective" defaultChecked={row?.elective} className="mt-0.5 h-4 w-4 accent-navy-700" />
        <span><span className="font-semibold text-ink">Elective</span><br /><span className="text-ink-muted">Students untick it if they do not take it</span></span>
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-6">
        <SubmitButton pendingText="Saving…">{row ? 'Save' : 'Add course code'}</SubmitButton>
        {row && onDone && <button type="button" onClick={onDone} className="text-sm font-semibold text-ink-muted hover:text-ink">Cancel</button>}
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function EditableRow({ row, sheets, faculty, facultyName, readOnly = false }: {
  row: CourseCodeRow; sheets: SheetOption[]; faculty: { id: string; full_name: string }[]; facultyName: string; readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  if (editing) {
    return (
      <tr>
        <td colSpan={5} className="bg-canvas">
          <CourseForm row={row} sheets={sheets} faculty={faculty} onDone={() => setEditing(false)} />
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="whitespace-nowrap font-mono text-[13px] font-semibold">{row.course_code}_{row.variant}<span className="text-ink-faint">…</span></td>
      <td>{row.course_name}{row.elective && <span className="ml-2 text-xs font-semibold text-ink-muted">Elective</span>}</td>
      <td>{facultyName}</td>
      <td className="whitespace-nowrap">{row.sections.join(', ')}</td>
      <td className="whitespace-nowrap text-right">
        {!readOnly && !confirming && (
          <span className="inline-flex gap-4">
            <button type="button" onClick={() => setEditing(true)} className="text-sm font-semibold text-navy-700 hover:underline">Edit</button>
            <button type="button" onClick={() => setConfirming(true)} className="text-sm font-semibold text-ink-muted hover:text-bad-fg">Remove</button>
          </span>
        )}
        {confirming && (
          <span className="inline-flex items-center gap-2 text-sm">
            <span className="text-ink-soft">Remove?</span>
            <button type="button" disabled={pending} onClick={() => start(async () => { const r = await deleteCourseCode(row.id); setMsg(r); if (r.ok) setConfirming(false); })}
              className="font-semibold text-bad-fg hover:underline disabled:opacity-60">{pending ? 'Removing…' : 'Yes'}</button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="font-semibold text-ink-muted hover:underline">No</button>
          </span>
        )}
        {msg?.error && <FormMessage state={msg} />}
      </td>
    </tr>
  );
}
