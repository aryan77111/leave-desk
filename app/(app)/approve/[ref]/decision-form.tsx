'use client';
import { useActionState, useState } from 'react';
import { Card } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { decideLeave } from '../actions';

export function DecisionForm({ leaveId, leaveRef, medical, docDays }: { leaveId: string; leaveRef: string; medical: boolean; docDays: number }) {
  const [state, action] = useActionState(decideLeave, null);
  const [note, setNote] = useState('');

  if (state?.ok) {
    return (
      <Card title="Decision recorded">
        <p role="status" className="px-5 py-4 text-sm text-ok-fg">{state.ok}</p>
      </Card>
    );
  }

  return (
    <Card title="Your decision">
      <form action={action} className="flex flex-col gap-4 px-5 py-4">
        <input type="hidden" name="leave_id" value={leaveId} />
        <input type="hidden" name="ref" value={leaveRef} />
        <p className="text-sm text-ink-soft">
          {medical
            ? `Approval is provisional until the student uploads a medical certificate, due within ${docDays} days of resuming classes.`
            : 'No documents are needed. Approval is final.'}
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="note" className="text-sm font-semibold text-ink-soft">Note to the student</label>
          <textarea id="note" name="note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="field-input"
            placeholder="Optional when approving. Required when rejecting." />
        </div>
        <FormMessage state={state} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="decision" value="approve" pendingText="Saving…">{medical ? 'Sanction (provisional)' : 'Approve'}</SubmitButton>
          <SubmitButton name="decision" value="reject" variant="danger" pendingText="Saving…" disabled={!note.trim()}
            title={note.trim() ? undefined : 'Write a note explaining the rejection first'}>
            Reject
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}
