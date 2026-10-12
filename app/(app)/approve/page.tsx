import type { Metadata } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { Alert, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { fmtDay, hoursBetween, relativeHours } from '@/lib/format';
import { getDelegation, getSettings, requireDecider } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { AckStatus, LeaveStatus, LeaveType } from '@/lib/types';
import { QueueList, type QueueRow } from './queue-list';

export const metadata: Metadata = { title: 'Approval queue' };

type Row = {
  id: string; ref: string; type: LeaveType; status: LeaveStatus; from_date: string; to_date: string;
  submitted_at: string; decided_at: string | null; filed_by: string | null; doc_checked_at: string | null;
  student: { full_name: string; student_no: string | null; batch: string | null; section: string | null } | null;
  faculty_acks: { status: AckStatus }[];
  ack_concerns: { id: number }[];
};

const SELECT = `id, ref, type, status, from_date, to_date, submitted_at, decided_at, filed_by, doc_checked_at,
  student:people!leave_requests_student_id_fkey(full_name, student_no, batch, section),
  faculty_acks(status), ack_concerns(id)`;

export default async function ApproveQueue({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { person, delegate } = await requireDecider();
  const { view } = await searchParams;
  const decided = view === 'decided';
  const [s, delegation] = await Promise.all([getSettings(), delegate ? getDelegation() : Promise.resolve(null)]);
  const supabase = await createClient();

  const query = decided
    ? supabase.from('leave_requests').select(SELECT).eq('decided_by', person.id).order('decided_at', { ascending: false }).limit(100)
    // Medical requests arrive once the Dean HRM Office has checked the certificate.
    : supabase.from('leave_requests').select(SELECT).eq('status', 'submitted').or('type.neq.medical,doc_checked_at.not.is.null')
      .order('submitted_at', { ascending: true }).limit(300);
  const { data } = await query;
  const now = new Date();
  const rows: QueueRow[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id, ref: r.ref, type: r.type, status: r.status, from_date: r.from_date, to_date: r.to_date,
    student_name: r.student?.full_name ?? 'Student',
    student_meta: `${r.student?.student_no ?? ''} · ${r.student?.batch ?? ''} ${r.student?.section ?? ''} · ${r.ref}`,
    answered: r.faculty_acks.filter((a) => a.status !== 'pending').length,
    acks: r.faculty_acks.length,
    concerns: r.ack_concerns.length,
    // A medical request has been with the Dean only since the office checked it.
    waiting: relativeHours(r.doc_checked_at ?? r.submitted_at, now),
    overdue: !decided && hoursBetween(r.doc_checked_at ?? r.submitted_at, now) >= s.escalate_hours,
    certificate_checked: r.type === 'medical' && !r.filed_by,
    decided_at: r.decided_at,
    filed_by_office: Boolean(r.filed_by),
  }));

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
        description="Every leave request waiting for the Dean, oldest first. Medical requests appear once the Dean HRM Office has checked the certificate. Faculty acknowledgment runs in parallel, so you can decide at any time. Tick several to approve them together."
      />
      {delegate && (
        <Alert tone="info" className="mb-4" title="You are deciding on behalf of the Dean">
          {delegation ? `Until ${fmtDay(delegation.ends_on)}. ` : ''}Each decision is recorded as made on the Dean’s behalf. Medical details are confidential.
        </Alert>
      )}
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
          <QueueList rows={rows} selectable={!decided} />
        )}
      </Card>
    </>
  );
}
