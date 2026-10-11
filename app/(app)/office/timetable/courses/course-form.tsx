'use client';
import { useActionState, useState } from 'react';
import { Field } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { saveCourseCode } from '../actions';

export type CourseCodeRow = {
  id: string; batch: string; course_code: string; variant: string; course_name: string;
  faculty_id: string; sections: string[]; elective: boolean;
};

export function CourseForm({ row, batches, faculty, defaultBatch, onDone }: {
  row?: CourseCodeRow;
  batches: string[];
  faculty: { id: string; full_name: string }[];
  defaultBatch?: string;
  onDone?: () => void;
}) {
  const [state, action] = useActionState(async (prev: Parameters<typeof saveCourseCode>[0], form: FormData) => {
    const res = await saveCourseCode(prev, form);
    if (res.ok && onDone) onDone();
    return res;
  }, null);
  const k = row?.id ?? 'new';
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
      {row && <input type="hidden" name="id" value={row.id} />}
      <Field label="Batch" htmlFor={`cc-batch-${k}`} className="lg:col-span-1">
        <select id={`cc-batch-${k}`} name="batch" required defaultValue={row?.batch ?? defaultBatch ?? batches[0]} className="field-input">
          {batches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </Field>
      <Field label="Code in the sheet" htmlFor={`cc-code-${k}`} hint="e.g. TAMA" className="lg:col-span-1">
        <input id={`cc-code-${k}`} name="course_code" required maxLength={10} defaultValue={row?.course_code} className="field-input uppercase" />
      </Field>
      <Field label="Followed by" htmlFor={`cc-variant-${k}`} hint="A in TAMA_A12, SB in DTHR_SB3; empty for MDI_7" className="lg:col-span-1">
        <input id={`cc-variant-${k}`} name="variant" maxLength={6} defaultValue={row?.variant} className="field-input uppercase" placeholder="(nothing)" />
      </Field>
      <Field label="Course name" htmlFor={`cc-name-${k}`} className="sm:col-span-2 lg:col-span-3">
        <input id={`cc-name-${k}`} name="course_name" required maxLength={120} defaultValue={row?.course_name} className="field-input" />
      </Field>
      <Field label="Faculty" htmlFor={`cc-fac-${k}`} className="sm:col-span-2 lg:col-span-3">
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

export function EditableRow({ row, batches, faculty, facultyName }: {
  row: CourseCodeRow; batches: string[]; faculty: { id: string; full_name: string }[]; facultyName: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <tr>
        <td colSpan={5} className="bg-canvas">
          <CourseForm row={row} batches={batches} faculty={faculty} onDone={() => setEditing(false)} />
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
      <td className="text-right"><button type="button" onClick={() => setEditing(true)} className="text-sm font-semibold text-navy-700 hover:underline">Edit</button></td>
    </tr>
  );
}
