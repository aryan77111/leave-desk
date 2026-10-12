'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { CheckSquare, Square } from 'lucide-react';
import { StatusBadge } from '@/components/leave/badges';
import { Badge, Button } from '@/components/ui/primitives';
import { fmtRange, fmtStamp, TYPE_LABEL } from '@/lib/format';
import type { LeaveStatus, LeaveType } from '@/lib/types';
import { approveSelected, type BulkResult } from './actions';

export type QueueRow = {
  id: string; ref: string; type: LeaveType; status: LeaveStatus; from_date: string; to_date: string;
  student_name: string; student_meta: string; answered: number; acks: number; concerns: number;
  waiting: string; overdue: boolean; decided_at: string | null; filed_by_office: boolean; certificate_checked?: boolean;
};

/** The approval queue. In the "Waiting" view the Dean can tick requests and approve them together. */
export function QueueList({ rows, selectable }: { rows: QueueRow[]; selectable: boolean }) {
  const eligible = useMemo(() => rows.filter((r) => r.concerns === 0).map((r) => r.id), [rows]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [pending, start] = useTransition();

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = eligible.length > 0 && eligible.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(eligible));
  const chosen = rows.filter((r) => selected.has(r.id));

  const run = () => start(async () => {
    const res = await approveSelected([...selected], note);
    setResult(res);
    if (res.ok) { setSelected(new Set()); setConfirming(false); setNote(''); }
  });

  const check = (r: QueueRow) => {
    if (!selectable) return null;
    const disabled = r.concerns > 0;
    return (
      <input
        type="checkbox"
        aria-label={`Select ${r.ref}`}
        checked={selected.has(r.id)}
        disabled={disabled}
        title={disabled ? 'A faculty member raised a concern. Open the request to decide.' : undefined}
        onChange={() => toggle(r.id)}
        className="h-5 w-5 shrink-0 accent-navy-700 disabled:opacity-40 md:h-4 md:w-4"
      />
    );
  };

  const facultyCell = (r: QueueRow) => (
    <>
      <span className="tabular-nums">{r.answered} of {r.acks}</span>
      {r.concerns > 0 && <Badge tone="bad" className="ml-2">{r.concerns} concern{r.concerns > 1 ? 's' : ''}</Badge>}
    </>
  );

  return (
    <>
      {result && (
        <div role="status" className={clsx('border-b px-5 py-3 text-sm', result.error ? 'border-bad-line bg-bad-bg text-bad-fg' : 'border-ok-line bg-ok-bg text-ok-fg')}>
          <p className="font-semibold">{result.error ?? result.ok}</p>
          {result.skipped && result.skipped.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-ink">
              {result.skipped.map((s, i) => <li key={i}>{s.ref ?? 'A request'}: {s.reason}</li>)}
            </ul>
          )}
        </div>
      )}

      {selectable && rows.length > 1 && (
        <div className="flex items-center gap-3 border-b border-line px-5 py-2.5 text-sm">
          <button type="button" onClick={toggleAll} disabled={eligible.length === 0}
            className="inline-flex min-h-[40px] items-center gap-2 font-semibold text-navy-700 disabled:text-ink-faint md:min-h-0">
            {allOn ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {allOn ? 'Clear selection' : `Select all without concerns (${eligible.length})`}
          </button>
        </div>
      )}

      {/* Phones: one card per request */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-3 px-4 py-3.5">
            {selectable && <div className="pt-0.5">{check(r)}</div>}
            <Link href={`/approve/${r.ref}`} className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-navy-700">{r.student_name}</span>
                {selectable
                  ? r.overdue ? <Badge tone="bad">Overdue</Badge> : <span className="whitespace-nowrap text-xs text-ink-muted">{r.waiting}</span>
                  : <StatusBadge status={r.status} />}
              </div>
              <div className="mt-0.5 text-xs text-ink-muted">{r.student_meta}</div>
              <div className="mt-1.5 text-sm text-ink">{fmtRange(r.from_date, r.to_date)} <span className="text-ink-muted">· {TYPE_LABEL[r.type]}{r.certificate_checked && ', certificate checked'}</span></div>
              <div className="mt-1 text-xs text-ink-muted">Faculty: {facultyCell(r)}{r.filed_by_office && ' · filed by office'}</div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Wider screens: a table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="data-table">
          <thead>
            <tr>
              {selectable && <th className="w-10"><span className="sr-only">Select</span></th>}
              <th>Student</th><th>Leave</th><th>Faculty</th>
              <th>{selectable ? 'Waiting' : 'Decided'}</th>
              {!selectable && <th>Status</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={clsx('row-link', selected.has(r.id) && 'bg-navy-50/70')}>
                {selectable && <td>{check(r)}</td>}
                <td>
                  <Link href={`/approve/${r.ref}`} className="font-semibold text-navy-700 hover:underline">{r.student_name}</Link>
                  <div className="text-xs text-ink-muted">{r.student_meta}{r.filed_by_office && ' · filed by office'}</div>
                </td>
                <td className="whitespace-nowrap">{fmtRange(r.from_date, r.to_date)}<div className="text-xs text-ink-muted">{TYPE_LABEL[r.type]}{r.certificate_checked && ', certificate checked'}</div></td>
                <td className="whitespace-nowrap">{facultyCell(r)}</td>
                <td className="whitespace-nowrap">
                  {selectable
                    ? r.overdue ? <Badge tone="bad">Overdue · {r.waiting}</Badge> : <span className="text-ink-soft">{r.waiting}</span>
                    : r.decided_at ? fmtStamp(r.decided_at) : ''}
                </td>
                {!selectable && <td><StatusBadge status={r.status} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectable && selected.size > 0 && (
        <div className="sticky bottom-0 z-10 border-t border-line bg-white px-4 py-3 shadow-pop sm:px-5">
          {!confirming ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold text-ink">{selected.size} selected</span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                <Button onClick={() => setConfirming(true)}>Approve selected</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ink">
                Approve {selected.size} request{selected.size === 1 ? '' : 's'}? Approval is final, and each student is emailed.
              </p>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-ink-soft">Note to every student <span className="font-normal text-ink-muted">(optional)</span></span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="field-input" placeholder="For example: approved; meet your faculty about missed work" />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button disabled={pending} onClick={run}>{pending ? 'Approving…' : `Yes, approve ${selected.size}`}</Button>
                <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>Back</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
