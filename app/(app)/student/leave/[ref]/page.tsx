import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LeaveDetail } from '@/components/leave/leave-detail';
import { Alert, Card, LinkButton, PageHeader } from '@/components/ui/primitives';
import { medicalStep, TYPE_LABEL } from '@/lib/format';
import { getEvents, getLeaveByRef } from '@/lib/leave';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { CertificateUpload } from './certificate-upload';
import { WithdrawButton } from './withdraw-button';

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  return { title: (await params).ref };
}

export default async function StudentLeavePage({ params, searchParams }: {
  params: Promise<{ ref: string }>; searchParams: Promise<{ submitted?: string; changed?: string; cert?: string }>;
}) {
  const { ref } = await params;
  const { submitted, changed, cert } = await searchParams;
  const { person, userId } = await requireViewer('student');
  const supabase = await createClient();
  const leave = await getLeaveByRef(supabase, ref);
  if (!leave) notFound();
  if (leave.student_id !== person.id) redirect(person.roles.includes('office') ? `/office/leave/${ref}` : '/student');
  const events = await getEvents(supabase, leave.id);

  const step = medicalStep(leave);
  let viewUrl: string | null = null;
  if (step === 'office' && leave.doc_path) {
    const { data } = await supabase.storage.from('certificates').createSignedUrl(leave.doc_path, 600);
    viewUrl = data?.signedUrl ?? null;
  }

  let aside: React.ReactNode = null;
  if (leave.status === 'submitted') {
    aside = (
      <>
        {step === 'certificate' && (
          <CertificateUpload leaveId={leave.id} leaveRef={leave.ref} userId={userId} deadline={leave.doc_deadline}
            variant={leave.doc_return_note ? 'returned' : 'needed'} returnNote={leave.doc_return_note} />
        )}
        {step === 'office' && (
          <CertificateUpload leaveId={leave.id} leaveRef={leave.ref} userId={userId} deadline={leave.doc_deadline}
            variant="replace" uploadedAt={leave.doc_uploaded_at} viewUrl={viewUrl} />
        )}
        <Card title="Changed your plans?">
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="text-sm text-ink-soft">Until the Dean decides, you can change the dates, sessions or reason, or withdraw the request. Your faculty are told.</p>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/student/leave/${leave.ref}/edit`} variant="secondary">Change request</LinkButton>
              <WithdrawButton leaveId={leave.id} leaveRef={leave.ref} />
            </div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/student" className="hover:text-navy-700">My leave</Link>}
        title={`${TYPE_LABEL[leave.type]} leave`}
        description={leave.ref}
      />
      {submitted && leave.status === 'submitted' && cert === 'failed' && step === 'certificate' && (
        <Alert tone="warn" className="mb-6" title="Request submitted, but the certificate did not upload">
          Your faculty have been emailed. Upload the certificate below so the Dean HRM Office can check it.
        </Alert>
      )}
      {submitted && leave.status === 'submitted' && cert !== 'failed' && (
        <Alert tone="ok" className="mb-6" title="Request submitted">
          {leave.type === 'medical'
            ? 'Your faculty have been emailed. The Dean HRM Office will check your certificate, then the request goes to the Dean. You will get an email when it is decided.'
            : 'Your faculty have been emailed and the request is with the Dean. You will get an email when it is decided.'}
        </Alert>
      )}
      {changed && leave.status === 'submitted' && (
        <Alert tone="ok" className="mb-6" title="Changes saved">
          {step === 'office' && leave.doc_uploaded_at && leave.edited_at && leave.doc_uploaded_at < leave.edited_at
            ? 'Faculty whose sessions changed have been emailed again. The Dean HRM Office will check your certificate against the new dates.'
            : 'Faculty whose sessions changed have been emailed again. Anyone already looking at the request has been told.'}
        </Alert>
      )}
      <LeaveDetail leave={leave} events={events} audience="student" aside={aside} />
    </>
  );
}
