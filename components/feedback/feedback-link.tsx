'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { sendFeedback } from '@/app/(app)/feedback-actions';
import type { ActionResult } from '@/lib/types';

/** "Report a problem or suggest something" — opens a small dialog that remembers which page it came from. */
export function FeedbackLink() {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<'problem' | 'suggestion'>('problem');
  const [text, setText] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = dialog.current;
    const onClose = () => { setResult(null); };
    d?.addEventListener('close', onClose);
    return () => d?.removeEventListener('close', onClose);
  }, []);

  const open = () => { setResult(null); dialog.current?.showModal(); };
  const close = () => dialog.current?.close();
  const send = () => start(async () => {
    const res = await sendFeedback(kind, text, pathname, navigator.userAgent);
    setResult(res);
    if (res.ok) setText('');
  });

  return (
    <>
      <button type="button" onClick={open} className="font-semibold text-navy-700 hover:underline">Report a problem or suggest something</button>
      <dialog
        ref={dialog}
        aria-labelledby="feedback-title"
        className="w-[calc(100%-2rem)] max-w-md rounded-md border border-line p-0 shadow-pop backdrop:bg-navy-900/40"
        onClick={(e) => { if (e.target === dialog.current) close(); }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id="feedback-title" className="font-serif text-xl font-semibold text-navy-900">Tell the Dean HRM Office</h2>
          <button type="button" onClick={close} className="rounded p-1.5 text-ink-muted hover:bg-canvas" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        {result?.ok ? (
          <div className="px-5 py-5">
            <p role="status" className="text-sm font-medium text-ok-fg">{result.ok}</p>
            <div className="mt-4"><Button variant="secondary" onClick={close}>Close</Button></div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-5">
            <fieldset>
              <legend className="sr-only">What is it?</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['problem', 'suggestion'] as const).map((k) => (
                  <label key={k} className={clsx('cursor-pointer rounded border px-3 py-2 text-center text-sm font-semibold',
                    kind === k ? 'border-navy-700 bg-navy-50 text-navy-800 ring-1 ring-navy-700' : 'border-line-strong text-ink-soft hover:border-ink-faint')}>
                    <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                    {k === 'problem' ? 'Something is wrong' : 'A suggestion'}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="feedback-text" className="text-sm font-semibold text-ink-soft">
                {kind === 'problem' ? 'What happened, and what did you expect?' : 'What would make it better?'}
              </label>
              <textarea id="feedback-text" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} className="field-input"
                placeholder={kind === 'problem' ? 'For example: the certificate upload spins forever on my phone.' : 'For example: show the faculty name next to each session.'} />
              <p className="text-xs text-ink-muted">The page you are on is sent with it. {kind === 'problem' ? 'The office is emailed straight away.' : ''}</p>
            </div>
            {result?.error && <p role="alert" className="text-sm text-bad-fg">{result.error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending || text.trim().length < 3} onClick={send}>{pending ? 'Sending…' : 'Send'}</Button>
              <Button variant="ghost" onClick={close}>Cancel</Button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
