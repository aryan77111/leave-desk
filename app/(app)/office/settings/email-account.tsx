import { CheckCircle2, Mail } from 'lucide-react';
import { Alert, Card } from '@/components/ui/primitives';
import { fmtStamp } from '@/lib/format';
import type { Settings } from '@/lib/types';
import { connectGmail, disconnectGmail } from '../actions';

/** Which account Leave Desk sends email from, and the Connect Gmail button. */
export function EmailAccount({ settings, result, reason }: { settings: Settings; result?: string; reason?: string }) {
  const connected = Boolean(settings.gmail_sender);
  return (
    <div id="email" className="max-w-3xl scroll-mt-6">
      {result === 'connected' && <Alert tone="ok" className="mb-4" title="Gmail connected">Emails now go out from {settings.gmail_sender}. Waiting emails are sent within a minute.</Alert>}
      {result === 'disconnected' && <Alert tone="quiet" className="mb-4" title="Gmail disconnected">Emails will use the backup sender (Resend) if it is set up.</Alert>}
      {result === 'error' && <Alert tone="bad" className="mb-4" title="Gmail was not connected">{reason || 'Something went wrong.'} Try again.</Alert>}
      <Card title="Email account" description="The college Google account that Leave Desk sends email from. Mail sent this way comes from the real XIM address and needs no DNS changes.">
        <div className="flex flex-col gap-4 px-5 py-5">
          {connected ? (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok-fg" aria-hidden />
              <div className="text-sm">
                <p className="font-semibold text-ink">Sending from {settings.gmail_sender}</p>
                <p className="text-ink-muted">Connected {settings.gmail_connected_at ? fmtStamp(settings.gmail_connected_at) : ''}. Recipients see the name from “Email sender” below.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
              <p className="text-sm text-ink-soft">
                No Google account connected. Sign in with the account emails should come from — for the pilot, the Dean HRM Office account. Google asks only for permission to send email; Leave Desk cannot read the inbox.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <form action={connectGmail}>
              <button className="inline-flex h-10 items-center justify-center rounded bg-navy-700 px-4 text-sm font-semibold text-white hover:bg-navy-800 sm:h-9">
                {connected ? 'Switch to another account' : 'Connect Gmail'}
              </button>
            </form>
            {connected && (
              <form action={disconnectGmail}>
                <button className="inline-flex h-10 items-center justify-center rounded border border-line-strong bg-white px-4 text-sm font-semibold text-ink hover:bg-canvas sm:h-9">Disconnect</button>
              </form>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            Google may show “Google hasn’t verified this app”. That is expected for the college’s own tool: choose Advanced, then continue. Each person who connects needs to do this once.
          </p>
        </div>
      </Card>
    </div>
  );
}
