'use client';
import { useState, useTransition } from 'react';
import { setPersonActive } from '../actions';

export function ActiveToggle({ personId, active }: { personId: string; active: boolean }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (next: boolean) => start(async () => {
    const res = await setPersonActive(personId, next);
    if (res.error) setError(res.error);
    setConfirm(false);
  });

  if (!active) {
    return <button disabled={pending} onClick={() => run(true)} className="text-sm font-semibold text-navy-700 hover:underline disabled:opacity-60">Reactivate</button>;
  }
  if (!confirm) {
    return <button onClick={() => setConfirm(true)} className="text-sm font-semibold text-ink-muted hover:text-bad-fg">Deactivate</button>;
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2 text-sm">
      <span className="text-ink-soft">Remove access?</span>
      <button disabled={pending} onClick={() => run(false)} className="font-semibold text-bad-fg hover:underline disabled:opacity-60">{pending ? 'Working…' : 'Yes'}</button>
      <button disabled={pending} onClick={() => setConfirm(false)} className="font-semibold text-ink-muted hover:underline">No</button>
      {error && <span role="alert" className="w-full text-right text-xs text-bad-fg">{error}</span>}
    </span>
  );
}
