'use client';
import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { reviewCertificate } from '../../actions';

export function ReviewForm({ leaveId, leaveRef }: { leaveId: string; leaveRef: string }) {
  const [state, action] = useActionState(reviewCertificate, null);
  const [note, setNote] = useState('');
  if (state?.ok) return <p role="status" className="text-sm font-medium text-ok-fg">{state.ok}</p>;
  return (
    <form action={action} className="flex flex-col gap-3 border-t border-line pt-4">
      <input type="hidden" name="leave_id" value={leaveId} />
      <input type="hidden" name="ref" value={leaveRef} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="review-note" className="text-sm font-semibold text-ink-soft">If you return it, say what is wrong</label>
        <textarea id="review-note" name="note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="field-input"
          placeholder="For example: the certificate is not signed by the doctor" />
      </div>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="accept" pendingText="Saving…">Accept certificate</SubmitButton>
        <SubmitButton name="decision" value="return" variant="danger" pendingText="Saving…" disabled={!note.trim()}>Return to student</SubmitButton>
      </div>
    </form>
  );
}
