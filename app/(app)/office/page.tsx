import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, Circle } from 'lucide-react';
import { Card, EmptyState, LinkButton, PageHeader, Stat, TableWrap } from '@/components/ui/primitives';
import { fmtRange, fmtStamp, relativeHours, TYPE_LABEL } from '@/lib/format';
import { getSettings, requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { LeaveType } from '@/lib/types';

export const metadata: Metadata = { title: 'Overview' };

type Row = { id: string; ref: string; type: LeaveType; from_date: string; to_date: string; submitted_at: string; doc_uploaded_at: string | null; doc_deadline: string | null; student: { full_name: string; student_no: string | null } | null };
const SELECT = 'id, ref, type, from_date, to_date, submitted_at, doc_uploaded_at, doc_deadline, student:people!leave_requests_student_id_fkey(full_name, student_no)';

export default async function OfficeHome() {
  await requireViewer('office');
  const s = await getSettings();
  const supabase = await createClient();
  const overdueBefore = new Date(Date.now() - s.escalate_hours * 36e5).toISOString();
  const count = { count: 'exact' as const, head: true };

  const [waiting, overdue, toCheck, certDue, failed, queued, students, faculty, approvers, sessions, checkList, overdueList] = await Promise.all([
    supabase.from('leave_requests').select('id', count).eq('status', 'submitted'),
    supabase.from('leave_requests').select('id', count).eq('status', 'submitted').lt('submitted_at', overdueBefore),
    supabase.from('leave_requests').select('id', count).eq('status', 'documents_in'),
    supabase.from('leave_requests').select('id', count).eq('status', 'sanctioned'),
    supabase.from('email_outbox').select('id', count).eq('status', 'failed'),
    supabase.from('email_outbox').select('id', count).in('status', ['queued', 'sending']),
    supabase.from('people').select('id', count).contains('roles', ['student']).eq('active', true),
    supabase.from('people').select('id', count).contains('roles', ['faculty']).eq('active', true),
    supabase.from('people').select('id', count).contains('roles', ['approver']).eq('active', true),
    supabase.from('class_sessions').select('id', count).gte('starts_at', new Date().toISOString()),
    supabase.from('leave_requests').select(SELECT).eq('status', 'documents_in').order('doc_uploaded_at').limit(10),
    supabase.from('leave_requests').select(SELECT).eq('status', 'submitted').lt('submitted_at', overdueBefore).order('submitted_at').limit(10),
  ]);

  const n = (r: { count: number | null }) => r.count ?? 0;
  const setup = [
    { done: Boolean(s.app_url && s.email_from), label: 'Set the app address and email sender', href: '/office/settings' },
    { done: n(students) > 0 && n(faculty) > 0, label: 'Import students and faculty', href: '/office/people' },
    { done: n(approvers) > 0, label: 'Add the Dean (role: dean)', href: '/office/people' },
    { done: n(sessions) > 0, label: 'Import the timetable', href: '/office/timetable' },
  ];
  const setupDone = setup.every((x) => x.done);
  const checks = (checkList.data ?? []) as unknown as Row[];
  const late = (overdueList.data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader title="Overview" description={`${s.programme_name} leave at a glance. Rules: ${s.notice_hours} h notice, ${s.ack_hours} h faculty window, certificates within ${s.doc_days} days.`} />

      {!setupDone && (
        <Card className="mb-6" title="Finish setting up Leave Desk" description="Students can apply once the roster and timetable are in.">
          <ol className="divide-y divide-line">
            {setup.map((x) => (
              <li key={x.label} className="flex items-center gap-3 px-5 py-3 text-sm">
                {x.done ? <CheckCircle2 className="h-4 w-4 text-ok-fg" /> : <Circle className="h-4 w-4 text-ink-faint" />}
                <span className={x.done ? 'text-ink-muted line-through' : 'text-ink'}>{x.label}</span>
                {!x.done && <Link href={x.href} className="ml-auto text-sm font-semibold text-navy-700 hover:underline">Open</Link>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Awaiting decision" value={n(waiting)} href="/office/leave?status=submitted" />
        <Stat label="Overdue decisions" value={n(overdue)} tone="bad" href="/office/leave?status=submitted" />
        <Stat label="Certificates to check" value={n(toCheck)} tone="warn" href="/office/leave?status=documents_in" />
        <Stat label="Certificates due" value={n(certDue)} href="/office/leave?status=sanctioned" />
        <Stat label="Emails waiting" value={n(queued)} href="/office/emails" />
        <Stat label="Emails failed" value={n(failed)} tone="bad" href="/office/emails?status=failed" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Certificates to check" action={<LinkButton href="/office/leave?status=documents_in" variant="ghost">View all</LinkButton>}>
          {checks.length === 0 ? <EmptyState title="Nothing to check" /> : (
            <TableWrap>
              <table className="data-table">
                <thead><tr><th>Student</th><th>Leave</th><th>Uploaded</th></tr></thead>
                <tbody>
                  {checks.map((r) => (
                    <tr key={r.id} className="row-link">
                      <td><Link href={`/office/leave/${r.ref}`} className="font-semibold text-navy-700 hover:underline">{r.student?.full_name}</Link><div className="text-xs text-ink-muted">{r.ref}</div></td>
                      <td className="whitespace-nowrap">{fmtRange(r.from_date, r.to_date)}</td>
                      <td className="whitespace-nowrap text-ink-soft">{r.doc_uploaded_at ? fmtStamp(r.doc_uploaded_at) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        <Card title="Overdue decisions" description={`No decision after ${s.escalate_hours} hours`}>
          {late.length === 0 ? <EmptyState title="No overdue requests" /> : (
            <TableWrap>
              <table className="data-table">
                <thead><tr><th>Student</th><th>Leave</th><th>Waiting</th></tr></thead>
                <tbody>
                  {late.map((r) => (
                    <tr key={r.id} className="row-link">
                      <td><Link href={`/office/leave/${r.ref}`} className="font-semibold text-navy-700 hover:underline">{r.student?.full_name}</Link><div className="text-xs text-ink-muted">{r.ref}</div></td>
                      <td className="whitespace-nowrap">{fmtRange(r.from_date, r.to_date)}<div className="text-xs text-ink-muted">{TYPE_LABEL[r.type]}</div></td>
                      <td className="whitespace-nowrap text-bad-fg">{relativeHours(r.submitted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      <p className="mt-6 text-xs text-ink-muted">
        Roster: {n(students)} students, {n(faculty)} faculty, {n(approvers)} with Dean access. {n(sessions)} upcoming timetable sessions.
      </p>
    </>
  );
}
