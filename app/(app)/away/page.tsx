import type { Metadata } from 'next';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { fmtRange, fmtStamp, todayLocal } from '@/lib/format';
import { requireOneOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { DelegationForm, EndButton } from './delegation-form';

export const metadata: Metadata = { title: 'Out of office' };

type Row = {
  id: string; starts_on: string; ends_on: string; reason: string | null; created_at: string; ended_at: string | null;
  delegate: { full_name: string; email: string } | null;
  creator: { full_name: string } | null;
};

export default async function AwayPage() {
  const { person } = await requireOneOf(['approver', 'office']);
  const supabase = await createClient();
  const today = todayLocal();
  const [{ data: rows }, { data: people }] = await Promise.all([
    supabase.from('approval_delegations')
      .select('id, starts_on, ends_on, reason, created_at, ended_at, delegate:people!approval_delegations_delegate_id_fkey(full_name, email), creator:people!approval_delegations_created_by_fkey(full_name)')
      .order('starts_on', { ascending: false }).limit(50),
    supabase.from('people').select('id, full_name, roles, email').eq('active', true).overlaps('roles', ['faculty', 'office']).order('full_name'),
  ]);
  const list = (rows ?? []) as unknown as Row[];
  const current = list.filter((d) => !d.ended_at && d.ends_on >= today);
  const past = list.filter((d) => d.ended_at || d.ends_on < today);
  const choices = ((people ?? []) as { id: string; full_name: string; roles: string[]; email: string }[])
    .filter((p) => !p.roles.includes('approver'))
    .map((p) => ({ id: p.id, label: `${p.full_name}${p.roles.includes('office') && !p.roles.includes('faculty') ? ' (Dean HRM Office)' : ''}` }));
  const isDean = person.roles.includes('approver');

  return (
    <>
      <PageHeader
        title={isDean ? 'Out of office' : "Dean's delegates"}
        description="While the Dean is away, a named colleague decides leave requests so nothing stalls. They get the Dean’s emails and approval queue for those days, and each decision is recorded as “on behalf of the Dean”."
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Name someone">
          <DelegationForm people={choices} today={today} />
        </Card>
        <Card title="Current and upcoming">
          {current.length === 0 ? <EmptyState title="Only the Dean decides at the moment" /> : (
            <ul className="divide-y divide-line">
              {current.map((d) => (
                <li key={d.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{d.delegate?.full_name}</span>
                      {d.starts_on <= today ? <Badge tone="ok">Deciding now</Badge> : <Badge tone="info">Upcoming</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-soft">{fmtRange(d.starts_on, d.ends_on)}</p>
                    {d.reason && <p className="mt-0.5 text-xs text-ink-muted">{d.reason}</p>}
                    <p className="mt-0.5 text-xs text-ink-muted">Set by {d.creator?.full_name} · {fmtStamp(d.created_at)}</p>
                  </div>
                  <EndButton id={d.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {past.length > 0 && (
        <Card className="mt-6" title="Earlier">
          <ul className="divide-y divide-line">
            {past.map((d) => (
              <li key={d.id} className="px-5 py-3 text-sm">
                <span className="font-semibold text-ink">{d.delegate?.full_name}</span>
                <span className="text-ink-soft"> · {fmtRange(d.starts_on, d.ends_on)}</span>
                {d.ended_at && <span className="text-xs text-ink-muted"> · ended early {fmtStamp(d.ended_at)}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
