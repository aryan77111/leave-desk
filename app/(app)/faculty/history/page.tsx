import type { Metadata } from 'next';
import { AckBadge, StatusBadge } from '@/components/leave/badges';
import { Card, EmptyState, PageHeader, TableWrap } from '@/components/ui/primitives';
import { fmtRange, fmtStamp, TYPE_LABEL } from '@/lib/format';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { InboxItem } from '@/lib/types';

export const metadata: Metadata = { title: 'My responses' };

export default async function FacultyHistory() {
  await requireViewer('faculty');
  const supabase = await createClient();
  const { data } = await supabase.rpc('faculty_inbox', { p_include_answered: true });
  const items = ((data ?? []) as InboxItem[]).sort((a, b) => (b.responded_at ?? '').localeCompare(a.responded_at ?? ''));

  return (
    <>
      <PageHeader title="My responses" description="Leave notices you have answered, newest first. Notices with no reply in time show as deemed acknowledged." />
      <Card>
        {items.length === 0 ? (
          <EmptyState title="No responses yet" />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Student</th><th>Leave</th><th>Your response</th><th>Status now</th></tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.leave_id}>
                    <td>{it.student_name}<div className="text-xs text-ink-muted">{it.student_no} · {it.ref}</div></td>
                    <td className="whitespace-nowrap">{fmtRange(it.from_date, it.to_date)}<div className="text-xs text-ink-muted">{TYPE_LABEL[it.type]}</div></td>
                    <td>
                      <AckBadge status={it.ack_status} />
                      {it.responded_at && <div className="mt-1 text-xs text-ink-muted">{fmtStamp(it.responded_at)}</div>}
                      {it.note && <div className="mt-1 max-w-xs text-xs text-ink-soft">{it.note}</div>}
                    </td>
                    <td><StatusBadge status={it.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
