import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, LinkButton, PageHeader, TableWrap } from '@/components/ui/primitives';
import { addDays, dayStart, fmtDay, fmtTime, localDate, todayLocal } from '@/lib/format';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { TimetableImport } from './timetable-import';

export const metadata: Metadata = { title: 'Timetable' };

type Row = { id: string; course_code: string; course_name: string | null; batch: string; section: string; starts_at: string; ends_at: string | null; cancelled: boolean; faculty: { full_name: string } | null };

function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

export default async function TimetablePage({ searchParams }: { searchParams: Promise<{ week?: string; batch?: string }> }) {
  await requireViewer('office');
  const sp = await searchParams;
  const week = mondayOf(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : todayLocal());
  const supabase = await createClient();
  let query = supabase
    .from('class_sessions')
    .select('id, course_code, course_name, batch, section, starts_at, ends_at, cancelled, faculty:people(full_name)')
    .gte('starts_at', dayStart(week).toISOString())
    .lt('starts_at', dayStart(addDays(week, 7)).toISOString())
    .order('starts_at')
    .limit(2000);
  const batch = (sp.batch ?? '').trim();
  if (batch) {
    const [b, s] = batch.split('|');
    query = query.eq('batch', b);
    if (s) query = query.eq('section', s);
  }
  const [{ data }, { data: classes }] = await Promise.all([
    query,
    supabase.from('class_sessions').select('batch, section').gte('starts_at', dayStart(addDays(todayLocal(), -60)).toISOString()).limit(5000),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const classList = [...new Set((classes ?? []).map((c: { batch: string; section: string }) => `${c.batch}|${c.section}`))].sort();
  const days = new Map<string, Row[]>();
  for (const r of rows) {
    const d = localDate(r.starts_at);
    days.set(d, [...(days.get(d) ?? []), r]);
  }
  const href = (w: string) => `/office/timetable?${new URLSearchParams({ week: w, ...(batch ? { batch } : {}) })}`;

  return (
    <>
      <PageHeader title="Timetable" description="Students' missed sessions are filled in from here. Re-importing a file updates sessions instead of duplicating them." />

      <Card className="mb-6" title="Import timetable" description="One row per session. Faculty must already be on the roster. Dates as YYYY-MM-DD or DD/MM/YYYY; times as 09:45 or 9.45 AM. Add a 'cancelled' column with yes to cancel a session.">
        <div className="px-5 py-4"><TimetableImport /></div>
      </Card>

      <Card
        title={`Week of ${fmtDay(week, true)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <form className="flex items-center gap-2">
              <input type="hidden" name="week" value={week} />
              <label className="sr-only" htmlFor="batch">Class</label>
              <select id="batch" name="batch" defaultValue={batch} className="field-input h-9 py-1">
                <option value="">All classes</option>
                {classList.map((c) => <option key={c} value={c}>{c.replace('|', ', Section ')}</option>)}
              </select>
              <button className="h-9 rounded border border-line-strong bg-white px-3 text-sm font-semibold hover:bg-canvas">Show</button>
            </form>
            <LinkButton variant="secondary" href={href(addDays(week, -7))}>Previous</LinkButton>
            <LinkButton variant="secondary" href={href(addDays(week, 7))}>Next</LinkButton>
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No sessions this week">
            Import the timetable above, or move to another week. <Link className="font-semibold text-navy-700 hover:underline" href={href(mondayOf(todayLocal()))}>This week</Link>
          </EmptyState>
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Day</th><th>Time</th><th>Course</th><th>Class</th><th>Faculty</th></tr></thead>
              <tbody>
                {[...days.entries()].flatMap(([d, list]) =>
                  list.map((r, i) => (
                    <tr key={r.id} className={r.cancelled ? 'text-ink-faint' : ''}>
                      <td className="whitespace-nowrap font-semibold">{i === 0 ? fmtDay(d) : ''}</td>
                      <td className="whitespace-nowrap tabular-nums">{fmtTime(r.starts_at)}{r.ends_at ? `–${fmtTime(r.ends_at)}` : ''}</td>
                      <td><span className="font-semibold">{r.course_code}</span>{r.course_name && <span className="text-ink-muted"> · {r.course_name}</span>}{r.cancelled && <Badge tone="quiet" className="ml-2">Cancelled</Badge>}</td>
                      <td className="whitespace-nowrap">{r.batch} {r.section}</td>
                      <td>{r.faculty?.full_name}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
