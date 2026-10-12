import clsx from 'clsx';
import { Check, Minus, X } from 'lucide-react';
import { fmtDay, localDate } from '@/lib/format';
import type { AckStatus, LeaveStatus, LeaveType } from '@/lib/types';

/**
 * The routing slip: the journey a paper leave form used to make from desk to desk, drawn as stations.
 * Applied → Faculty told → (medical) Certificate checked → Dean decides, with the current one in gold.
 */
type SlipLeave = {
  type: LeaveType;
  status: LeaveStatus;
  submitted_at: string;
  filed_by: string | null;
  decided_at: string | null;
  closed_at?: string | null;
  doc_path: string | null;
  doc_checked_at: string | null;
  doc_return_note?: string | null;
  faculty_acks?: { status: AckStatus }[];
};

type State = 'done' | 'current' | 'attention' | 'upcoming' | 'declined' | 'stopped';
type Station = { label: string; sub?: string; state: State };

const day = (ts: string | null | undefined) => (ts ? fmtDay(localDate(ts)) : undefined);

export function stations(l: SlipLeave): Station[] {
  const open = l.status === 'submitted' || l.status === 'sanctioned' || l.status === 'documents_in';
  const acks = l.faculty_acks;
  const answered = acks?.filter((a) => a.status !== 'pending').length ?? 0;
  const out: Station[] = [
    { label: l.filed_by ? 'Filed by office' : 'Applied', sub: day(l.submitted_at), state: 'done' },
    {
      label: 'Faculty told',
      sub: acks === undefined ? undefined : acks.length === 0 ? 'No classes missed' : `${answered} of ${acks.length} replied`,
      state: 'done',
    },
  ];

  let checked = true;
  if (l.type === 'medical') {
    let cert: Station;
    if (l.doc_checked_at) cert = { label: 'Certificate checked', sub: l.doc_path ? day(l.doc_checked_at) : 'Not needed', state: 'done' };
    else if (l.status === 'approved') cert = { label: 'Certificate checked', state: 'done' };
    else if (!open) cert = { label: 'Certificate checked', state: 'upcoming' };
    else if (l.doc_path) cert = { label: 'Certificate check', sub: 'With the office', state: 'current' };
    else cert = { label: 'Certificate', sub: l.doc_return_note ? 'Returned: new one needed' : 'Needed', state: 'attention' };
    checked = cert.state === 'done';
    out.push(cert);
  }

  let dean: Station;
  switch (l.status) {
    case 'approved': dean = { label: 'Approved', sub: day(l.decided_at), state: 'done' }; break;
    case 'rejected': dean = { label: 'Not approved', sub: day(l.decided_at), state: 'declined' }; break;
    case 'withdrawn': dean = { label: 'Withdrawn', sub: day(l.closed_at), state: 'stopped' }; break;
    case 'cancelled': dean = { label: 'Cancelled', sub: day(l.closed_at), state: 'stopped' }; break;
    default: dean = checked ? { label: 'With the Dean', sub: 'Awaiting decision', state: 'current' } : { label: 'Dean decides', state: 'upcoming' };
  }
  out.push(dean);
  return out;
}

const SR: Record<State, string> = {
  done: 'done', current: 'current step', attention: 'needs action', upcoming: 'not yet', declined: 'not approved', stopped: 'stopped',
};

function Marker({ state }: { state: State }) {
  const base = 'relative z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full';
  switch (state) {
    case 'done':
      return <span className={clsx(base, 'bg-navy-700 text-white')}><Check className="h-3 w-3" strokeWidth={3} aria-hidden /></span>;
    case 'current':
      return <span className={clsx(base, 'bg-white ring-2 ring-gold-500')}><span className="h-2 w-2 rounded-full bg-gold-500" /></span>;
    case 'attention':
      return <span className={clsx(base, 'bg-warn-bg text-[0.7rem] font-bold text-bronze-600 ring-2 ring-bronze-600')}>!</span>;
    case 'declined':
      return <span className={clsx(base, 'bg-bad-fg text-white')}><X className="h-3 w-3" strokeWidth={3} aria-hidden /></span>;
    case 'stopped':
      return <span className={clsx(base, 'bg-quiet-bg text-ink-muted ring-1 ring-quiet-line')}><Minus className="h-3 w-3" strokeWidth={3} aria-hidden /></span>;
    default:
      return <span className={clsx(base, 'bg-white ring-1 ring-line-strong')} />;
  }
}

/** Full slip, for the top of a request. */
export function RoutingSlip({ leave, className }: { leave: SlipLeave; className?: string }) {
  const list = stations(leave);
  return (
    <ol aria-label="Where this request is" className={clsx('flex', className)}>
      {list.map((s, i) => {
        const next = list[i + 1];
        const reached = s.state === 'done' && next && next.state !== 'upcoming';
        return (
          <li key={s.label + i} className="relative min-w-0 flex-1 pr-2 last:flex-[0.9] last:pr-0">
            {next && (
              <span aria-hidden className={clsx('absolute left-[22px] right-0 top-[10px] h-0.5',
                reached ? 'bg-navy-700' : 'bg-[length:6px_2px] bg-repeat-x [background-image:linear-gradient(to_right,theme(colors.line-strong)_50%,transparent_0)]')} />
            )}
            <Marker state={s.state} />
            <div className="mt-2.5 pr-1">
              <p className={clsx('text-[0.8125rem] font-semibold leading-tight sm:text-sm',
                s.state === 'upcoming' ? 'text-ink-faint' : s.state === 'current' ? 'text-navy-900' : s.state === 'attention' ? 'text-bronze-600' : s.state === 'declined' ? 'text-bad-fg' : 'text-ink')}>
                {s.label}<span className="sr-only">: {SR[s.state]}</span>
              </p>
              {s.sub && <p className="mt-0.5 text-xs leading-snug text-ink-muted">{s.sub}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const BAR: Record<State, string> = {
  done: 'bg-navy-700', current: 'bg-gold-500', attention: 'bg-bronze-600', upcoming: 'bg-line-strong', declined: 'bg-bad-fg', stopped: 'bg-ink-faint/60',
};

/** A compact version for lists: one segment per station. */
export function RoutingBar({ leave, className }: { leave: SlipLeave; className?: string }) {
  const list = stations(leave);
  const here = list.find((s) => s.state !== 'done') ?? list[list.length - 1];
  return (
    <div className={clsx('flex items-center gap-1', className)} role="img" aria-label={`Progress: ${list.map((s) => `${s.label} ${SR[s.state]}`).join(', ')}. Now: ${here.label}`}>
      {list.map((s, i) => <span key={i} className={clsx('h-1 flex-1 rounded-full', BAR[s.state])} />)}
    </div>
  );
}
