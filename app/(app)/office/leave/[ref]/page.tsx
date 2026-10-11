import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { LeaveDetail } from '@/components/leave/leave-detail';
import { Card, PageHeader } from '@/components/ui/primitives';
import { fmtStamp, TYPE_LABEL } from '@/lib/format';
import { getConcerns, getEvents, getLeaveByRef } from '@/lib/leave';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { ReviewForm } from './review-form';

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  return { title: (await params).ref };
}

export default async function OfficeLeaveDetail({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
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

  const aside = (
    <>
      {leave.doc_path && (
        <Card title="Medical certificate" description={leave.doc_uploaded_at ? `Uploaded ${fmtStamp(leave.doc_uploaded_at)}` : undefined}>
          <div className="flex flex-col gap-4 px-5 py-4">
            {signedUrl ? (
              <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-navy-700 hover:underline">
                Open certificate <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <p className="text-sm text-bad-fg">The file could not be opened. Refresh the page to try again.</p>
            )}
            <p className="text-xs text-ink-muted">The link works for 10 minutes. Do not forward it.</p>
            {leave.status === 'documents_in' && <ReviewForm leaveId={leave.id} leaveRef={leave.ref} />}
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
      <LeaveDetail leave={leave} events={events} concerns={concerns} audience="staff" aside={aside} />
    </>
  );
}
