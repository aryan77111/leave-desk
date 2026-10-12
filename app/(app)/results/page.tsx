import type { Metadata } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { Download } from 'lucide-react';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { addDays, fmtDay, fmtStamp, todayLocal } from '@/lib/format';
import { fmtPct, TARGET_LABEL, targetState, type TargetState } from '@/lib/metrics';
import { requireOneOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Pilot results' };

type Metrics = {
  from: string; to: string; generated_at: string;
  requests: { total: number; by_office: number; edited: number; withdrawn: number; approved: number; rejected: number; cancelled: number; open: number; medical: number; family: number; official: number };
  online: { pct: number | null; by_office: number; target: number };
  decision: { pct: number | null; in_time: number; decided: number; open_late: number; open_in_window: number; by_delegate: number; median_hours: number | null; window_hours: number; target: number };
  ack: { pct: number | null; in_time: number; late: number; deemed: number; pending: number; flagged: number; total: number; window_hours: number; target: number };
  certificates: { pct: number | null; on_time: number; late: number; missed: number; waiting: number; target: number };
  survey: { answered: number; satisfaction: number | null; ease: number | null; faster_yes: number; faster_answered: number; students: number | null; faculty: number | null; staff: number | null; target: number; open: boolean };
};

const STATE_STYLE: Record<TargetState, string> = {
  met: 'bg-ok-bg text-ok-fg ring-ok-line',
  close: 'bg-warn-bg text-warn-fg ring-warn-line',
  below: 'bg-bad-bg text-bad-fg ring-bad-line',
  none: 'bg-quiet-bg text-quiet-fg ring-quiet-line',
};

function Kpi({ title, value, target, state, children }: { title: string; value: string; target: string; state: TargetState; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-md border border-line bg-white shadow-card">
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className={clsx('whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', STATE_STYLE[state])}>{TARGET_LABEL[state]}</span>
      </div>
      <div className="flex items-baseline gap-2 px-5 pt-2">
        <span className="text-3xl font-semibold tabular-nums text-ink">{value}</span>
        <span className="text-sm text-ink-muted">target {target}</span>
      </div>
      <div className="mt-3 flex-1 border-t border-line px-5 py-3 text-sm text-ink-soft">{children}</div>
    </section>
  );
}

const isDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; batch?: string }> }) {
  const { person } = await requireOneOf(['office', 'approver']);
  const isOffice = person.roles.includes('office');
  const sp = await searchParams;
  const today = todayLocal();
  const supabase = await createClient();

  // Default range: from the first request (the start of the pilot) to today.
  let from = isDate(sp.from) ? sp.from! : '';
  if (!from) {
    const { data: firstRow } = await supabase.from('leave_requests').select('submitted_at').order('submitted_at').limit(1).maybeSingle();
    from = firstRow ? (firstRow as { submitted_at: string }).submitted_at.slice(0, 10) : addDays(today, -30);
  }
  const to = isDate(sp.to) ? sp.to! : today;
  const batch = sp.batch && sp.batch.length < 30 ? sp.batch : '';

  const [{ data, error }, { data: batchRows }] = await Promise.all([
    supabase.rpc('pilot_metrics', { p_from: from, p_to: to, p_batch: batch || null }),
    supabase.from('people').select('batch').contains('roles', ['student']).eq('active', true).not('batch', 'is', null).limit(5000),
  ]);
  const batches = [...new Set(((batchRows ?? []) as { batch: string }[]).map((b) => b.batch))].sort().reverse();
  const m = data as Metrics | null;
  const csvHref = `/results/csv?${new URLSearchParams({ from, to, ...(batch ? { batch } : {}) }).toString()}`;

  return (
    <>
      <PageHeader
        title="Pilot results"
        description="The figures the proposal promised the Dean, worked out from the timestamps of every step. Requests are counted by the day they were submitted."
        action={<a href={csvHref} className="inline-flex h-9 items-center gap-2 rounded border border-line-strong bg-white px-3.5 text-sm font-semibold text-ink hover:bg-canvas"><Download className="h-4 w-4" /> Download per-request CSV</a>}
      />

      <form className="mb-6 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1"><span className="label-caps">From</span><input type="date" name="from" defaultValue={from} className="field-input" /></label>
        <label className="flex flex-col gap-1"><span className="label-caps">To</span><input type="date" name="to" defaultValue={to} className="field-input" /></label>
        <label className="col-span-2 flex flex-col gap-1 sm:col-span-1"><span className="label-caps">Batch</span>
          <select name="batch" defaultValue={batch} className="field-input sm:w-40">
            <option value="">All batches</option>
            {batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select></label>
        <button className="col-span-2 h-10 rounded bg-navy-700 px-3.5 text-sm font-semibold text-white hover:bg-navy-800 sm:col-span-1 sm:h-9">Update</button>
      </form>

      {error || !m ? (
        <Alert tone="bad" title="Could not work out the results">Check the dates and try again.</Alert>
      ) : (
        <>
          {m.requests.total === 0 && (
            <Alert tone="quiet" className="mb-6" title="No requests in this range yet">The figures fill in as students apply.</Alert>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Kpi title={`Decided within ${m.decision.window_hours} hours`} value={fmtPct(m.decision.pct)} target={`${m.decision.target}%`} state={targetState(m.decision.pct, m.decision.target)}>
              <p>{m.decision.in_time} of {m.decision.decided + m.decision.open_late} on time{m.decision.open_late ? `, including ${m.decision.open_late} still waiting past the window` : ''}.</p>
              <p className="mt-1 text-ink-muted">
                Typical time to a decision: {m.decision.median_hours !== null ? `${m.decision.median_hours} h` : '—'}.
                {m.decision.open_in_window ? ` ${m.decision.open_in_window} waiting within the window are not counted yet.` : ''}
                {m.decision.by_delegate ? ` ${m.decision.by_delegate} decided by a delegate.` : ''}
              </p>
            </Kpi>
            <Kpi title={`Faculty replied within ${m.ack.window_hours} hours`} value={fmtPct(m.ack.pct)} target={`${m.ack.target}%`} state={targetState(m.ack.pct, m.ack.target)}>
              <p>{m.ack.in_time} of {m.ack.total - m.ack.pending} notices answered in time; {m.ack.deemed} deemed acknowledged{m.ack.late ? `, ${m.ack.late} answered late` : ''}.</p>
              <p className="mt-1 text-ink-muted">{m.ack.flagged} concern{m.ack.flagged === 1 ? '' : 's'} raised. {m.ack.pending ? `${m.ack.pending} still within their window.` : ''}</p>
            </Kpi>
            <Kpi title="Medical certificates on time" value={fmtPct(m.certificates.pct)} target={`${m.certificates.target}%`} state={targetState(m.certificates.pct, m.certificates.target)}>
              <p>{m.certificates.on_time} on time, {m.certificates.late} late, {m.certificates.missed} never uploaded.</p>
              <p className="mt-1 text-ink-muted">Counts the first upload, even if the office later asked for a new one.{m.certificates.waiting ? ` ${m.certificates.waiting} not yet due.` : ''}</p>
            </Kpi>
            <Kpi title="Requests made online by students" value={fmtPct(m.online.pct)} target="100%" state={targetState(m.online.pct, 100)}>
              <p>{m.requests.total - m.online.by_office} of {m.requests.total} filed by students themselves; {m.online.by_office} filed by the Dean HRM Office for a student.</p>
              <p className="mt-1 text-ink-muted">No request needs a visit to collect signatures.</p>
            </Kpi>
            <Kpi title="Satisfaction (out of 5)" value={m.survey.satisfaction !== null ? String(m.survey.satisfaction) : '—'} target={String(m.survey.target)}
              state={targetState(m.survey.satisfaction, Number(m.survey.target), 'rating')}>
              <p>{m.survey.answered} answer{m.survey.answered === 1 ? '' : 's'}. Ease of use {m.survey.ease ?? '—'}.{m.survey.faster_answered ? ` ${m.survey.faster_yes} of ${m.survey.faster_answered} said it was quicker than paper.` : ''}</p>
              <p className="mt-1 text-ink-muted">
                Students {m.survey.students ?? '—'} · faculty {m.survey.faculty ?? '—'} · Dean and office {m.survey.staff ?? '—'}.{' '}
                {m.survey.open ? 'The survey is open.' : isOffice
                  ? <>The survey is closed. Open it near the end of the pilot in <Link href="/office/settings#survey" className="font-semibold text-navy-700 hover:underline">Rules and settings</Link>.</>
                  : 'The survey is closed; the Dean HRM Office opens it near the end of the pilot.'}
              </p>
            </Kpi>
            <section className="rounded-md border border-line bg-white px-5 py-4 shadow-card">
              <h2 className="text-sm font-semibold text-ink">Requests</h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {[
                  ['Total', m.requests.total], ['Approved', m.requests.approved], ['Not approved', m.requests.rejected], ['Still open', m.requests.open],
                  ['Withdrawn', m.requests.withdrawn], ['Cancelled', m.requests.cancelled], ['Changed by student', m.requests.edited],
                  ['Medical', m.requests.medical], ['Family', m.requests.family], ['University official', m.requests.official],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-2 border-b border-dashed border-line pb-1"><dt className="text-ink-muted">{k}</dt><dd className="font-semibold tabular-nums text-ink">{v}</dd></div>
                ))}
              </dl>
            </section>
          </div>
          <p className="mt-4 text-xs text-ink-muted">
            {fmtDay(m.from, true)} to {fmtDay(m.to, true)}{batch ? `, batch ${batch}` : ''}. Worked out {fmtStamp(m.generated_at)}. Targets are set in Rules and settings.
            Medical reasons are never included. The CSV has one row per request with each timing, for the Week 11 report.
          </p>
        </>
      )}
    </>
  );
}
