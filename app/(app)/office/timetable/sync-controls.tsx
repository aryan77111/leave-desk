'use client';
import { useActionState, useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, Field } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import type { ActionResult } from '@/lib/types';
import { saveSheet, setSheetArchived, setSheetEnabled, syncTimetable } from './actions';

export function SyncButton({ sheetId = null, force = false, label, variant = 'secondary' }: {
  sheetId?: string | null; force?: boolean; label: string; variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-col gap-1.5">
      <Button type="button" variant={variant} disabled={pending} onClick={() => start(async () => setMsg(await syncTimetable(sheetId, force)))}>
        <RefreshCw className={pending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
        {pending ? 'Syncing…' : label}
      </Button>
      {msg && <span className="max-w-md"><FormMessage state={msg} /></span>}
    </span>
  );
}

function TextAction({ run, label, pendingLabel = 'Saving…', tone = 'quiet' }: {
  run: () => Promise<ActionResult>; label: string; pendingLabel?: string; tone?: 'quiet' | 'link';
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" disabled={pending} onClick={() => start(async () => setMsg(await run()))}
        className={tone === 'link' ? 'text-sm font-semibold text-navy-700 hover:underline disabled:opacity-60' : 'text-sm font-semibold text-ink-muted hover:text-ink disabled:opacity-60'}>
        {pending ? pendingLabel : label}
      </button>
      {msg?.error && <FormMessage state={msg} />}
    </span>
  );
}

export function PauseToggle({ id, enabled }: { id: string; enabled: boolean }) {
  return <TextAction run={() => setSheetEnabled(id, !enabled)} label={enabled ? 'Pause' : 'Resume'} />;
}

export function ArchiveToggle({ id, archived }: { id: string; archived: boolean }) {
  return archived
    ? <TextAction tone="link" run={() => setSheetArchived(id, false)} label="Bring back" />
    : <TextAction run={() => setSheetArchived(id, true)} label="Archive (term over)" />;
}

export function SheetForm({ sheet, batches }: { sheet?: { id: string; batch: string; term: string; link: string }; batches: string[] }) {
  const [state, action] = useActionState(saveSheet, null);
  const k = sheet?.id ?? 'new';
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-[9rem_9rem_1fr_auto] sm:items-end">
      {sheet && <input type="hidden" name="id" value={sheet.id} />}
      <Field label="Batch" htmlFor={`sh-batch-${k}`}>
        {sheet ? (
          <input id={`sh-batch-${k}`} value={sheet.batch} readOnly className="field-input bg-canvas" />
        ) : (
          <input id={`sh-batch-${k}`} name="batch" required list="known-batches" placeholder="2026-28" className="field-input" />
        )}
      </Field>
      <Field label="Term" htmlFor={`sh-term-${k}`}>
        <input id={`sh-term-${k}`} name="term" required maxLength={40} defaultValue={sheet?.term} placeholder="Term III" className="field-input" />
      </Field>
      <Field label="Google Sheet link" htmlFor={`sh-link-${k}`} hint="Shared as “Anyone with the link can view”">
        <input id={`sh-link-${k}`} name="link" required defaultValue={sheet?.link} placeholder="https://docs.google.com/spreadsheets/d/…" className="field-input" />
      </Field>
      <div className="sm:pb-[1.35rem]">
        <SubmitButton variant={sheet ? 'secondary' : 'primary'} pendingText="Saving…">{sheet ? 'Save' : 'Add sheet'}</SubmitButton>
      </div>
      <datalist id="known-batches">{batches.map((b) => <option key={b} value={b} />)}</datalist>
      {state && <div className="sm:col-span-4"><FormMessage state={state} /></div>}
    </form>
  );
}
