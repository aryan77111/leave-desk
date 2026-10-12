import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LeaveForm } from '@/components/leave/leave-form';
import { PageHeader } from '@/components/ui/primitives';
import { getLeaveByRef } from '@/lib/leave';
import { getSettings, requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { amendLeave } from '../../../actions';

export const metadata: Metadata = { title: 'Correct a request' };

export default async function CorrectLeavePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  await requireViewer('office');
  const supabase = await createClient();
  const leave = await getLeaveByRef(supabase, ref);
  if (!leave || !leave.student) notFound();
  if (!['submitted', 'sanctioned', 'documents_in', 'approved'].includes(leave.status)) redirect(`/office/leave/${ref}`);
  const s = await getSettings();

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/office/leave/${ref}`} className="hover:text-navy-700">{ref}</Link>}
        title={`Correct ${leave.student.full_name}'s leave`}
        description="Change the dates and the sessions covered. The status and the decision stay as they are. The student is emailed, and faculty whose sessions change are told."
      />
      <LeaveForm
        mode="amend"
        action={amendLeave}
        hidden={{ leave_id: leave.id, ref: leave.ref }}
        studentName={`${leave.student.full_name} · ${leave.student.student_no}`}
        batch={leave.student.batch!}
        section={leave.student.section!}
        rules={{ noticeHours: s.notice_hours, medicalLateHours: s.medical_late_hours, medicalAheadDays: s.medical_ahead_days, docDays: s.doc_days, maxLeaveDays: 120 }}
        initial={{
          type: leave.type,
          reason: leave.reason,
          from: leave.from_date,
          to: leave.to_date,
          sessionIds: leave.leave_sessions.map((x) => x.session?.id).filter((x): x is string => Boolean(x)),
          away: leave.away_from_campus,
          returnDate: leave.return_date,
          contactName: leave.contact_name,
          contactPhone: leave.contact_phone,
        }}
      />
    </>
  );
}
