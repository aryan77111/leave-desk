import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LeaveDetail } from '@/components/leave/leave-detail';
import { ExternalLink } from 'lucide-react';
import { Card, PageHeader } from '@/components/ui/primitives';
import { daysInclusive, fmtStamp, medicalStep, plural, TYPE_LABEL } from '@/lib/format';
import { getConcerns, getEvents, getLeaveByRef } from '@/lib/leave';
import { requireDecider } from '@/lib/session';
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
  const step = medicalStep(leave);
  const canDecide = leave.status === 'submitted' && !step;

  let certUrl: string | null = null;
  if (leave.doc_path) {
    const { data } = await supabase.storage.from('certificates').createSignedUrl(leave.doc_path, 600);
    certUrl = data?.signedUrl ?? null;
  }

  const aside = (
    <>
      {step && (
        <Card title="Not ready for a decision yet">
          <p className="px-5 py-4 text-sm text-ink-soft">
            {step === 'office'
              ? 'The Dean HRM Office is checking the medical certificate. The request comes to your queue, with an email, once it is checked.'
              : 'The student has not attached a medical certificate yet. It comes to you after the Dean HRM Office checks one.'}
          </p>
        </Card>
      )}
      {canDecide && <DecisionForm leaveId={leave.id} leaveRef={leave.ref} delegate={delegate} />}
      {leave.type === 'medical' && leave.doc_path && (
        <Card title="Medical certificate" description={leave.doc_checked_at ? `Checked by the Dean HRM Office ${fmtStamp(leave.doc_checked_at)}${leave.checker ? ` (${leave.checker.full_name})` : ''}` : 'Not checked yet'}>
          <div className="flex flex-col gap-2 px-5 py-4">
            {certUrl ? (
              <a href={certUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-navy-700 hover:underline">
                Open certificate <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <p className="text-sm text-bad-fg">The file could not be opened. Refresh the page to try again.</p>
            )}
            <p className="text-xs text-ink-muted">The link works for 10 minutes. Do not forward it.</p>
          </div>
        </Card>
      )}
      <Card title="Leave in the last 6 months">
        <p className="px-5 py-4 text-sm text-ink-soft">
          {past.length === 0
            ? `${leave.student?.full_name} has no other approved leave in the last 6 months.`
            : `${plural(past.length, 'other request')}, ${plural(pastDays, 'day')} in total, approved.`}
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
