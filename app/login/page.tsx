import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/shell/auth-frame';
import { Alert } from '@/components/ui/primitives';
import { getSignedIn } from '@/lib/session';
import { GoogleButton } from './google-button';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  auth: 'Sign-in did not complete. Try again.',
  domain: 'Use your college Google account.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const s = await getSignedIn();
  if (s?.person) redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

  return (
    <AuthFrame>
      <div className="rounded-md border border-line bg-white p-7 shadow-card">
        <h1 className="text-xl font-semibold text-ink">Sign in</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Apply for leave, respond to leave notices and approve requests. Use the Google account the college gave you.
        </p>
        {error && ERRORS[error] && <Alert tone="bad" className="mt-5">{ERRORS[error]}</Alert>}
        <div className="mt-6">
          <GoogleButton next={next} />
        </div>
        <p className="mt-6 border-t border-line pt-4 text-xs text-ink-muted">
          Only people on the programme roster can use Leave Desk. If you are a student or faculty member and cannot get in, ask the programme office to add you.
        </p>
      </div>
    </AuthFrame>
  );
}
