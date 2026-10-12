import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { createAnonClient } from '@/lib/supabase/server';
import { getSignedIn } from '@/lib/session';
import { STATUS_LABEL } from '@/lib/format';

export const metadata: Metadata = { title: 'Help and rules' };
export const dynamic = 'force-dynamic';

type Help = {
  programme_name: string; notice_hours: number; medical_late_hours: number; medical_ahead_days: number; ack_hours: number;
  escalate_hours: number; doc_days: number; max_leave_days: number; link_days: number;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
};

const DEFAULTS: Help = {
  programme_name: 'MBA-HRM', notice_hours: 48, medical_late_hours: 24, medical_ahead_days: 7, ack_hours: 48,
  escalate_hours: 48, doc_days: 2, max_leave_days: 15, link_days: 7, contact_name: null, contact_email: null, contact_phone: null,
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 rounded-md border border-line bg-white shadow-card">
      <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold text-ink">{title}</h2>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function QA({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="border-b border-dashed border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <h3 className="text-sm font-semibold text-ink">{q}</h3>
      <div className="mt-1 text-sm leading-relaxed text-ink-soft">{children}</div>
    </div>
  );
}

// In the order a request moves through them. Medical requests start with the certificate steps.
const STATUS_HELP: [string, string][] = [
  ['Certificate needed', 'Medical leave only: no certificate is attached yet, or the Dean HRM Office returned it. Upload one by the date shown, or the request is cancelled.'],
  ['Certificate check', 'Medical leave only: the Dean HRM Office is checking the certificate. The request goes to the Dean after that.'],
  [STATUS_LABEL.submitted, 'With the Dean. Faculty are told as soon as the request is made.'],
  [STATUS_LABEL.approved, 'Final. The sessions count as approved leave in attendance.'],
  [STATUS_LABEL.rejected, 'Not approved. The reason is on the request.'],
  [STATUS_LABEL.cancelled, 'Cancelled: no certificate by the deadline, or cancelled by the Dean HRM Office with a reason.'],
  [STATUS_LABEL.withdrawn, 'Withdrawn by the student before a decision.'],
];

