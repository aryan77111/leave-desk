import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge } from '@/components/leave/badges';
import { Card, EmptyState, LinkButton, PageHeader, TableWrap } from '@/components/ui/primitives';
import { fmtRange, fmtStamp, LEVEL_LABEL, STATUS_LABEL, TYPE_LABEL } from '@/lib/format';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { ApproverLevel, LeaveStatus, LeaveType } from '@/lib/types';

export const metadata: Metadata = { title: 'All leave' };

const PAGE = 50;
type Row = {
  id: string; ref: string; type: LeaveType; status: LeaveStatus; from_date: string; to_date: string; submitted_at: string;
  approver_level: ApproverLevel; doc_deadline: string | null;
  student: { full_name: string; student_no: string | null; batch: string | null; section: string | null } | null;
  leave_sessions: { session_id: string }[];
};

export default async function AllLeave({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; type?: string; from?: string; to?: string; page?: string }>;
}) {
  await requireViewer('office');
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? '').trim().replace(/[%,()*\\]/g, '').slice(0, 60);
  const status = sp.status && sp.status in STATUS_LABEL ? (sp.status as LeaveStatus) : undefined;
  const type = sp.type && sp.type in TYPE_LABEL ? (sp.type as LeaveType) : undefined;
  const isDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

  const supabase = await createClient();
  const inner = q && !/^lv-?\d+$/i.test(q);
  let query = supabase
    .from('leave_requests')
    .select(
      `id, ref, type, status, from_date, to_date, submitted_at, approver_level, doc_deadline,
       student:people!leave_requests_student_id_fkey${inner ? '!inner' : ''}(full_name, student_no, batch, section),
       leave_sessions(session_id)`,
      { count: 'exact' },
    )
    .order('submitted_at', { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (status) query = query.eq('status', status);
  if (type) query = query.eq('type', type);
  if (isDate(sp.from)) query = query.gte('to_date', sp.from!);
  if (isDate(sp.to)) query = query.lte('from_date', sp.to!);
  if (q) {
    if (!inner) query = query.eq('ref', `LV-${q.replace(/^lv-?/i, '')}`);
    else query = query.or(`full_name.ilike.%${q}%,student_no.ilike.%${q}%`, { referencedTable: 'student' });
  }
  const { data, count } = await query;
  const rows = (data ?? []) as unknown as Row[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) => {
    const u = new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `/office/leave?${u.toString()}`;
  };

  return (
    <>
      <PageHeader title="All leave" description="Every request, newest first. Filter by status, type, dates or student." />
      <Card>
        <form className="grid grid-cols-1 gap-3 border-b border-line px-5 py-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]" role="search">
          <label className="flex flex-col gap-1"><span className="label-caps">Student or request</span>
            <input name="q" defaultValue={sp.q} placeholder="Name, student ID or LV-1001" className="field-input" /></label>
          <label className="flex flex-col gap-1"><span className="label-caps">Status</span>
            <select name="status" defaultValue={status ?? ''} className="field-input">
              <option value="">All</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span className="label-caps">Type</span>
            <select name="type" defaultValue={type ?? ''} className="field-input">
              <option value="">All</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span className="label-caps">From</span>
            <input type="date" name="from" defaultValue={sp.from} className="field-input" /></label>
          <label className="flex flex-col gap-1"><span className="label-caps">To</span>
            <input type="date" name="to" defaultValue={sp.to} className="field-input" /></label>
          <div className="flex items-end gap-2">
            <button className="h-9 rounded bg-navy-700 px-3.5 text-sm font-semibold text-white hover:bg-navy-800">Filter</button>
            <Link href="/office/leave" className="h-9 rounded px-2 text-sm font-semibold leading-9 text-navy-700 hover:bg-navy-50">Clear</Link>
          </div>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No requests match these filters" />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Request</th><th>Student</th><th>Leave</th><th>Sessions</th><th>Decided by</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="row-link">
                    <td className="whitespace-nowrap"><Link href={`/office/leave/${r.ref}`} className="font-semibold text-navy-700 hover:underline">{r.ref}</Link><div className="text-xs text-ink-muted">{fmtStamp(r.submitted_at)}</div></td>
                    <td>{r.student?.full_name}<div className="text-xs text-ink-muted">{r.student?.student_no} · {r.student?.batch} {r.student?.section}</div></td>
                    <td className="whitespace-nowrap">{fmtRange(r.from_date, r.to_date)}<div className="text-xs text-ink-muted">{TYPE_LABEL[r.type]}</div></td>
                    <td className="tabular-nums">{r.leave_sessions.length}</td>
                    <td className="whitespace-nowrap">{LEVEL_LABEL[r.approver_level]}</td>
                    <td><StatusBadge status={r.status} />{r.status === 'sanctioned' && r.doc_deadline && <div className="mt-1 text-xs text-ink-muted">Due {fmtStamp(r.doc_deadline)}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-ink-muted">
          <span>{total} request{total === 1 ? '' : 's'}{pages > 1 ? ` · page ${page} of ${pages}` : ''}</span>
          {pages > 1 && (
            <div className="flex gap-2">
              {page > 1 && <LinkButton variant="secondary" href={link(page - 1)}>Previous</LinkButton>}
              {page < pages && <LinkButton variant="secondary" href={link(page + 1)}>Next</LinkButton>}
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
