import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/shell/auth-frame';
import { getSignedIn } from '@/lib/session';
import { buttonClass } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Not on the roster' };

export default async function NoAccess() {
  const s = await getSignedIn();
  if (!s) redirect('/login');
  if (s.person) redirect('/');
  return (
    <AuthFrame>
      <div className="rounded-lg border border-line bg-white p-7">
        <h1 className="font-serif text-[1.625rem] font-semibold leading-tight text-navy-900">You are not on the roster yet</h1>
        <p className="mt-2 text-sm text-ink-muted">
          You signed in as <span className="font-semibold text-ink">{s.email}</span>, but this address is not on the programme roster.
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          If you used a personal Google account, sign out and sign in again with your college account. Otherwise, ask the Dean HRM Office to add this address.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button className={buttonClass('secondary')}>
            Sign out and try another account
          </button>
        </form>
      </div>
    </AuthFrame>
  );
}
