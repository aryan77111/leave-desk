'use client';
import { useActionState, useState } from 'react';
import { Card } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { decideLeave } from '../actions';

export function DecisionForm({ leaveId, leaveRef, delegate = false }: { leaveId: string; leaveRef: string; delegate?: boolean }) {
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
    <Card title="Your decision" description={delegate ? 'Recorded as made on behalf of the Dean.' : undefined}>
      <form action={action} className="flex flex-col gap-4 px-5 py-4">
        <input type="hidden" name="leave_id" value={leaveId} />
        <input type="hidden" name="ref" value={leaveRef} />
        <p className="text-sm text-ink-soft">Approval is final. The student is emailed either way.</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="note" className="text-sm font-semibold text-ink-soft">Note to the student</label>
          <textarea id="note" name="note" rows={3}  maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="field-input"
            placeholder="Optional when approving. Required when rejecting." />
        </div>
        <FormMessage state={state} />
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
          <SubmitButton name="decision" value="approve" pendingText="Saving…" className="h-11 sm:h-9">Approve</SubmitButton>
          <SubmitButton name="decision" value="reject" variant="danger" pendingText="Saving…" disabled={!note.trim()} className="h-11 sm:h-9"
            title={note.trim() ? undefined : 'Write a note explaining the rejection first'}>
            Reject
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}
