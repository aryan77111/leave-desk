'use client';
import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

let sent = 0;

/** Sends a few uncaught browser errors per page load to the error log. */
export function reportClientError(message: string, digest?: string) {
  if (sent >= 5 || !message) return;
  sent += 1;
  try {
    void createClient().rpc('log_app_error', {
      p_source: 'client', p_message: message.slice(0, 2000), p_path: window.location.pathname, p_digest: digest ?? null,
    });
  } catch {
    // Never let monitoring break the page.
  }
}

export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      // Errors from browser extensions and cross-origin scripts carry no useful detail.
      if (!e.message || e.message === 'Script error.') return;
      reportClientError(`${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string } | string | undefined;
      reportClientError(`Unhandled: ${typeof r === 'string' ? r : r?.message ?? 'unknown'}`);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);
  return null;
}
