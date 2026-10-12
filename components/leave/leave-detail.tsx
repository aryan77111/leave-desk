import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AckBadge, StatusBadge } from '@/components/leave/badges';
import { Card, KeyValues } from '@/components/ui/primitives';
import { daysInclusive, fmtDay, fmtRange, fmtStamp, plural, TYPE_LABEL } from '@/lib/format';
import { nextStep, sessionsByFaculty, type Concern, type LeaveDetailData } from '@/lib/leave';
import type { LeaveEvent } from '@/lib/types';

export function LeaveDetail({ leave, events, concerns, audience, aside }: {
  leave: LeaveDetailData;
  events: LeaveEvent[];
  concerns?: Concern[];
  audience: 'student' | 'staff';
  aside?: ReactNode;
}) {
  const days = daysInclusive(leave.from_date, leave.to_date);
  const groups = sessionsByFaculty(leave);
  const isStaff = audience === 'staff';

  const facts = [
    ...(isStaff && leave.student
      ? [{ label: 'Student', value: <>{leave.student.full_name}<span className="text-ink-muted"> · {leave.student.student_no} · {leave.student.batch} {leave.student.section}</span></> }]
      : []),
    { label: 'Type', value: TYPE_LABEL[leave.type] },
    { label: 'Dates', value: `${fmtRange(leave.from_date, leave.to_date)} · ${plural(days, 'day')}` },
    { label: leave.filed_by ? 'Filed' : 'Submitted', value: <>{fmtStamp(leave.submitted_at)}{leave.filed_by && <span className="text-ink-muted"> · by the Dean HRM Office{isStaff && leave.filer ? ` (${leave.filer.full_name})` : ''}</span>}</> },
    ...(leave.edited_at ? [{ label: 'Last changed', value: fmtStamp(leave.edited_at) }] : []),
    ...(isStaff && leave.decided_at && leave.decider
      ? [{ label: 'Decided', value: <>{fmtStamp(leave.decided_at)}<span className="text-ink-muted"> · {leave.decider.full_name}{leave.decided_by_delegate ? ', on behalf of the Dean' : ''}</span></> }]
      : []),
    { label: 'Away from campus', value: leave.away_from_campus && leave.return_date ? `Yes, back on ${fmtDay(leave.return_date)}` : 'No' },
    ...(leave.away_from_campus ? [{ label: 'Contact during absence', value: `${leave.contact_name} · ${leave.contact_phone}` }] : []),
    { label: 'Reason', value: <span className="whitespace-pre-line">{leave.reason}</span>, wide: true },
    ...(leave.decision_note ? [{ label: leave.status === 'rejected' ? 'Reason for decision' : 'Note from the Dean', value: leave.decision_note, wide: true }] : []),
    ...(isStaff && leave.office_note ? [{ label: 'Dean HRM Office note (not shown to the student)', value: <span className="whitespace-pre-line">{leave.office_note}</span>, wide: true }] : []),
  ];

  return (
    <div className={aside ? 'grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]' : 'grid grid-cols-1 gap-6'}>
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
            <p className="max-w-xl text-sm text-ink-soft">{nextStep(leave, audience, leave.faculty_acks)}</p>
            <StatusBadge status={leave.status} />
          </div>
          <div className="px-5 py-5">
            <KeyValues items={facts} />
          </div>
        </Card>

        {isStaff && concerns && concerns.length > 0 && (
          <div className="rounded-md border border-bad-line bg-bad-bg px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-bad-fg">
              <AlertTriangle className="h-4 w-4" /> {plural(concerns.length, 'concern')} raised by faculty
            </div>
            <ul className="mt-3 flex flex-col gap-3">
              {concerns.map((c) => (
                <li key={c.id} className="text-sm text-ink">
                  <p className="whitespace-pre-line">{c.concern}</p>
                  <p className="mt-1 text-xs text-ink-muted">{c.faculty?.full_name} · {fmtStamp(c.created_at)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Card title="Missed sessions and faculty responses" description={groups.length ? undefined : 'No classes fall on these dates.'}>
          {groups.length > 0 && (
            <ul className="divide-y divide-line">
              {groups.map((g) => (
                <li key={g.faculty} className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">{g.faculty}</div>
                    <ul className="mt-1 flex flex-col text-sm text-ink-soft">
                      {g.sessions.map((s) => (
                        <li key={s.starts_at + s.course_code}><span className="font-medium text-ink">{s.course_code}</span> · {fmtStamp(s.starts_at)}</li>
                      ))}
                    </ul>
                    {g.note && <p className="mt-2 rounded border-l-2 border-gold-500 bg-gold-100/60 px-3 py-2 text-sm text-ink">{g.note}</p>}
                    {!isStaff && g.status === 'flagged' && <p className="mt-2 text-xs text-ink-muted">This faculty member shared a point with the Dean.</p>}
                  </div>
                  <div className="flex flex-col items-start gap-1 sm:items-end">
                    <AckBadge status={g.status} />
                    {g.responded_at && <span className="text-xs text-ink-muted">{fmtStamp(g.responded_at)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="History" description={isStaff ? 'Every step, who took it and when. Entries marked “office only” are not shown to the student.' : undefined}>
          <ol className="px-5 py-2">
            {events.map((e) => (
              <li key={e.id} className="grid grid-cols-1 gap-0.5 border-b border-dashed border-line py-3 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
                <time dateTime={e.created_at} className="text-xs text-ink-muted sm:pt-0.5">{fmtStamp(e.created_at)}</time>
                <div className="min-w-0 text-sm text-ink">
                  <span className="break-words">{e.message}</span>
                  {isStaff && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <span>{e.actor?.full_name ? `by ${e.actor.full_name}` : 'automatic'}</span>
                      {e.visible_to_student === false && <span className="rounded bg-quiet-bg px-1.5 py-0.5 font-semibold text-quiet-fg">office only</span>}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      {aside && <div className="order-first flex flex-col gap-6 lg:order-none">{aside}</div>}
    </div>
  );
}
