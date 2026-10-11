'use client';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/primitives';
import type { ActionResult } from '@/lib/types';

type Kind = 'acknowledge' | 'note' | 'flag';

/** Acknowledge / note / flag controls, shared by the signed-in inbox and the one-time link page. */
export function RespondPanel({ onRespond, compact = false }: { onRespond: (kind: Kind, note?: string) => Promise<ActionResult>; compact?: boolean }) {
  const [mode, setMode] = useState<'note' | 'flag' | null>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const send = (kind: Kind, note?: string) =>
    start(async () => {
      const res = await onRespond(kind, note);
      setResult(res);
      if (res.ok) { setMode(null); setText(''); }
    });

  if (result?.ok) return <p role="status" className="text-sm font-medium text-ok-fg">{result.ok}</p>;

  return (
    <div className="flex flex-col gap-3">
      {mode ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`note-${mode}`} className="text-sm font-semibold text-ink-soft">
            {mode === 'flag' ? 'Concern for the Dean' : 'Note for the student'}
          </label>
          <textarea
            id={`note-${mode}`}
            rows={3}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="field-input"
            placeholder={mode === 'flag' ? 'For example: evaluation in this session; a make-up is possible only if leave is sanctioned before it.' : 'For example: quiz that day, make-up at my discretion.'}
            autoFocus
          />
          <p className="text-xs text-ink-muted">
            {mode === 'flag' ? 'Only the Dean and the Dean HRM Office see this.' : 'This is emailed to the student.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending || !text.trim()} onClick={() => send(mode, text)}>
              {pending ? 'Sending…' : mode === 'flag' ? 'Send to the Dean' : 'Acknowledge with note'}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => { setMode(null); setResult(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className={compact ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2 sm:flex-row sm:flex-wrap'}>
          <Button disabled={pending} onClick={() => send('acknowledge')}>{pending ? 'Saving…' : 'Acknowledge'}</Button>
          <Button variant="secondary" disabled={pending} onClick={() => setMode('note')}>Add a note</Button>
          <Button variant="secondary" disabled={pending} onClick={() => setMode('flag')}>Raise a concern</Button>
        </div>
      )}
      {result?.error && <p role="alert" className="text-sm text-bad-fg">{result.error}</p>}
    </div>
  );
}
