import type { Metadata } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { fmtStamp, relativeHours } from '@/lib/format';
import { getSettings, requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'System health' };
export const dynamic = 'force-dynamic';

type Check = { label: string; state: 'ok' | 'warn' | 'bad'; detail: React.ReactNode; href?: string };
type Err = { id: number; source: string; message: string; path: string | null; digest: string | null; created_at: string };

const ICON = { ok: CheckCircle2, warn: AlertTriangle, bad: XCircle };
const TONE = { ok: 'text-ok-fg', warn: 'text-warn-fg', bad: 'text-bad-fg' };

export default async function HealthPage() {
  await requireViewer('office');
  const supabase = await createClient();
  const s = await getSettings();
  const now = Date.now();
  const dayAgo = new Date(now - 864e5).toISOString();
  const weekAgo = new Date(now - 7 * 864e5).toISOString();
  const count = { count: 'exact' as const, head: true };

  const [job, queued, oldest, failed, lastSent, sheets, errors24, recent] = await Promise.all([
    supabase.from('job_runs').select('last_run_at, last_result').eq('name', 'scheduled_jobs').maybeSingle(),
    supabase.from('email_outbox').select('id', count).in('status', ['queued', 'sending']),
    supabase.from('email_outbox').select('created_at').in('status', ['queued', 'sending']).order('created_at').limit(1).maybeSingle(),
    supabase.from('email_outbox').select('id', count).eq('status', 'failed').gte('created_at', weekAgo),
    supabase.from('email_outbox').select('sent_at').eq('status', 'sent').order('sent_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('timetable_sheets').select('id, batch, term, enabled, archived_at, last_checked_at, last_status, last_message').is('archived_at', null).eq('enabled', true),
    supabase.from('app_errors').select('id', count).gte('created_at', dayAgo),
    supabase.from('app_errors').select('id, source, message, path, digest, created_at').order('created_at', { ascending: false }).limit(30),
  ]);

  const checks: Check[] = [];
  const jobAt = (job.data as { last_run_at: string } | null)?.last_run_at;
  const jobAge = jobAt ? (now - Date.parse(jobAt)) / 6e4 : null;
  checks.push({
    label: 'Reminders and automatic steps',
    state: jobAge === null ? 'warn' : jobAge <= 30 ? 'ok' : 'bad',
    detail: jobAge === null
      ? 'No run recorded yet. They run every 10 minutes; check again shortly.'
      : jobAge <= 30 ? `Last ran ${fmtStamp(jobAt!)}.` : `Last ran ${relativeHours(jobAt!)} ago. Deemed acknowledgments, reminders and certificate deadlines are not being processed. Ask whoever maintains Leave Desk to check the scheduled job.`,
  });

  const oldestAt = (oldest.data as { created_at: string } | null)?.created_at;
  const oldestMin = oldestAt ? (now - Date.parse(oldestAt)) / 6e4 : 0;
  const configured = Boolean(s.app_url && s.email_from);
  checks.push({
    label: 'Email sending',
    state: !configured ? 'bad' : oldestMin > 15 ? 'bad' : (failed.count ?? 0) > 0 ? 'warn' : 'ok',
    detail: !configured
      ? 'The app address or the email sender is not set, so emails are waiting in the outbox.'
      : oldestMin > 15
        ? `${queued.count} email${queued.count === 1 ? '' : 's'} waiting; the oldest for ${relativeHours(oldestAt!)}. Check the Resend key and that the sender's domain is verified.`
        : `${queued.count ?? 0} waiting, ${failed.count ?? 0} failed in the last 7 days. Last sent ${lastSent.data ? fmtStamp((lastSent.data as { sent_at: string }).sent_at) : 'never'}. Sender: ${s.email_from}.`,
    href: '/office/emails',
  });

  const sheetRows = (sheets.data ?? []) as { id: string; batch: string; term: string; last_checked_at: string | null; last_status: string | null; last_message: string | null }[];
  const broken = sheetRows.filter((x) => x.last_status === 'error' || x.last_status === 'blocked');
  const stale = sheetRows.filter((x) => !x.last_checked_at || now - Date.parse(x.last_checked_at) > 30 * 6e4);
  checks.push({
    label: 'Timetable sheets',
    state: sheetRows.length === 0 ? 'warn' : broken.length ? 'bad' : stale.length ? 'warn' : 'ok',
    detail: sheetRows.length === 0 ? 'No live sheet is connected.'
      : broken.length ? `${broken.map((x) => `${x.batch} ${x.term}: ${x.last_message ?? x.last_status}`).join('; ')}`
        : stale.length ? `${stale.length} sheet${stale.length === 1 ? ' has' : 's have'} not been checked in the last 30 minutes.`
          : `${sheetRows.length} sheet${sheetRows.length === 1 ? '' : 's'} checked in the last 30 minutes.`,
    href: '/office/timetable',
  });

  const errCount = errors24.count ?? 0;
  checks.push({
    label: 'Errors in the app',
    state: errCount === 0 ? 'ok' : errCount < 10 ? 'warn' : 'bad',
    detail: errCount === 0 ? 'None in the last 24 hours.' : `${errCount} in the last 24 hours. The office is emailed at most once an hour about new ones.`,
  });

  const errs = (recent.data ?? []) as Err[];

  return (
    <>
      <PageHeader title="System health" description="Whether the parts that run in the background are working. Check here if something seems stuck." />
      <Card>
        <ul className="divide-y divide-line">
          {checks.map((c) => {
            const Icon = ICON[c.state];
            return (
              <li key={c.label} className="flex items-start gap-3 px-5 py-4">
                <Icon className={clsx('mt-0.5 h-5 w-5 shrink-0', TONE[c.state])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{c.label}<span className="sr-only">: {c.state}</span></span>
                    {c.href && <Link href={c.href} className="text-sm font-semibold text-navy-700 hover:underline">Open</Link>}
                  </div>
                  <p className="mt-0.5 break-words text-sm text-ink-soft">{c.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="mt-6" title="Recent errors" description="Unexpected errors from pages, actions and browsers. Expected messages (such as a rule not met) are not listed.">
        {errs.length === 0 ? <EmptyState title="No errors recorded" /> : (
          <ul className="divide-y divide-line">
            {errs.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <p className="break-words font-mono text-xs text-ink">{e.message}</p>
                <p className="mt-1 text-xs text-ink-muted">{fmtStamp(e.created_at)} · {e.source === 'server' ? 'server' : 'browser'}{e.path ? ` · ${e.path}` : ''}{e.digest ? ` · ref ${e.digest}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