export default async function HelpPage() {
  const supabase = createAnonClient();
  const [{ data }, signedIn] = await Promise.all([supabase.rpc('public_help'), getSignedIn().catch(() => null)]);
  const h = { ...DEFAULTS, ...((data as Help | null) ?? {}) };
  const hours = (n: number) => `${n} hour${n === 1 ? '' : 's'}`;
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  const contact = h.contact_name || h.contact_email || h.contact_phone;

  return (
    <div className="min-h-screen">
      <header className="bg-navy-800">
        <div className="mx-auto flex max-w-3xl flex-wrap items-baseline justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-baseline gap-3">
            <span className="text-[17px] font-bold tracking-tight text-white">Leave Desk</span>
            <span className="text-2xs font-semibold uppercase text-gold-500">{h.programme_name}</span>
          </div>
          <Link href={signedIn ? '/' : '/login'} className="text-sm font-semibold text-gold-300 hover:text-gold-100">
            {signedIn ? 'Back to Leave Desk' : 'Sign in'}
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Help and rules</h1>
          <p className="mt-1 text-sm text-ink-muted">How leave works on Leave Desk, in plain words. The numbers below are the rules the Dean has set today.</p>
          <nav aria-label="On this page" className="mt-4 flex flex-wrap gap-2 text-sm">
            {[['students', 'Students'], ['faculty', 'Faculty'], ['dean', 'The Dean'], ['statuses', 'What the statuses mean'], ['contact', 'Contact']].map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-full border border-line-strong bg-white px-3 py-1.5 font-semibold text-navy-700 hover:border-navy-300">{label}</a>
            ))}
          </nav>
        </div>

        <Section id="students" title="For students">
          <QA q="When do I have to apply?">
            Family and university leave: at least <strong>{hours(h.notice_hours)}</strong> before the first day.
            Medical leave: no later than <strong>{hours(h.medical_late_hours)}</strong> after the end of your first day of absence, or up to {days(h.medical_ahead_days)} ahead for a planned procedure.
          </QA>
          <QA q="How long can the leave be?">
            Up to {days(h.max_leave_days)} in one request. For longer leave, speak to the Dean HRM Office.
          </QA>
          <QA q="Do I need my faculty’s signatures?">
            No. Your missed sessions are filled in from the timetable and each faculty member is emailed. Untick a session only if you will attend it.
          </QA>
          <QA q="Who decides?">
            The Dean decides every request. Medical requests reach the Dean once the Dean HRM Office has checked the certificate. If the Dean is away, a colleague the Dean has named may decide on the Dean’s behalf; the request says so.
          </QA>
          <QA q="Can I change or withdraw a request?">
            Yes, until it is decided. Open the request and choose <em>Change request</em> or <em>Withdraw</em>. Faculty whose sessions change are told automatically. After a decision, contact the Dean HRM Office.
          </QA>
          <QA q="What about the medical certificate?">
            Attach it when you apply: tap <em>Take a photo</em> to use your phone’s camera (or your laptop’s webcam), or <em>Choose a file</em> for a PDF, JPG or PNG up to 5 MB. Large photos are shrunk automatically. The Dean HRM Office checks it first, and then the request goes to the Dean, whose approval is final.
            If the office returns it, you are emailed the reason and get at least two days to upload a new one. A request with no certificate is cancelled at the deadline shown on it, and the absence counts as unapproved.
            Only the Dean HRM Office and the Dean can see the certificate and the medical reason; faculty never can.
          </QA>
          <QA q="I was in hospital and could not apply. What now?">
            Contact the Dean HRM Office as soon as you can. The office can file the request for you, even after the dates, and the Dean decides as usual.
          </QA>
        </Section>

        <Section id="faculty" title="For faculty">
          <QA q="Why am I getting these emails?">
            A student will miss one or more of your sessions and has applied for leave. The email lists the sessions. You do not need to sign anything.
            To keep email down, notices arrive together in <strong>one summary each morning at 08:00</strong>. A notice about a class in the next 24 hours is sent straight away.
          </QA>
          <QA q="What should I do?">
            One tap is enough: <strong>Acknowledge</strong>. You can also <strong>add a note</strong> for the student (emailed to them, for example about a quiz), or
            <strong> raise a concern</strong>, which only the Dean and the Dean HRM Office see.
          </QA>
          <QA q="What if I do not reply?">
            After <strong>{hours(h.ack_hours)}</strong> from when the notice reached you, your reply is recorded as “deemed acknowledged”. Your silence does not approve anything: the Dean still decides every request.
            Make-up of any evaluation stays at your discretion.
          </QA>
          <QA q="The link in the email does not work">
            Each link works once and expires after {days(h.link_days)}, and it stops showing details once the request is closed. Sign in to Leave Desk with your college Google account to see all your notices.
          </QA>
          <QA q="Why can I not see the reason for medical leave?">
            Medical details are private. The Dean and the Dean HRM Office see them; faculty see only that it is medical leave.
          </QA>
          <QA q="I got an “Updated leave notice”">
            The student changed the request, or the timetable moved, and your sessions in it changed. Please respond again; the response window starts again from the new email.
          </QA>
        </Section>

        <Section id="dean" title="For the Dean">
          <QA q="Emails">
            New requests arrive in <strong>one summary each morning at 08:00</strong>, with anything still waiting from earlier. Medical requests arrive once the Dean HRM Office has checked the certificate; you can open the certificate from the request. Leave starting today or tomorrow, and concerns raised by faculty, are sent straight away. The approval queue is always up to date.
          </QA>
          <QA q="Reminders">
            If a request has no decision {hours(h.escalate_hours)} after reaching you, it is marked overdue in the next morning summary for the Dean and the Dean HRM Office.
          </QA>
          <QA q="Deciding several at once">
            In the approval queue, tick requests and approve them together. Requests where a faculty member raised a concern cannot be ticked; open them first. Rejections are always one at a time, with a reason.
          </QA>
          <QA q="Going away">
            Under <em>Out of office</em>, name a faculty member or Dean HRM Office colleague and the dates. They get the Dean’s emails and approval queue for those days, and each decision is recorded as made on the Dean’s behalf. You can end it early at any time.
          </QA>
        </Section>

        <Section id="statuses" title="What the statuses mean">
          <dl className="flex flex-col divide-y divide-dashed divide-line">
            {STATUS_HELP.map(([label, text]) => (
              <div key={label} className="grid grid-cols-1 gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                <dt className="text-sm font-semibold text-ink">{label}</dt>
                <dd className="text-sm text-ink-soft">{text}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="contact" title="Contact">
          {contact ? (
            <div className="text-sm text-ink-soft">
              <p>For anything Leave Desk cannot do, or if something looks wrong, contact the Dean HRM Office:</p>
              <ul className="mt-2 flex flex-col gap-1 text-ink">
                {h.contact_name && <li className="font-semibold">{h.contact_name}</li>}
                {h.contact_email && <li><a href={`mailto:${h.contact_email}`} className="text-navy-700 underline underline-offset-2">{h.contact_email}</a></li>}
                {h.contact_phone && <li><a href={`tel:${h.contact_phone.replace(/[^\d+]/g, '')}`} className="text-navy-700 underline underline-offset-2">{h.contact_phone}</a></li>}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">Contact the Dean HRM Office for anything Leave Desk cannot do, or if something looks wrong.</p>
          )}
          {signedIn?.person && <p className="mt-3 text-sm text-ink-soft">You can also use “Report a problem” at the bottom of any page in Leave Desk.</p>}
        </Section>
      </main>
    </div>
  );
}
