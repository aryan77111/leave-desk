import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Plus } from 'lucide-react';
import { StatusBadge } from '@/components/leave/badges';
import { RoutingBar } from '@/components/leave/routing-slip';
import { Alert, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui/primitives';
import { fmtRange, fmtStamp, medicalStep, TYPE_LABEL } from '@/lib/format';
import { nextStep } from '@/lib/leave';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { LeaveRequest } from '@/lib/types';

export const metadata: Metadata = { title: 'My leave' };

export default async function StudentHome() {
  const { person } = await requireViewer('student');
  const supabase = await createClient();
  const { data } = await supabase
    .from('leave_requests')
    .select('id, ref, type, status, from_date, to_date, submitted_at, approver_level, doc_deadline, decision_note, doc_path, doc_checked_at, doc_return_note, cancel_reason, filed_by, decided_at, closed_at')
    .eq('student_id', person.id)
    .order('from_date', { ascending: false })
    .limit(200);
  const leave = (data ?? []) as LeaveRequest[];
  const due = leave.filter((l) => medicalStep(l) === 'certificate');

  return (
    <>
      <PageHeader
        title="My leave"
        description={`${person.full_name} · ${person.student_no} · ${person.programme ?? ''} ${person.batch}, Section ${person.section}`}
        action={<LinkButton href="/student/new"><Plus className="h-4 w-4" />Apply for leave</LinkButton>}
      />

      {due.map((l) => (
        <Alert key={l.id} tone="warn" className="mb-4" title={l.doc_return_note ? `New certificate needed for ${l.ref}` : `Certificate needed for ${l.ref}`}>
          {l.doc_return_note ? 'The Dean HRM Office returned your certificate. Upload a new one' : 'Upload your medical certificate'} by {l.doc_deadline ? fmtStamp(l.doc_deadline) : 'the deadline'}.{' '}
          <Link href={`/student/leave/${l.ref}`} className="font-semibold underline underline-offset-2">Upload now</Link>
        </Alert>
      ))}

      <Card>
        {leave.length === 0 ? (
          <EmptyState title="No leave requests yet" action={<LinkButton href="/student/new" variant="secondary">Apply for leave</LinkButton>}>
            When you apply, your missed sessions are filled in from the timetable and your faculty are told by email.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {leave.map((l) => (
              <li key={l.id}>
                <Link href={`/student/leave/${l.ref}`} className="group flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-navy-50/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[0.9375rem] font-semibold text-ink">{fmtRange(l.from_date, l.to_date)}</p>
                        <p className="text-sm text-ink-muted">{TYPE_LABEL[l.type]} · {l.ref}</p>
                      </div>
                      <StatusBadge status={l.status} step={medicalStep(l)} />
                    </div>
                    <RoutingBar leave={l} className="mt-3 max-w-xs" />
                    <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{nextStep(l, 'student')}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-navy-700" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
