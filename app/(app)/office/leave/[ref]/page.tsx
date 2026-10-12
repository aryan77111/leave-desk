import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { LeaveDetail } from '@/components/leave/leave-detail';
import { Alert, Card, LinkButton, PageHeader } from '@/components/ui/primitives';
import { fmtStamp, medicalStep, TYPE_LABEL } from '@/lib/format';
import { getConcerns, getEvents, getLeaveByRef } from '@/lib/leave';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { CancelForm } from './cancel-form';
import { ReviewForm } from './review-form';

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  return { title: (await params).ref };
}

export default async function OfficeLeaveDetail({ params, searchParams }: {
  params: Promise<{ ref: string }>; searchParams: Promise<{ filed?: string; corrected?: string }>;
}) {
  const { ref } = await params;
  const { filed, corrected } = await searchParams;
  await requireViewer('office');
  const supabase = await createClient();
  const leave = await getLeaveByRef(supabase, ref);
  if (!leave) notFound();
  const [events, concerns] = await Promise.all([getEvents(supabase, leave.id), getConcerns(supabase, leave.id)]);

  let signedUrl: string | null = null;
  if (leave.doc_path) {
    const { data } = await supabase.storage.from('certificates').createSignedUrl(leave.doc_path, 600);
    signedUrl = data?.signedUrl ?? null;
  }

  const step = medicalStep(leave);
  const aside = (
    <>
      {leave.type === 'medical' && (leave.doc_path || step === 'certificate') && (
        <Card
          title={step === 'office' ? 'Check the medical certificate' : 'Medical certificate'}
          description={leave.doc_path
            ? `Uploaded ${leave.doc_uploaded_at ? fmtStamp(leave.doc_uploaded_at) : ''}${leave.doc_checked_at ? ` · checked ${fmtStamp(leave.doc_checked_at)}${leave.checker ? ` by ${leave.checker.full_name}` : ''}` : ''}`
            : undefined}
        >
          <div className="flex flex-col gap-4 px-5 py-4">
            {leave.doc_path ? (
              <>
                {signedUrl ? (
                  <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-navy-700 hover:underline">
                    Open certificate <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <p className="text-sm text-bad-fg">The file could not be opened. Refresh the page to try again.</p>
                )}
                <p className="text-xs text-ink-muted">The link works for 10 minutes. Do not forward it.</p>
              </>
            ) : (
              <p className="text-sm text-ink-soft">
                {leave.doc_return_note ? <>Returned to the student: <span className="text-ink">{leave.doc_return_note}</span> </> : 'No certificate yet. '}
                {leave.doc_deadline && <>A new one is due by {fmtStamp(leave.doc_deadline)}, or the request is cancelled automatically.</>}
              </p>
            )}
            {step === 'office' && (
              <>
                <p className="text-sm text-ink-soft">Check that it covers {leave.from_date === leave.to_date ? 'the day' : 'the dates'} of leave and is signed by a doctor. Accepting sends the request to the Dean.</p>
                <ReviewForm leaveId={leave.id} leaveRef={leave.ref} />
              </>
            )}
          </div>
        </Card>
      )}
      {['submitted', 'sanctioned', 'documents_in', 'approved'].includes(leave.status) && (
        <Card title="Correct or cancel" description="For mistakes. Every change is on the history with your reason.">
          <div className="flex flex-col gap-3 px-5 py-4">
            <LinkButton href={`/office/leave/${leave.ref}/correct`} variant="secondary" className="self-start">Correct dates and sessions</LinkButton>
            <CancelForm leaveId={leave.id} leaveRef={leave.ref} />
          </div>
        </Card>
      )}
      {leave.student && (
        <Card title="Student">
          <div className="px-5 py-4 text-sm">
            <p className="font-semibold text-ink">{leave.student.full_name}</p>
            <p className="text-ink-muted">{leave.student.student_no} · {leave.student.programme} {leave.student.batch} {leave.student.section}</p>
            <p className="mt-2 select-all break-all text-ink-soft">{leave.student.email}</p>
            <Link href={`/office/leave?q=${encodeURIComponent(leave.student.student_no ?? '')}`} className="mt-3 inline-block text-sm font-semibold text-navy-700 hover:underline">All leave for this student</Link>
          </div>
        </Card>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/office/leave" className="hover:text-navy-700">All leave</Link>}
        title={`${leave.student?.full_name}: ${TYPE_LABEL[leave.type].toLowerCase()} leave`}
        description={leave.ref}
      />
      {filed && <Alert tone="ok" className="mb-6" title="Request filed">The Dean has the request{leave.type === 'medical' ? ' (no certificate check needed when the office files it)' : ''}, faculty have been emailed and the student has been told.</Alert>}
      {corrected && <Alert tone="ok" className="mb-6" title="Correction saved">The student has been emailed, and faculty whose sessions changed have been told.</Alert>}
      <LeaveDetail leave={leave} events={events} concerns={concerns} audience="staff" aside={aside} />
    </>
  );
}
