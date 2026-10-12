import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LeaveDetail } from '@/components/leave/leave-detail';
import { Card, PageHeader } from '@/components/ui/primitives';
import { daysInclusive, plural, TYPE_LABEL } from '@/lib/format';
import { getConcerns, getEvents, getLeaveByRef } from '@/lib/leave';
import { getSettings, requireDecider } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { DecisionForm } from './decision-form';

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  return { title: (await params).ref };
}

export default async function ApproveDetail({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const { delegate } = await requireDecider();
  const supabase = await createClient();
  const leave = await getLeaveByRef(supabase, ref);
  if (!leave) notFound();
  const s = await getSettings();
  const [events, concerns, history] = await Promise.all([
    getEvents(supabase, leave.id),
    getConcerns(supabase, leave.id),
    supabase.from('leave_requests').select('id, from_date, to_date, status')
      .eq('student_id', leave.student_id).neq('id', leave.id)
      .in('status', ['approved', 'sanctioned', 'documents_in'])
      .gte('from_date', new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10)),
  ]);
  const past = (history.data ?? []) as { from_date: string; to_date: string }[];
  const pastDays = past.reduce((n, p) => n + daysInclusive(p.from_date, p.to_date), 0);
  const canDecide = leave.status === 'submitted';

  const aside = (
    <>
      {canDecide && <DecisionForm leaveId={leave.id} leaveRef={leave.ref} medical={leave.type === 'medical'} docDays={s.doc_days} delegate={delegate} />}
      <Card title="Leave in the last 6 months">
        <p className="px-5 py-4 text-sm text-ink-soft">
          {past.length === 0
            ? `${leave.student?.full_name} has no other sanctioned or approved leave in the last 6 months.`
            : `${plural(past.length, 'other request')}, ${plural(pastDays, 'day')} in total, sanctioned or approved.`}
        </p>
      </Card>
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/approve" className="hover:text-navy-700">Approval queue</Link>}
        title={`${leave.student?.full_name}: ${TYPE_LABEL[leave.type].toLowerCase()} leave`}
        description={leave.ref}
      />
      <LeaveDetail leave={leave} events={events} concerns={concerns} audience="staff" aside={aside} />
    </>
  );
}
