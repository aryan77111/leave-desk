import type { Metadata } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { Badge, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui/primitives';
import { fmtStamp, type Tone } from '@/lib/format';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Emails sent' };
const PAGE = 50;

type Mail = { id: number; to_email: string; to_name: string | null; subject: string; body: string; kind: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null };
const TONE: Record<string, Tone> = { sent: 'ok', queued: 'quiet', sending: 'info', failed: 'bad' };
const LABEL: Record<string, string> = { sent: 'Sent', queued: 'Waiting', sending: 'Sending', failed: 'Failed' };

export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  await requireViewer('office');
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = sp.status && sp.status in LABEL ? sp.status : undefined;
  const supabase = await createClient();
  let query = supabase
    .from('email_outbox')
    .select('id, to_email, to_name, subject, body, kind, status, attempts, last_error, created_at, sent_at', { count: 'exact' })
    .order('id', { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (status) query = query.eq('status', status);
  const { data, count } = await query;
  const mails = (data ?? []) as Mail[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const waiting = mails.some((m) => m.status === 'queued' && Date.now() - Date.parse(m.created_at) > 10 * 60e3);

  const tab = (s: string | undefined, label: string) => (
    <Link href={s ? `/office/emails?status=${s}` : '/office/emails'} aria-current={status === s ? 'page' : undefined}
      className={clsx('border-b-2 px-1 pb-2.5 text-sm font-semibold', status === s ? 'border-gold-500 text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>{label}</Link>
  );

  return (
    <>
      <PageHeader title="Emails sent" description="Every email Leave Desk sends, newest first. Response links inside faculty emails are not stored after sending." />
      {waiting && (
        <div className="mb-4 rounded-md border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn-fg">
          Some emails have been waiting more than 10 minutes. Check that the app address and sender are set in Rules and settings, and that the Resend key is added in Supabase.
        </div>
      )}
      <div className="mb-4 flex gap-6 border-b border-line">
        {tab(undefined, 'All')}{tab('queued', 'Waiting')}{tab('failed', 'Failed')}{tab('sent', 'Sent')}
      </div>
      <Card>
        {mails.length === 0 ? <EmptyState title="No emails here" /> : (
          <ul className="divide-y divide-line">
            {mails.map((m) => (
              <li key={m.id}>
                <details className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-1 gap-1 px-5 py-3.5 hover:bg-canvas sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:gap-4">
                    <span className="text-xs text-ink-muted sm:pt-0.5">{fmtStamp(m.sent_at ?? m.created_at)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{m.subject}</span>
                      <span className="block truncate text-xs text-ink-muted">To {m.to_name ? `${m.to_name} <${m.to_email}>` : m.to_email}</span>
                    </span>
                    <span><Badge tone={TONE[m.status] ?? 'quiet'}>{LABEL[m.status] ?? m.status}</Badge></span>
                  </summary>
                  <div className="px-5 pb-4">
                    <pre className="whitespace-pre-wrap rounded bg-canvas p-3 font-sans text-sm text-ink-soft">{m.body}</pre>
                    {m.last_error && <p className="mt-2 text-xs text-bad-fg">Last error ({m.attempts} attempt{m.attempts === 1 ? '' : 's'}): {m.last_error}</p>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-ink-muted">
          <span>{total} email{total === 1 ? '' : 's'}{pages > 1 ? ` · page ${page} of ${pages}` : ''}</span>
          {pages > 1 && (
            <div className="flex gap-2">
              {page > 1 && <LinkButton variant="secondary" href={`/office/emails?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page - 1) })}`}>Previous</LinkButton>}
              {page < pages && <LinkButton variant="secondary" href={`/office/emails?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page + 1) })}`}>Next</LinkButton>}
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
