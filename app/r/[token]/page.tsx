import type { Metadata } from 'next';
import { AuthFrame } from '@/components/shell/auth-frame';
import { Alert } from '@/components/ui/primitives';
import { ACK_LABEL, fmtDay, fmtRange, fmtStamp, fmtTime, localDate, TYPE_LABEL } from '@/lib/format';
import { createAnonClient } from '@/lib/supabase/server';
import type { AckStatus, LeaveStatus, LeaveType } from '@/lib/types';
import { TokenResponse } from './token-response';

export const metadata: Metadata = { title: 'Leave notice', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

type Context = {
  state: 'open' | 'answered' | 'closed' | 'expired' | 'invalid';
  ack_status?: AckStatus;
  responded_at?: string | null;
  faculty_name?: string;
  student_name?: string;
  student_no?: string;
  ref?: string;
  type?: LeaveType;
  leave_status?: LeaveStatus;
  from_date?: string;
  to_date?: string;
  reason?: string | null;
  respond_by?: string;
  sessions?: { course_code: string; course_name: string | null; starts_at: string }[];
};

export default async function TokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAnonClient();
  const { data } = await supabase.rpc('token_context', { p_token: token });
  const c = (data ?? { state: 'invalid' }) as Context;

  if (c.state === 'invalid') {
    return (
      <AuthFrame>
        <Alert tone="bad" title="This link is not valid">
          Check that you opened the whole link from the email. You can also sign in to Leave Desk to see your notices.
        </Alert>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame wide>
      <div className="rounded-md border border-line bg-white shadow-card">
        <div className="border-b border-line px-6 py-5">
          <p className="text-sm text-ink-muted">Leave notice for {c.faculty_name}</p>
          <h1 className="mt-1 text-xl font-semibold text-ink">{c.student_name} <span className="font-normal text-ink-muted">({c.student_no})</span></h1>
          <p className="mt-1 text-sm text-ink-soft">
            {TYPE_LABEL[c.type!]} leave · {fmtRange(c.from_date!, c.to_date!)}
            {c.type === 'medical' && <span className="text-ink-muted"> · for information</span>}
          </p>
        </div>
        <div className="flex flex-col gap-5 px-6 py-5">
          <div>
            <h2 className="label-caps">Your sessions that will be missed</h2>
            <ul className="mt-2 divide-y divide-line rounded border border-line">
              {(c.sessions ?? []).map((s) => (
                <li key={s.starts_at + s.course_code} className="flex flex-wrap gap-x-3 px-3.5 py-2.5 text-sm">
                  <span className="font-semibold text-ink">{s.course_code}</span>
                  {s.course_name && <span className="text-ink-muted">{s.course_name}</span>}
                  <span className="ml-auto tabular-nums text-ink-soft">{fmtDay(localDate(s.starts_at))}, {fmtTime(s.starts_at)}</span>
                </li>
              ))}
            </ul>
          </div>
          {c.reason ? (
            <p className="text-sm text-ink"><span className="text-ink-muted">Reason: </span>{c.reason}</p>
          ) : (
            <p className="text-sm text-ink-muted">The reason and medical certificate are visible to the approver only.</p>
          )}

          {c.state === 'open' && (
            <div className="border-t border-line pt-5">
              <TokenResponse token={token} />
              <p className="mt-4 text-xs text-ink-muted">
                No reply by {fmtStamp(c.respond_by!)} is recorded as acknowledged. Make-up of any evaluation stays at your discretion.
              </p>
            </div>
          )}
          {c.state === 'answered' && (
            <Alert tone="ok" title="Already answered">
              Recorded as “{ACK_LABEL[c.ack_status!]}”{c.responded_at ? ` on ${fmtStamp(c.responded_at)}` : ''}. Nothing more is needed.
            </Alert>
          )}
          {c.state === 'closed' && <Alert tone="quiet" title="This request is closed">The request was withdrawn or decided, so no response is needed.</Alert>}
          {c.state === 'expired' && <Alert tone="warn" title="This link has expired">Sign in to Leave Desk to see current notices.</Alert>}
        </div>
      </div>
    </AuthFrame>
  );
}
