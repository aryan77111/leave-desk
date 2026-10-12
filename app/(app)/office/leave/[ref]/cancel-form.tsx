'use client';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { cancelLeave } from '../../actions';

export function CancelForm({ leaveId, leaveRef }: { leaveId: string; leaveRef: string }) {
  const [state, action] = useActionState(cancelLeave, null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (state?.ok) return <p role="status" className="text-sm font-medium text-ok-fg">{state.ok}</p>;
  if (!open) return <Button variant="danger" onClick={() => setOpen(true)}>Cancel this request</Button>;
  return (
    <form action={action} className="flex flex-col gap-3 rounded border border-bad-line bg-bad-bg p-3">
      <input type="hidden" name="leave_id" value={leaveId} />
      <input type="hidden" name="ref" value={leaveRef} />
      <label htmlFor="cancel-note" className="text-sm font-semibold text-bad-fg">Why is {leaveRef} being cancelled?</label>
      <textarea id="cancel-note" name="note" rows={2} maxLength={1000} required value={note} onChange={(e) => setNote(e.target.value)} className="field-input"
        placeholder="For example: filed for the wrong student" />
      <p className="text-xs text-bad-fg">The student sees this reason. This cannot be undone; file a new request if needed.</p>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="danger" pendingText="Cancelling…" disabled={note.trim().length < 3}>Yes, cancel it</SubmitButton>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Keep it</Button>
      </div>
    </form>
  );
}
