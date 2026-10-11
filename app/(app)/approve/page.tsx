import type { Metadata } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { StatusBadge } from '@/components/leave/badges';
import { Badge, Card, EmptyState, PageHeader, TableWrap } from '@/components/ui/primitives';
import { fmtRange, fmtStamp, hoursBetween, LEVEL_LABEL, relativeHours, TYPE_LABEL } from '@/lib/format';
import { getSettings, requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { AckStatus, ApproverLevel, LeaveStatus, LeaveType } from '@/lib/types';

export const metadata: Metadata = { title: 'Approval queue' };

type Row = {
  id: string; ref: string; type: LeaveType; status: LeaveStatus; from_date: string; to_date: string;
  submitted_at: string; decided_at: string | null; approver_level: ApproverLevel;
  student: { full_name: string; student_no: string | null; batch: string | null; section: string | null } | null;
  faculty_acks: { status: AckStatus }[];
  ack_concerns: { id: number }[];
};

const SELECT = `id, ref, type, status, from_date, to_date, submitted_at, decided_at, approver_level,
  student:people!leave_requests_student_id_fkey(full_name, student_no, batch, section),
  faculty_acks(status), ack_concerns(id)`;

export default async function ApproveQueue({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { person } = await requireViewer('approver');
  const { view } = await searchParams;
  const decided = view === 'decided';
  const level = person.approver_level!;
  const s = await getSettings();
  const supabase = await createClient();

  let query = supabase.from('leave_requests').select(SELECT);
  if (decided) {
    query = query.eq('decided_by', person.id).order('decided_at', { ascending: false }).limit(100);
  } else {
    query = query.eq('status', 'submitted').order('submitted_at', { ascending: true }).limit(300);
    if (level === 'chair') query = query.eq('approver_level', 'chair');
  }
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];
  const now = new Date();

  const tab = (href: string, label: string, active: boolean) => (
    <Link href={href} aria-current={active ? 'page' : undefined}
      className={clsx('border-b-2 px-1 pb-2.5 text-sm font-semibold', active ? 'border-gold-500 text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Approval queue"
        description={level === 'dean'
          ? 'Requests routed to the Dean, plus anything still waiting with the Programme Chair. Oldest first.'
          : 'Requests routed to the Programme Chair. Oldest first. Faculty acknowledgment runs in parallel, so you can decide at any time.'}
      />
      <div className="mb-4 flex gap-6 border-b border-line">
        {tab('/approve', 'Waiting', !decided)}
        {tab('/approve?view=decided', 'Decided by me', decided)}
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={decided ? 'You have not decided any requests yet' : 'Nothing waiting'}>
            {decided ? undefined : 'New requests arrive here and by email.'}
          </EmptyState>
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th><th>Leave</th><th>Faculty</th>
                  {!decided && level === 'dean' && <th>Routed to</th>}
                  <th>{decided ? 'Decided' : 'Waiting'}</th>
                  {decided && <th>Status</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const answered = r.faculty_acks.filter((a) => a.status !== 'pending').length;
                  const overdue = !decided && hoursBetween(r.submitted_at, now) >= s.escalate_hours;
                  return (
                    <tr key={r.id} className="row-link">
                      <td>
                        <Link href={`/approve/${r.ref}`} className="font-semibold text-navy-700 hover:underline">{r.student?.full_name}</Link>
                        <div className="text-xs text-ink-muted">{r.student?.student_no} · {r.student?.batch} {r.student?.section} · {r.ref}</div>
                      </td>
                      <td className="whitespace-nowrap">{fmtRange(r.from_date, r.to_date)}<div className="text-xs text-ink-muted">{TYPE_LABEL[r.type]}</div></td>
                      <td className="whitespace-nowrap">
                        <span className="tabular-nums">{answered} of {r.faculty_acks.length}</span>
                        {r.ack_concerns.length > 0 && <div className="mt-1"><Badge tone="bad">{r.ack_concerns.length} concern{r.ack_concerns.length > 1 ? 's' : ''}</Badge></div>}
                      </td>
                      {!decided && level === 'dean' && <td className="whitespace-nowrap">{LEVEL_LABEL[r.approver_level]}</td>}
                      <td className="whitespace-nowrap">
                        {decided ? fmtStamp(r.decided_at!) : overdue ? <Badge tone="bad">Overdue · {relativeHours(r.submitted_at, now)}</Badge> : <span className="text-ink-soft">{relativeHours(r.submitted_at, now)}</span>}
                      </td>
                      {decided && <td><StatusBadge status={r.status} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
