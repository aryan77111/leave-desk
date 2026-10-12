import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LeaveForm } from '@/components/leave/leave-form';
import { PageHeader } from '@/components/ui/primitives';
import { getLeaveByRef } from '@/lib/leave';
import { getSettings, requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { editLeave } from '../../../actions';

export const metadata: Metadata = { title: 'Change request' };

export default async function EditLeavePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const { person } = await requireViewer('student');
  const supabase = await createClient();
  const leave = await getLeaveByRef(supabase, ref);
  if (!leave || leave.student_id !== person.id) notFound();
  if (leave.status !== 'submitted') redirect(`/student/leave/${ref}`);
  const s = await getSettings();

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/student/leave/${ref}`} className="hover:text-navy-700">{ref}</Link>}
        title="Change your request"
        description="You can change the dates, sessions, reason and travel details until the Dean decides. Faculty whose sessions change are told automatically."
      />
      <LeaveForm
        mode="edit"
        action={editLeave}
        hidden={{ leave_id: leave.id, ref: leave.ref }}
        batch={person.batch!}
        section={person.section!}
        rules={{
          noticeHours: s.notice_hours,
          medicalLateHours: s.medical_late_hours,
          medicalAheadDays: s.medical_ahead_days,
          docDays: s.doc_days,
          maxLeaveDays: s.max_leave_days,
        }}
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
