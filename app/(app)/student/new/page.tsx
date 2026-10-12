import type { Metadata } from 'next';
import { LeaveForm } from '@/components/leave/leave-form';
import { PageHeader } from '@/components/ui/primitives';
import { getSettings, requireViewer } from '@/lib/session';
import { submitLeave } from '../actions';

export const metadata: Metadata = { title: 'Apply for leave' };

export default async function NewLeavePage() {
  const { person, userId } = await requireViewer('student');
  const s = await getSettings();
  return (
    <>
      <PageHeader
        eyebrow="My leave"
        title="Apply for leave"
        description="Your faculty are emailed as soon as you submit. You do not need their signatures. For medical leave, attach the certificate here."
      />
      <LeaveForm
        mode="apply"
        action={submitLeave}
        userId={userId}
        batch={person.batch!}
        section={person.section!}
        rules={{
          noticeHours: s.notice_hours,
          medicalLateHours: s.medical_late_hours,
          medicalAheadDays: s.medical_ahead_days,
          docDays: s.doc_days,
          maxLeaveDays: s.max_leave_days,
        }}
      />
    </>
  );
}
