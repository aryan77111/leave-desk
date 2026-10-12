'use client';
import { useState, useTransition } from 'react';
import clsx from 'clsx';
import { setFeedbackStatus } from '../actions';

const LABEL = { new: 'New', seen: 'Seen', done: 'Done' } as const;

export function StatusButtons({ id, status }: { id: number; status: 'new' | 'seen' | 'done' }) {
  const [current, setCurrent] = useState(status);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div role="group" aria-label="Status" className="inline-flex overflow-hidden rounded border border-line-strong">
        {(['new', 'seen', 'done'] as const).map((s) => (
          <button key={s} type="button" disabled={pending} aria-pressed={current === s}
            onClick={() => start(async () => { const r = await setFeedbackStatus(id, s); if (r.error) setError(r.error); else { setCurrent(s); setError(null); } })}
            className={clsx('min-h-[36px] px-3 text-xs font-semibold', current === s ? 'bg-navy-700 text-white' : 'bg-white text-ink-soft hover:bg-canvas')}>
            {LABEL[s]}
          </button>
        ))}
      </div>
      {error && <span role="alert" className="text-xs text-bad-fg">{error}</span>}
    </div>
  );
}
