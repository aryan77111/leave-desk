'use client';
import { useState, useTransition } from 'react';
import { setBatchActive } from '../actions';

export function BatchAction({ batch, section, active, inactive }: { batch: string; section: string; active: number; inactive: number }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  const run = (makeActive: boolean) => start(async () => {
    setMsg(await setBatchActive(batch, section, makeActive));
    setConfirming(false);
  });

  if (msg?.ok) return <span role="status" className="text-sm text-ok-fg">{msg.ok}</span>;

  return (
    <div className="flex flex-col items-end gap-1 text-sm">
      {active > 0 && !confirming && (
        <button onClick={() => setConfirming(true)} className="font-semibold text-ink-muted hover:text-bad-fg">Mark as graduated</button>
      )}
      {confirming && (
        <span className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-ink-soft">Deactivate {active} student{active === 1 ? '' : 's'}?</span>
          <button disabled={pending} onClick={() => run(false)} className="font-semibold text-bad-fg hover:underline disabled:opacity-60">{pending ? 'Working…' : 'Yes'}</button>
          <button disabled={pending} onClick={() => setConfirming(false)} className="font-semibold text-ink-muted hover:underline">No</button>
        </span>
      )}
      {active === 0 && inactive > 0 && (
        <button disabled={pending} onClick={() => run(true)} className="font-semibold text-navy-700 hover:underline disabled:opacity-60">{pending ? 'Working…' : 'Restore'}</button>
      )}
      {msg?.error && <span role="alert" className="max-w-xs text-right text-xs text-bad-fg">{msg.error}</span>}
    </div>
  );
}
