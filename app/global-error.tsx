'use client';
import { useEffect } from 'react';
import { reportClientError } from '@/components/shell/error-reporter';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!error.digest) reportClientError(error.message);
  }, [error]);
  return (
    <html lang="en-IN">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem 1rem', color: '#18202B', background: '#F5F6F8' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', background: '#fff', border: '1px solid #E1E5EB', borderRadius: 6, padding: 28 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Leave Desk could not load</h1>
          <p style={{ fontSize: 14, color: '#5D6878' }}>The Dean HRM Office has been told automatically. Try again in a moment.</p>
          {error.digest && <p style={{ fontSize: 12, color: '#8A94A3' }}>Reference: {error.digest}</p>}
          <button onClick={reset} style={{ marginTop: 12, background: '#003C6F', color: '#fff', border: 0, borderRadius: 6, padding: '9px 14px', fontWeight: 600 }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
