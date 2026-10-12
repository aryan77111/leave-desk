import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink, Settings2 } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader, TableWrap } from '@/components/ui/primitives';
import { addDays, dayStart, fmtDay, fmtStamp, fmtTime, localDate, todayLocal, type Tone } from '@/lib/format';
import { sheetUrl } from '@/lib/sheet-link';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { TimetableImport } from './timetable-import';
import { ArchiveToggle, PauseToggle, SheetForm, SyncButton } from './sync-controls';

export const metadata: Metadata = { title: 'Timetable' };

type Problem = { date: string; start: string; text: string; reason: string };
type Report = {
  sessions_in_sheet?: number; first_date?: string; last_date?: string; sheet_name?: string;
  unreadable_count?: number; unreadable?: Problem[]; skipped?: string[]; would_cancel?: number;
};
type Sheet = {
  id: string; batch: string; term: string; file_id: string; enabled: boolean; archived_at: string | null; last_checked_at: string | null; last_synced_at: string | null;
  last_status: 'ok' | 'error' | 'blocked' | null; last_message: string | null; last_report: Report | null;
};
type Change = { id: number; batch: string; section: string; course_code: string; starts_at: string; kind: 'added' | 'cancelled' | 'restored' | 'changed'; detail: string | null; created_at: string };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  ok: { label: 'In sync', tone: 'ok' },
  blocked: { label: 'Needs a look', tone: 'warn' },
  error: { label: 'Sync failed', tone: 'bad' },
  new: { label: 'Not synced yet', tone: 'quiet' },
  paused: { label: 'Paused', tone: 'quiet' },
};
const CHANGE: Record<Change['kind'], { label: string; tone: Tone }> = {
  added: { label: 'Added', tone: 'ok' },
  restored: { label: 'Back on', tone: 'ok' },
  changed: { label: 'Changed', tone: 'info' },
  cancelled: { label: 'Cancelled', tone: 'warn' },
};

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
  const [{ data }, { data: classes }, { data: sheetData }, { data: changeData }, { data: codeRows }] = await Promise.all([
    query,
    supabase.from('class_sessions').select('batch, section').gte('starts_at', dayStart(addDays(todayLocal(), -60)).toISOString()).limit(5000),
    supabase.from('timetable_sheets').select('id, batch, term, file_id, enabled, archived_at, last_checked_at, last_synced_at, last_status, last_message, last_report').order('batch', { ascending: false }).order('created_at'),
    supabase.from('timetable_changes').select('id, batch, section, course_code, starts_at, kind, detail, created_at').order('created_at', { ascending: false }).order('starts_at').limit(40),
    supabase.from('sheet_course_codes').select('sheet_id'),
  ]);
  const sheets = (sheetData ?? []) as Sheet[];
  const active = sheets.filter((x) => !x.archived_at);
  const archived = sheets.filter((x) => x.archived_at).sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? ''));
  const changes = (changeData ?? []) as Change[];
  const codeCount = new Map<string, number>();
  for (const c of (codeRows ?? []) as { sheet_id: string }[]) codeCount.set(c.sheet_id, (codeCount.get(c.sheet_id) ?? 0) + 1);
  const { data: studentBatches } = await supabase.from('people').select('batch').contains('roles', ['student']).not('batch', 'is', null).limit(5000);
  const knownBatches = [...new Set((studentBatches ?? []).map((p: { batch: string }) => p.batch))].sort().reverse();
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
      <PageHeader
        title="Timetable"
        description="Classes come straight from the Dean HRM Office's Google Sheets. Edits in a sheet show up here within 10 minutes."
        action={
          <>
            <LinkButton href="/office/timetable/courses" variant="secondary"><Settings2 className="h-4 w-4" />Course codes</LinkButton>
            {active.length > 0 && <SyncButton label="Sync now" variant="primary" />}
          </>
        }
      />

      <Card
        className="mb-6"
        title="Live sheets"
        description="One sheet per batch per term, checked every 10 minutes. A sheet only changes its own classes, so next term's sheet can be added before this term ends. Past classes are never changed."
      >
        {active.length === 0 ? (
          <div className="px-5 py-5">
            <p className="mb-4 text-sm text-ink-soft">Connect each batch's class-schedule sheet for the term. Share the sheet as “Anyone with the link can view” first.</p>
            <SheetForm batches={knownBatches} />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((sh) => {
              const st = !sh.enabled ? STATUS.paused : STATUS[sh.last_status ?? 'new'];
              const rep = sh.last_report ?? {};
              const codes = codeCount.get(sh.id) ?? 0;
              return (
                <li key={sh.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-ink">{sh.batch} · {sh.term}</h3>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <a href={sheetUrl(sh.file_id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-navy-700 hover:underline">
                          Open sheet<ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </div>
                      <p className="mt-1 text-sm text-ink-soft">{sh.last_message ?? (codes === 0 ? 'Waiting for course codes.' : 'Waiting for the first sync.')}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {sh.last_checked_at ? `Checked ${fmtStamp(sh.last_checked_at)}` : 'Not checked yet'}
                        {rep.sessions_in_sheet ? ` · ${rep.sessions_in_sheet} classes in the sheet` : ''}
                        {rep.first_date && rep.last_date ? `, ${fmtDay(rep.first_date)} to ${fmtDay(rep.last_date, true)}` : ''}
                        {' · '}<Link href={`/office/timetable/courses#sheet-${sh.id}`} className="font-semibold text-navy-700 hover:underline">{codes} course code{codes === 1 ? '' : 's'}</Link>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-start gap-4">
                      {sh.last_status === 'blocked' && <SyncButton sheetId={sh.id} force label="Sync anyway" />}
                      <PauseToggle id={sh.id} enabled={sh.enabled} />
                      <ArchiveToggle id={sh.id} archived={false} />
                    </div>
                  </div>

                  {codes === 0 && (
                    <Alert tone="warn" className="mt-3">
                      Add this term's <Link href={`/office/timetable/courses#sheet-${sh.id}`} className="font-semibold underline">course codes</Link>. The sheet is read once they are in.
                    </Alert>
                  )}
                  {(rep.unreadable_count ?? 0) > 0 && (
                    <details className="mt-3 rounded border border-warn-line bg-warn-bg px-3.5 py-2.5 text-sm">
                      <summary className="cursor-pointer font-semibold text-warn-fg">
                        {rep.unreadable_count} cell{rep.unreadable_count === 1 ? '' : 's'} could not be read. Classes in those slots were left as they were.
                      </summary>
                      <ul className="mt-2 space-y-1 text-ink-soft">
                        {(rep.unreadable ?? []).map((u, i) => (
                          <li key={i}><span className="font-semibold text-ink">{fmtDay(u.date)} {u.start}</span> · “{u.text}”: {u.reason}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {(rep.skipped?.length ?? 0) > 0 && (
                    <p className="mt-2 text-xs text-ink-muted">Not classes, skipped: {rep.skipped!.join(', ')}</p>
                  )}
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-ink-muted hover:text-ink">Change the link or term name</summary>
                    <div className="mt-3"><SheetForm sheet={{ id: sh.id, batch: sh.batch, term: sh.term, link: sheetUrl(sh.file_id) }} batches={knownBatches} /></div>
                  </details>
                </li>
              );
            })}
            <li className="px-5 py-3">
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-navy-700">Add next term's sheet</summary>
                <p className="mt-2 text-ink-muted">Add it any time, even before this term ends. Then add its course codes. This term's sheet is archived automatically after its last day.</p>
                <div className="mt-3"><SheetForm batches={knownBatches} /></div>
              </details>
            </li>
          </ul>
        )}
        {archived.length > 0 && (
          <details className="border-t border-line px-5 py-3 text-sm">
            <summary className="cursor-pointer text-ink-muted hover:text-ink">Past terms ({archived.length})</summary>
            <ul className="mt-2 divide-y divide-line">
              {archived.map((sh) => (
                <li key={sh.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-semibold text-ink">{sh.batch} · {sh.term}</span>
                    <span className="text-ink-muted"> · archived {fmtStamp(sh.archived_at!)}{sh.last_report?.sessions_in_sheet ? ` · ${sh.last_report.sessions_in_sheet} classes` : ''}</span>
                  </span>
                  <span className="flex items-center gap-4">
                    <a href={sheetUrl(sh.file_id)} target="_blank" rel="noreferrer" className="font-semibold text-navy-700 hover:underline">Open sheet</a>
                    <ArchiveToggle id={sh.id} archived />
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {changes.length > 0 && (
        <Card className="mb-6" title="Recent changes from the sheets">
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Change</th><th>Class</th><th>Course</th><th>When</th><th>Details</th><th>Synced</th></tr></thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td><Badge tone={CHANGE[c.kind].tone}>{CHANGE[c.kind].label}</Badge></td>
                    <td className="whitespace-nowrap">{c.batch} {c.section}</td>
                    <td className="font-semibold">{c.course_code}</td>
                    <td className="whitespace-nowrap tabular-nums">{fmtDay(localDate(c.starts_at))} {fmtTime(c.starts_at)}</td>
                    <td className="text-ink-soft">{c.detail ?? ''}</td>
                    <td className="whitespace-nowrap text-ink-muted">{fmtStamp(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

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
            Nothing scheduled, or the sheets have not synced yet. <Link className="font-semibold text-navy-700 hover:underline" href={href(mondayOf(todayLocal()))}>This week</Link>
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

      <details className="mt-6 rounded-lg border border-line bg-white px-5 py-4 ">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Import a CSV instead</summary>
        <p className="mt-2 text-sm text-ink-muted">For one-off sessions that are not in a sheet. One row per session; faculty must already be on the roster. Dates as YYYY-MM-DD or DD/MM/YYYY; times as 09:45 or 9.45 AM. Add a 'cancelled' column with yes to cancel a session. Sessions imported this way are not touched by the sheet sync.</p>
        <div className="mt-3"><TimetableImport /></div>
      </details>
    </>
  );
}
