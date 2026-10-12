'use client';
import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { reviewCertificate } from '../../actions';

export function ReviewForm({ leaveId, leaveRef }: { leaveId: string; leaveRef: string }) {
  const [state, action] = useActionState(reviewCertificate, null);
  const [note, setNote] = useState('');
  if (state?.ok) return <p role="status" className="text-sm font-medium text-ok-fg">{state.ok}</p>;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="leave_id" value={leaveId} />
      <input type="hidden" name="ref" value={leaveRef} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="review-note" className="text-sm font-semibold text-ink-soft">Note</label>
        <textarea id="review-note" name="note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="field-input"
          placeholder="For example: not signed by the doctor" />
        <p className="text-xs text-ink-muted">Needed to return it, and emailed to the student. Optional when accepting; then only staff see it.</p>
      </div>
      <FormMessage state={state} />
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <SubmitButton name="decision" value="accept" pendingText="Saving…">Accept and send to the Dean</SubmitButton>
        <SubmitButton name="decision" value="return" variant="danger" pendingText="Saving…" disabled={!note.trim()}>Return to student</SubmitButton>
      </div>
    </form>
  );
}
