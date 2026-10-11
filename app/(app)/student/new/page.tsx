import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/primitives';
import { getSettings, requireViewer } from '@/lib/session';
import { NewLeaveForm } from './new-leave-form';

export const metadata: Metadata = { title: 'Apply for leave' };

export default async function NewLeavePage() {
  const { person } = await requireViewer('student');
  const s = await getSettings();
  return (
    <>
      <PageHeader
        eyebrow="My leave"
        title="Apply for leave"
        description="Your faculty are emailed as soon as you submit. You do not need their signatures."
      />
      <NewLeaveForm
        batch={person.batch!}
        section={person.section!}
        rules={{
          noticeHours: s.notice_hours,
          medicalLateHours: s.medical_late_hours,
          medicalAheadDays: s.medical_ahead_days,
          docDays: s.doc_days,
          chairMaxDays: s.chair_max_days,
          maxLeaveDays: s.max_leave_days,
        }}
      />
    </>
  );
}
