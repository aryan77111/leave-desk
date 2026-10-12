import type { Metadata } from 'next';
import { StatusBadge } from '@/components/leave/badges';
import { Card, EmptyState, PageHeader, TableWrap } from '@/components/ui/primitives';
import { addDays, fmtDay, fmtRange, fmtStamp, fmtTime, localDate, plural, todayLocal, TYPE_LABEL } from '@/lib/format';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { InboxItem, LeaveStatus } from '@/lib/types';
import { InboxResponse } from './inbox-response';

export const metadata: Metadata = { title: 'Leave notices' };

type Absence = { course_code: string; starts_at: string; batch: string; section: string; student_name: string; student_no: string; ref: string; status: LeaveStatus };

export default async function FacultyHome() {
  await requireViewer('faculty');
  const supabase = await createClient();
  const today = todayLocal();
  const [{ data: inbox }, { data: absences }] = await Promise.all([
    supabase.rpc('faculty_inbox', { p_include_answered: false }),
    supabase.rpc('faculty_absences', { p_from: today, p_to: addDays(today, 13) }),
  ]);
  const items = (inbox ?? []) as InboxItem[];
  const away = (absences ?? []) as Absence[];

  return (
    <>
      <PageHeader
        title="Leave notices"
        description="Students who will miss your sessions. Acknowledge, add a note for the student, or raise a concern with the Dean. Make-up of any evaluation stays at your discretion."
      />

      <div className="flex flex-col gap-4">
        <h2 className="label-caps">Waiting for your response ({items.length})</h2>
        {items.length === 0 && (
          <Card><EmptyState title="You are up to date">New notices arrive here and by email.</EmptyState></Card>
        )}
        {items.map((it) => (
          <Card key={it.leave_id}>
            <div className="grid grid-cols-1 gap-5 px-5 py-5 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-base font-semibold text-ink">{it.student_name}</span>
                  <span className="text-sm text-ink-muted">{it.student_no}</span>
                  <span className="text-xs text-ink-faint">{it.ref}</span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {TYPE_LABEL[it.type]} leave · {fmtRange(it.from_date, it.to_date)}
                  {it.type === 'medical' && <span className="text-ink-muted"> · for information</span>}
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {(it.sessions ?? []).map((s) => (
                    <li key={s.starts_at + s.course_code} className="rounded bg-canvas px-2.5 py-1 text-xs text-ink-soft ring-1 ring-inset ring-line">
                      <span className="font-semibold text-ink">{s.course_code}</span> · {fmtDay(localDate(s.starts_at))}, {fmtTime(s.starts_at)}
                    </li>
                  ))}
                </ul>
                {it.reason && <p className="mt-3 text-sm text-ink"><span className="text-ink-muted">Reason: </span>{it.reason}</p>}
                <p className="mt-3 text-xs text-ink-muted">No reply by {fmtStamp(it.respond_by)} is recorded as acknowledged.</p>
              </div>
              <div className="md:w-72">
                <InboxResponse leaveId={it.leave_id} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-8" title="Students away from your sessions" description={`Next 14 days, from ${fmtDay(today)}`}>
        {away.length === 0 ? (
          <EmptyState title="No students on leave in your sessions" />
        ) : (
          <>
          <ul className="divide-y divide-line md:hidden">
            {away.map((a) => (
              <li key={a.ref + a.starts_at} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{a.student_name}</span>
                  <StatusBadge status={a.status} />
                </div>
                <div className="mt-0.5 text-xs text-ink-muted">{a.student_no} · {a.batch} {a.section}</div>
                <div className="mt-1 text-sm text-ink-soft"><span className="font-semibold text-ink">{a.course_code}</span> · {fmtDay(localDate(a.starts_at))}, {fmtTime(a.starts_at)}</div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Session</th><th>Class</th><th>Student</th><th>Leave</th></tr></thead>
              <tbody>
                {away.map((a) => (
                  <tr key={a.ref + a.starts_at}>
                    <td className="whitespace-nowrap"><span className="font-semibold">{a.course_code}</span> · {fmtDay(localDate(a.starts_at))}, {fmtTime(a.starts_at)}</td>
                    <td className="whitespace-nowrap text-ink-muted">{a.batch} {a.section}</td>
                    <td>{a.student_name}<div className="text-xs text-ink-muted">{a.student_no}</div></td>
                    <td><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          </div>
          </>
        )}
        {away.length > 0 && <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">{plural(away.length, 'absence')} in your sessions.</p>}
      </Card>
    </>
  );
}
