import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, Circle, FilePlus2 } from 'lucide-react';
import { Alert, Card, EmptyState, LinkButton, PageHeader, Stat, TableWrap } from '@/components/ui/primitives';
import { fmtDay, fmtRange, relativeHours, todayLocal, TYPE_LABEL } from '@/lib/format';
import { getSettings, requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { LeaveType } from '@/lib/types';

export const metadata: Metadata = { title: 'Overview' };

type Row = { id: string; ref: string; type: LeaveType; from_date: string; to_date: string; submitted_at: string; doc_uploaded_at: string | null; doc_deadline: string | null; doc_checked_at: string | null; student: { full_name: string; student_no: string | null } | null };
const SELECT = 'id, ref, type, from_date, to_date, submitted_at, doc_uploaded_at, doc_deadline, doc_checked_at, student:people!leave_requests_student_id_fkey(full_name, student_no)';
// With the Dean: any request except a medical one whose certificate the office has not checked.
const WITH_DEAN = 'type.neq.medical,doc_checked_at.not.is.null';
// With the Dean for longer than the reminder time (a medical request from when it was checked).
const overdue_ = (before: string) => `and(type.neq.medical,submitted_at.lt."${before}"),and(type.eq.medical,doc_checked_at.lt."${before}")`;

export default async function OfficeHome() {
  await requireViewer('office');
  const s = await getSettings();
  const supabase = await createClient();
  const overdueBefore = new Date(Date.now() - s.escalate_hours * 36e5).toISOString();
  const count = { count: 'exact' as const, head: true };

  const [waiting, overdue, toCheck, certMissing, failed, queued, students, faculty, approvers, sessions, checkList, overdueList, newFeedback, errors, delegations] = await Promise.all([
    supabase.from('leave_requests').select('id', count).eq('status', 'submitted').or(WITH_DEAN),
    supabase.from('leave_requests').select('id', count).eq('status', 'submitted').or(overdue_(overdueBefore)),
    supabase.from('leave_requests').select('id', count).eq('status', 'submitted').eq('type', 'medical').not('doc_path', 'is', null).is('doc_checked_at', null),
    supabase.from('leave_requests').select('id', count).eq('status', 'submitted').eq('type', 'medical').is('doc_path', null).is('doc_checked_at', null),
    supabase.from('email_outbox').select('id', count).eq('status', 'failed'),
    supabase.from('email_outbox').select('id', count).in('status', ['queued', 'sending']),
    supabase.from('people').select('id', count).contains('roles', ['student']).eq('active', true),
    supabase.from('people').select('id', count).contains('roles', ['faculty']).eq('active', true),
    supabase.from('people').select('id', count).contains('roles', ['approver']).eq('active', true),
    supabase.from('class_sessions').select('id', count).gte('starts_at', new Date().toISOString()),
    supabase.from('leave_requests').select(SELECT).eq('status', 'submitted').eq('type', 'medical').not('doc_path', 'is', null).is('doc_checked_at', null).order('doc_uploaded_at').limit(10),
    supabase.from('leave_requests').select(SELECT).eq('status', 'submitted').or(overdue_(overdueBefore)).order('submitted_at').limit(10),
    supabase.from('feedback').select('id', count).eq('status', 'new'),
    supabase.from('app_errors').select('id', count).gte('created_at', new Date(Date.now() - 864e5).toISOString()),
    supabase.from('approval_delegations').select('starts_on, ends_on, delegate:people!approval_delegations_delegate_id_fkey(full_name)')
      .is('ended_at', null).lte('starts_on', todayLocal()).gte('ends_on', todayLocal()),
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
  const away = (delegations.data ?? []) as unknown as { starts_on: string; ends_on: string; delegate: { full_name: string } | null }[];

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${s.programme_name} leave at a glance. Rules: ${s.notice_hours} h notice, ${s.ack_hours} h faculty window. Medical certificates come with the request; you check them before the Dean decides.`}
        action={<LinkButton href="/office/leave/new" variant="secondary"><FilePlus2 className="h-4 w-4" />File leave for a student</LinkButton>}
      />

      {away.map((d) => (
        <Alert key={d.delegate?.full_name} tone="info" className="mb-4" title={`${d.delegate?.full_name} is deciding for the Dean until ${fmtDay(d.ends_on)}`}>
          The Dean’s emails and approval queue also go to them. <Link href="/away" className="font-semibold underline underline-offset-2">Manage</Link>
        </Alert>
      ))}
      {(errors.count ?? 0) > 0 && (
        <Alert tone="warn" className="mb-4" title={`${errors.count} error${errors.count === 1 ? '' : 's'} in the last 24 hours`}>
          <Link href="/office/health" className="font-semibold underline underline-offset-2">Open System health</Link> to see what happened.
        </Alert>
      )}

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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Certificates to check" value={n(toCheck)} tone="warn" href="/office/leave?status=check" />
        <Stat label="Certificates missing" value={n(certMissing)} href="/office/leave?status=needed" />
        <Stat label="With the Dean" value={n(waiting)} href="/office/leave?status=submitted" />
        <Stat label="Overdue decisions" value={n(overdue)} tone="bad" href="/office/leave?status=submitted" />
      </div>
      <nav aria-label="System" className="mt-3 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-line bg-white px-4 py-3 text-sm">
        {[
          { label: 'Emails waiting', value: n(queued), href: '/office/emails', bad: false },
          { label: 'Emails failed', value: n(failed), href: '/office/emails?status=failed', bad: n(failed) > 0 },
          { label: 'New feedback', value: n(newFeedback), href: '/office/feedback', bad: false },
        ].map((x) => (
          <Link key={x.label} href={x.href} className="group inline-flex items-baseline gap-2 rounded text-ink-muted hover:text-ink">
            <span className={x.bad ? 'figure text-base font-semibold text-bad-fg' : 'figure text-base font-semibold text-navy-900'}>{x.value}</span>
            <span className="underline-offset-4 group-hover:underline">{x.label}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <Card title="Certificates to check" action={<LinkButton href="/office/leave?status=check" variant="ghost">View all</LinkButton>}>
          {checks.length === 0 ? <EmptyState title="Nothing to check" /> : (
            <TableWrap>
              <table className="data-table">
                <thead><tr><th>Student</th><th>Leave</th><th>Waiting</th></tr></thead>
                <tbody>
                  {checks.map((r) => (
                    <tr key={r.id} className="row-link">
                      <td><Link href={`/office/leave/${r.ref}`} className="font-semibold text-navy-700 hover:underline">{r.student?.full_name}</Link><div className="text-xs text-ink-muted">{r.ref}</div></td>
                      <td className="whitespace-nowrap">{fmtRange(r.from_date, r.to_date)}</td>
                      <td className="whitespace-nowrap text-ink-soft">{r.doc_uploaded_at ? relativeHours(r.doc_uploaded_at) : ''}</td>
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
                      <td className="whitespace-nowrap text-bad-fg">{relativeHours(r.doc_checked_at ?? r.submitted_at)}</td>
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
