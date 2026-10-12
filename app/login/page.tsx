import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/primitives';
import { getSignedIn } from '@/lib/session';
import { GoogleButton } from './google-button';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  auth: 'Sign-in did not complete. Try again.',
  domain: 'Use your college Google account.',
};

// The routing slip, told as the steps a request takes.
const ROUTE = [
  { label: 'You apply', sub: 'Missed classes are filled in from the timetable.' },
  { label: 'Faculty are told', sub: 'By email, with a one-tap reply. No signatures to collect.' },
  { label: 'The office checks the certificate', sub: 'For medical leave only.' },
  { label: 'The Dean decides', sub: 'And you hear by email.' },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const s = await getSignedIn();
  if (s?.person) redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

  return (
    <div className="grid min-h-screen content-start lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:content-stretch">
      <section className="on-navy relative flex flex-col overflow-hidden bg-navy-900 px-6 pb-9 pt-7 text-white sm:px-10 lg:justify-between lg:px-14 lg:py-12">
        <div>
          <div className="font-serif text-[1.3125rem] font-semibold leading-none tracking-[-0.01em]">Leave Desk</div>
          <div className="mt-1.5 text-xs font-semibold text-gold-300">MBA-HRM · XIM University</div>
        </div>

        <div className="mt-8 max-w-md lg:mt-0">
          <h1 className="font-serif text-[2rem] font-semibold leading-[1.1] tracking-[-0.015em] sm:text-[2.75rem]">
            Student leave, without the paper form.
          </h1>
          <ol className="mt-9 hidden flex-col sm:flex" aria-label="How a request moves">
            {ROUTE.map((r, i) => (
              <li key={r.label} className="relative flex gap-4 pb-6 last:pb-0">
                {i < ROUTE.length - 1 && <span aria-hidden className="absolute bottom-0 left-[10px] top-[24px] w-0.5 bg-white/15" />}
                <span aria-hidden className={i === ROUTE.length - 1
                  ? 'relative z-10 mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full ring-2 ring-gold-500'
                  : 'relative z-10 mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full bg-white/10 ring-1 ring-inset ring-white/25'}>
                  {i === ROUTE.length - 1 && <span className="h-2 w-2 rounded-full bg-gold-500" />}
                </span>
                <div>
                  <p className="text-[0.9375rem] font-semibold">{r.label}</p>
                  <p className="mt-0.5 text-sm text-navy-200">{r.sub}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="mt-10 hidden text-xs text-navy-300 lg:block">For students, faculty, the Dean and the Dean HRM Office.</p>
      </section>

      <main className="flex items-start justify-center px-4 py-10 sm:px-8 lg:items-center lg:py-12">
        <div className="w-full max-w-sm">
          <h2 className="font-serif text-[1.75rem] font-semibold leading-tight tracking-[-0.01em] text-navy-900">Sign in</h2>
          <p className="mt-2 text-[0.9375rem] text-ink-muted">Use the Google account the college gave you.</p>
          {error && ERRORS[error] && <Alert tone="bad" className="mt-5">{ERRORS[error]}</Alert>}
          <div className="mt-7">
            <GoogleButton next={next} />
          </div>
          <p className="mt-7 border-t border-line pt-5 text-sm text-ink-muted">
            Only people on the programme roster can sign in. If you cannot get in, ask the Dean HRM Office to add you.
          </p>
          <p className="mt-3 text-sm">
            <Link href="/help" className="font-semibold text-navy-700 underline-offset-4 hover:underline">Help and rules</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
