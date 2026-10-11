'use client';
import { useActionState, useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, Field } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import type { ActionResult } from '@/lib/types';
import { saveSource, setSourceEnabled, syncTimetable } from './actions';

export function SyncButton({ batch = null, force = false, label, variant = 'secondary' }: {
  batch?: string | null; force?: boolean; label: string; variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-col gap-1.5">
      <Button type="button" variant={variant} disabled={pending} onClick={() => start(async () => setMsg(await syncTimetable(batch, force)))}>
        <RefreshCw className={pending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
        {pending ? 'Syncing…' : label}
      </Button>
      {msg && <span className="max-w-md"><FormMessage state={msg} /></span>}
    </span>
  );
}

export function PauseToggle({ batch, enabled }: { batch: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" disabled={pending} onClick={() => start(async () => setMsg(await setSourceEnabled(batch, !enabled)))}
        className="text-sm font-semibold text-ink-muted hover:text-ink disabled:opacity-60">
        {pending ? 'Saving…' : enabled ? 'Pause automatic sync' : 'Resume automatic sync'}
      </button>
      {msg?.error && <FormMessage state={msg} />}
    </span>
  );
}

export function SourceForm({ batch, link, batches }: { batch?: string; link?: string; batches: string[] }) {
  const [state, action] = useActionState(saveSource, null);
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
      <Field label="Batch" htmlFor={`src-batch-${batch ?? 'new'}`} hint={batch ? undefined : 'As on student records'}>
        {batch ? (
          <>
            <input type="hidden" name="batch" value={batch} />
            <input id={`src-batch-${batch}`} value={batch} readOnly className="field-input bg-canvas" />
          </>
        ) : (
          <input id="src-batch-new" name="batch" required list="known-batches" placeholder="2026-28" className="field-input" />
        )}
      </Field>
      <Field label="Google Sheet link" htmlFor={`src-link-${batch ?? 'new'}`} hint="Shared as “Anyone with the link can view”">
        <input id={`src-link-${batch ?? 'new'}`} name="link" required defaultValue={link} placeholder="https://docs.google.com/spreadsheets/d/…" className="field-input" />
      </Field>
      <div className="flex flex-col gap-1 sm:pb-[1.35rem]">
        <SubmitButton variant="secondary" pendingText="Saving…">{batch ? 'Save link' : 'Add sheet'}</SubmitButton>
      </div>
      <datalist id="known-batches">{batches.map((b) => <option key={b} value={b} />)}</datalist>
      {state && <div className="sm:col-span-3"><FormMessage state={state} /></div>}
    </form>
  );
}
