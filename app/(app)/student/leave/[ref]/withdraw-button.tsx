'use client';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/primitives';
import { withdrawLeave } from '../../actions';

export function WithdrawButton({ leaveId, leaveRef }: { leaveId: string; leaveRef: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return <Button variant="danger" onClick={() => setConfirming(true)}>Withdraw request</Button>;
  }
  return (
    <div className="rounded border border-bad-line bg-bad-bg p-3">
      <p className="text-sm font-semibold text-bad-fg">Withdraw {leaveRef}?</p>
      <p className="mt-0.5 text-xs text-bad-fg">This cannot be undone. You would need to apply again.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => start(async () => {
            const res = await withdrawLeave(leaveId, leaveRef);
            if (res.error) setError(res.error); else setConfirming(false);
          })}
        >
          {pending ? 'Withdrawing…' : 'Yes, withdraw'}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>Keep it</Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-bad-fg">{error}</p>}
    </div>
  );
}
