'use client';
import { useActionState, useState, useTransition } from 'react';
import { Button, Field } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { addDelegation, endDelegation } from './actions';

export function DelegationForm({ people, today }: { people: { id: string; label: string }[]; today: string }) {
  const [state, action] = useActionState(addDelegation, null);
  const [from, setFrom] = useState(today);
  return (
    <form action={action} key={state?.ok ?? 'form'} className="flex flex-col gap-4 px-5 py-5">
      <Field label="Who decides while the Dean is away" htmlFor="delegate" hint="A faculty member or a Dean HRM Office colleague. They will see what the Dean sees, including medical reasons.">
        <select id="delegate" name="delegate" required defaultValue="" className="field-input">
          <option value="" disabled>Choose a person</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="From" htmlFor="from">
          <input id="from" name="from" type="date" required min={today} value={from} onChange={(e) => setFrom(e.target.value)} className="field-input" />
        </Field>
        <Field label="Until (inclusive)" htmlFor="to">
          <input id="to" name="to" type="date" required min={from} defaultValue={from} className="field-input" />
        </Field>
      </div>
      <Field label="Reason" htmlFor="reason" hint="Optional. Shown to the person you name.">
        <input id="reason" name="reason" maxLength={300} className="field-input" placeholder="For example: Dean at the AIMS conference" />
      </Field>
      <FormMessage state={state} />
      <div><SubmitButton pendingText="Saving…">Name this person</SubmitButton></div>
    </form>
  );
}

export function EndButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (msg) return <span className="text-xs font-medium text-ok-fg">{msg}</span>;
  return (
    <Button variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await endDelegation(id); setMsg(r.error ?? r.ok ?? null); })}>
      {pending ? 'Ending…' : 'End now'}
    </Button>
  );
}
