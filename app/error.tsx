'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { reportClientError } from '@/components/shell/error-reporter';
import { Button } from '@/components/ui/primitives';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server errors are already logged with this digest; only browser errors need sending.
    if (!error.digest) reportClientError(error.message);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-md border border-line bg-white p-7 shadow-card">
        <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm text-ink-muted">
          The page could not load. The Dean HRM Office has been told automatically. Try again, and if it keeps happening, use “Report a problem” at the bottom of any page.
        </p>
        {error.digest && <p className="mt-3 text-xs text-ink-faint">Reference: {error.digest}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={reset}>Try again</Button>
          <Link href="/" className="inline-flex h-9 items-center rounded px-3.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">Go to my home page</Link>
        </div>
      </div>
    </div>
  );
}
