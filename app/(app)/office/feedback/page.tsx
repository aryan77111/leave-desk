import type { Metadata } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { fmtStamp, ROLE_LABEL } from '@/lib/format';
import { getSettings, requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/types';
import { StatusButtons } from './status-buttons';

export const metadata: Metadata = { title: 'Feedback' };

type Fb = {
  id: number; kind: 'problem' | 'suggestion'; message: string; page: string | null; user_agent: string | null;
  status: 'new' | 'seen' | 'done'; created_at: string;
  person: { full_name: string; email: string; roles: Role[] } | null;
};
type Sv = { role: string; satisfaction: number; ease: number; faster: boolean | null; comment: string | null; updated_at: string; person: { full_name: string } | null };

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireViewer('office');
  const { show } = await searchParams;
  const filter = show === 'all' || show === 'done' ? show : 'open';
  const supabase = await createClient();
  const s = await getSettings();

  let q = supabase.from('feedback')
    .select('id, kind, message, page, user_agent, status, created_at, person:people!feedback_person_id_fkey(full_name, email, roles)')
    .order('created_at', { ascending: false }).limit(200);
  if (filter === 'open') q = q.in('status', ['new', 'seen']);
  if (filter === 'done') q = q.eq('status', 'done');
  const [{ data }, { data: survey }] = await Promise.all([
    q,
    supabase.from('survey_responses').select('role, satisfaction, ease, faster, comment, updated_at, person:people!survey_responses_person_id_fkey(full_name)').order('updated_at', { ascending: false }).limit(1000),
  ]);
  const items = (data ?? []) as unknown as Fb[];
  const answers = (survey ?? []) as unknown as Sv[];
  const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '—');
  const comments = answers.filter((a) => a.comment);

  const tab = (key: string, label: string) => (
    <Link href={key === 'open' ? '/office/feedback' : `/office/feedback?show=${key}`} aria-current={filter === key ? 'page' : undefined}
      className={clsx('border-b-2 px-1 pb-2.5 text-sm font-semibold', filter === key ? 'border-gold-500 text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader title="Feedback" description="Problems and suggestions sent with “Report a problem” from any page, and the end-of-pilot survey. Reported problems are also emailed to the office." />

      <div className="mb-4 flex gap-6 border-b border-line">
        {tab('open', 'To look at')}
        {tab('done', 'Done')}
        {tab('all', 'All')}
      </div>
      <Card>
        {items.length === 0 ? <EmptyState title={filter === 'open' ? 'Nothing waiting' : 'No feedback yet'} /> : (
          <ul className="divide-y divide-line">
            {items.map((f) => (
              <li key={f.id} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={f.kind === 'problem' ? 'bad' : 'info'}>{f.kind === 'problem' ? 'Problem' : 'Suggestion'}</Badge>
                    <span className="text-sm font-semibold text-ink">{f.person?.full_name ?? 'Someone'}</span>
                    <span className="text-xs text-ink-muted">{f.person?.roles.map((r) => ROLE_LABEL[r]).join(', ')} · {fmtStamp(f.created_at)}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-line break-words text-sm text-ink">{f.message}</p>
                  <p className="mt-1 break-all text-xs text-ink-muted">
                    {f.page && <>On <span className="font-medium">{f.page}</span></>}{f.person?.email && <> · {f.person.email}</>}
                    {f.user_agent && <span className="block truncate text-ink-faint">{f.user_agent}</span>}
                  </p>
                </div>
                <StatusButtons id={f.id} status={f.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-8" title="End-of-pilot survey"
        description={s.survey_open ? 'The survey is open. Everyone who has not answered sees a short banner.' : 'The survey is closed. Open it near the end of the pilot in Rules and settings.'}>
        <div className="grid grid-cols-2 gap-3 border-b border-line px-5 py-4 sm:grid-cols-4">
          {[
            ['Answers', String(answers.length)],
            ['Satisfaction', avg(answers.map((a) => a.satisfaction))],
            ['Ease of use', avg(answers.map((a) => a.ease))],
            ['Quicker than paper', `${answers.filter((a) => a.faster === true).length} of ${answers.filter((a) => a.faster !== null).length}`],
          ].map(([k, v]) => (
            <div key={k}><div className="label-caps">{k}</div><div className="mt-1 text-xl font-semibold tabular-nums text-ink">{v}</div></div>
          ))}
        </div>
        {comments.length === 0 ? <EmptyState title="No comments yet" /> : (
          <ul className="divide-y divide-line">
            {comments.map((a, i) => (
              <li key={i} className="px-5 py-3">
                <p className="whitespace-pre-line text-sm text-ink">{a.comment}</p>
                <p className="mt-1 text-xs text-ink-muted">{a.person?.full_name} · {ROLE_LABEL[a.role as Role] ?? a.role} · satisfaction {a.satisfaction}, ease {a.ease}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
