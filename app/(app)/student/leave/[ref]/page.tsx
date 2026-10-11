import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LeaveDetail } from '@/components/leave/leave-detail';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { fmtStamp, TYPE_LABEL } from '@/lib/format';
import { getEvents, getLeaveByRef } from '@/lib/leave';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { CertificateUpload } from './certificate-upload';
import { WithdrawButton } from './withdraw-button';

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  return { title: (await params).ref };
}

export default async function StudentLeavePage({ params, searchParams }: {
  params: Promise<{ ref: string }>; searchParams: Promise<{ submitted?: string }>;
}) {
  const { ref } = await params;
  const { submitted } = await searchParams;
  const { person, userId } = await requireViewer('student');
  const supabase = await createClient();
  const leave = await getLeaveByRef(supabase, ref);
  if (!leave) notFound();
  if (leave.student_id !== person.id) redirect(person.roles.includes('office') ? `/office/leave/${ref}` : '/student');
  const events = await getEvents(supabase, leave.id);

  let aside: React.ReactNode = null;
  if (leave.status === 'sanctioned') {
    aside = <CertificateUpload leaveId={leave.id} leaveRef={leave.ref} userId={userId} deadline={leave.doc_deadline!} />;
  } else if (leave.status === 'documents_in') {
    aside = (
      <Card title="Certificate received">
        <p className="px-5 py-4 text-sm text-ink-soft">
          Uploaded {leave.doc_uploaded_at ? fmtStamp(leave.doc_uploaded_at) : ''}. The Dean HRM Office will check it and you will get an email.
        </p>
      </Card>
    );
  } else if (leave.status === 'submitted') {
    aside = (
      <Card title="Changed your plans?">
        <div className="px-5 py-4">
          <p className="mb-4 text-sm text-ink-soft">You can withdraw this request until it is decided. Your faculty and the Dean will be told.</p>
          <WithdrawButton leaveId={leave.id} leaveRef={leave.ref} />
        </div>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/student" className="hover:text-navy-700">My leave</Link>}
        title={`${TYPE_LABEL[leave.type]} leave`}
        description={leave.ref}
      />
      {submitted && leave.status === 'submitted' && (
        <Alert tone="ok" className="mb-6" title="Request submitted">
          Your faculty have been emailed and the request is with the Dean. You will get an email when it is decided.
        </Alert>
      )}
      <LeaveDetail leave={leave} events={events} audience="student" aside={aside} />
    </>
  );
}
