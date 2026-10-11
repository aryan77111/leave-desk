'use client';
import { useActionState, useState } from 'react';
import { Card, Field } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import type { ActionResult, Person } from '@/lib/types';

const ROLE_CHOICES = [
  { value: 'student', label: 'Student', hint: 'Applies for leave' },
  { value: 'faculty', label: 'Faculty', hint: 'Gets leave notices for their sessions' },
  { value: 'dean', label: 'Dean', hint: 'Decides leave requests' },
  { value: 'office', label: 'Dean HRM Office', hint: 'Manages people, timetable, certificates and rules' },
];

export function PersonForm({ person, action, submitLabel }: {
  person?: Person;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const initialRoles = new Set<string>((person?.roles ?? ['student']).map((r) => (r === 'approver' ? 'dean' : r)));
  const [roles, setRoles] = useState(initialRoles);
  const isStudent = roles.has('student');
  const toggle = (r: string) => setRoles((prev) => { const n = new Set(prev); if (n.has(r)) n.delete(r); else n.add(r); return n; });

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-6">
      {person && <input type="hidden" name="id" value={person.id} />}
      <Card title="Person">
        <div className="grid grid-cols-1 gap-5 px-5 py-5 sm:grid-cols-2">
          <Field label="Full name" htmlFor="full_name">
            <input id="full_name" name="full_name" required maxLength={120} defaultValue={person?.full_name} className="field-input" />
          </Field>
          <Field label="College email" htmlFor="email" hint={person ? 'Changing this means they sign in with the new address.' : 'They sign in with Google using this address.'}>
            <input id="email" name="email" type="email" required defaultValue={person?.email} className="field-input" />
          </Field>
        </div>
      </Card>

      <Card title="Roles" description="A person can have more than one role, for example Faculty and Dean.">
        <div className="grid grid-cols-1 gap-2 px-5 py-5 sm:grid-cols-2">
          {ROLE_CHOICES.map((r) => (
            <label key={r.value} className="flex cursor-pointer items-start gap-3 rounded border border-line px-3.5 py-3 hover:bg-canvas">
              <input type="checkbox" name="roles" value={r.value} checked={roles.has(r.value)} onChange={() => toggle(r.value)} className="mt-0.5 h-4 w-4 accent-navy-700" />
              <span><span className="block text-sm font-semibold text-ink">{r.label}</span><span className="text-xs text-ink-muted">{r.hint}</span></span>
            </label>
          ))}
        </div>
      </Card>

      {isStudent && (
        <Card title="Class" description="Missed sessions are matched to the timetable by batch and section.">
          <div className="grid grid-cols-1 gap-5 px-5 py-5 sm:grid-cols-2">
            <Field label="Student ID" htmlFor="student_no">
              <input id="student_no" name="student_no" required defaultValue={person?.student_no ?? ''} className="field-input" placeholder="UH25076" />
            </Field>
            <Field label="Programme" htmlFor="programme">
              <input id="programme" name="programme" defaultValue={person?.programme ?? 'MBA-HRM'} className="field-input" />
            </Field>
            <Field label="Batch" htmlFor="batch" hint="Write it the same way as in the timetable, for example 2025-27.">
              <input id="batch" name="batch" required defaultValue={person?.batch ?? ''} className="field-input" placeholder="2025-27" />
            </Field>
            <Field label="Section" htmlFor="section">
              <input id="section" name="section" required defaultValue={person?.section ?? ''} className="field-input" placeholder="A" />
            </Field>
          </div>
        </Card>
      )}

      {person && (
        <Card title="Access">
          <label className="flex items-start gap-3 px-5 py-4 text-sm">
            <input type="checkbox" name="active" defaultChecked={person.active} className="mt-0.5 h-4 w-4 accent-navy-700" />
            <span><span className="font-semibold text-ink">Active</span><br /><span className="text-ink-muted">Untick to stop this person signing in. Their leave history is kept.</span></span>
          </label>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingText="Saving…" disabled={roles.size === 0}>{submitLabel}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
