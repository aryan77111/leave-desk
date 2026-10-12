import type { Metadata } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { addDays, fmtDay, todayLocal, TYPE_LABEL } from '@/lib/format';
import { requireStaff } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { LeaveStatus, LeaveType } from '@/lib/types';

export const metadata: Metadata = { title: 'Leave calendar' };

type Row = {
  id: string; ref: string; type: LeaveType; status: LeaveStatus; from_date: string; to_date: string;
  student: { full_name: string; student_no: string | null; batch: string | null; section: string | null } | null;
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function monthBounds(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)), next = new Date(Date.UTC(y, m, 1));
  return { first: iso(first), last: iso(last), label: monthName.format(first), prev: iso(prev).slice(0, 7), next: iso(next).slice(0, 7), lead: (first.getUTCDay() + 6) % 7 };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; batch?: string; pending?: string }> }) {
  const { person, delegate } = await requireStaff();
  const sp = await searchParams;
  const today = todayLocal();
  const ym = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const { first, last, label, prev, next, lead } = monthBounds(ym);
  const showPending = sp.pending !== '0';
  const batch = sp.batch && sp.batch.length < 30 ? sp.batch : '';

  const supabase = await createClient();
  const statuses: LeaveStatus[] = showPending ? ['submitted', 'sanctioned', 'documents_in', 'approved'] : ['sanctioned', 'documents_in', 'approved'];
  let q = supabase.from('leave_requests')
    .select(`id, ref, type, status, from_date, to_date, student:people!leave_requests_student_id_fkey${batch ? '!inner' : ''}(full_name, student_no, batch, section)`)
    .in('status', statuses).lte('from_date', last).gte('to_date', first).order('from_date').limit(1000);
  if (batch) q = q.eq('student.batch', batch);
  const [{ data }, { data: batchRows }] = await Promise.all([
    q,
    supabase.from('people').select('batch').contains('roles', ['student']).eq('active', true).not('batch', 'is', null).limit(5000),
  ]);
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) => (a.student?.student_no ?? '').localeCompare(b.student?.student_no ?? ''));
  const batches = [...new Set(((batchRows ?? []) as { batch: string }[]).map((b) => b.batch))].sort().reverse();

  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  const onDay = (d: string) => rows.filter((r) => r.from_date <= d && r.to_date >= d);
  const href = (r: Row) => (person.roles.includes('office') ? `/office/leave/${r.ref}` : `/approve/${r.ref}`);
  const link = (o: Record<string, string>) => {
    const u = new URLSearchParams({ month: ym, ...(batch ? { batch } : {}), ...(showPending ? {} : { pending: '0' }), ...o });
    for (const [k, v] of [...u.entries()]) if (!v) u.delete(k);
    return `/calendar?${u.toString()}`;
  };
  const chip = (r: Row) => (
    <Link key={r.id} href={href(r)} title={`${r.student?.full_name} · ${TYPE_LABEL[r.type]} · ${r.ref}`}
      className={clsx('block truncate rounded px-1.5 py-0.5 text-[11px] font-semibold leading-4',
        r.status === 'submitted' ? 'bg-white text-info-fg ring-1 ring-inset ring-info-line' : r.type === 'medical' ? 'bg-warn-bg text-warn-fg' : 'bg-ok-bg text-ok-fg')}>
      {r.student?.full_name}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Leave calendar"
        description={`Who is on leave each day.${delegate ? ' You see this while deciding for the Dean.' : ''}`}
        action={
          <div className="flex items-center gap-1">
            <Link href={link({ month: prev })} className="rounded p-2 text-navy-700 hover:bg-navy-50" aria-label="Previous month"><ChevronLeft className="h-5 w-5" /></Link>
            <span className="min-w-[9rem] text-center text-sm font-semibold text-ink">{label}</span>
            <Link href={link({ month: next })} className="rounded p-2 text-navy-700 hover:bg-navy-50" aria-label="Next month"><ChevronRight className="h-5 w-5" /></Link>
          </div>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="month" value={ym} />
        <label className="flex flex-col gap-1"><span className="label-caps">Batch</span>
          <select name="batch" defaultValue={batch} className="field-input w-40">
            <option value="">All batches</option>
            {batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select></label>
        <label className="flex h-9 items-center gap-2 text-ink-soft">
          <input type="checkbox" name="pending" value="0" defaultChecked={!showPending} className="h-4 w-4 accent-navy-700" /> Hide requests not yet decided
        </label>
        <button className="h-9 rounded bg-navy-700 px-3.5 font-semibold text-white hover:bg-navy-800">Show</button>
        {ym !== today.slice(0, 7) && <Link href={link({ month: today.slice(0, 7) })} className="h-9 px-1 font-semibold leading-9 text-navy-700 hover:underline">This month</Link>}
      </form>

      <div className="mb-3 flex flex-wrap gap-3 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-ok-bg ring-1 ring-ok-line" /> Approved</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-warn-bg ring-1 ring-warn-line" /> Medical, certificate pending or approved</span>
        {showPending && <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-white ring-1 ring-info-line" /> Waiting for a decision</span>}
      </div>

      {/* Wider screens: month grid */}
      <Card className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-line bg-canvas">
          {WEEKDAYS.map((w) => <div key={w} className="px-2 py-2 text-xs font-semibold text-ink-muted">{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: lead }).map((_, i) => <div key={`lead${i}`} className="min-h-[110px] border-b border-r border-line bg-canvas/50" />)}
          {days.map((d) => {
            const list = onDay(d);
            const isToday = d === today;
            return (
              <div key={d} className={clsx('min-h-[110px] border-b border-r border-line p-1.5', isToday && 'bg-gold-100/50')}>
                <div className={clsx('mb-1 flex items-center justify-between text-xs', isToday ? 'font-bold text-ink' : 'text-ink-muted')}>
                  <span>{Number(d.slice(8))}</span>
                  {list.length > 0 && <span className="rounded bg-navy-50 px-1 text-[10px] font-semibold text-navy-700">{list.length}</span>}
                </div>
                <div className="flex flex-col gap-0.5">
                  {list.slice(0, 4).map(chip)}
                  {list.length > 4 && <span className="px-1 text-[11px] font-semibold text-ink-muted">+{list.length - 4} more</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Phones: days that have someone on leave */}
      <Card className="md:hidden">
        {days.every((d) => onDay(d).length === 0) ? <EmptyState title={`No leave in ${label}`} /> : (
          <ul className="divide-y divide-line">
            {days.filter((d) => onDay(d).length > 0).map((d) => (
              <li key={d} className={clsx('px-4 py-3', d === today && 'bg-gold-100/50')}>
                <div className="label-caps mb-1.5">{fmtDay(d)}{d === today ? ' · today' : ''}</div>
                <div className="flex flex-wrap gap-1.5">
                  {onDay(d).map((r) => (
                    <Link key={r.id} href={href(r)} className={clsx('rounded px-2 py-1 text-xs font-semibold',
                      r.status === 'submitted' ? 'bg-white text-info-fg ring-1 ring-inset ring-info-line' : r.type === 'medical' ? 'bg-warn-bg text-warn-fg' : 'bg-ok-bg text-ok-fg')}>
                      {r.student?.full_name}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-ink-muted">{rows.length} request{rows.length === 1 ? '' : 's'} this month. Medical reasons are never shown here.</p>
    </>
  );
}
