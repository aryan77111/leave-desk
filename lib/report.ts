// Records unexpected errors in the app_errors table, where the Dean HRM Office sees them on
// System health and gets an email alert (at most one an hour). Never throws.
import { createClient } from '@supabase/supabase-js';

export async function reportServerError(message: string, path?: string | null, digest?: string | null) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return;
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await db.rpc('log_app_error', { p_source: 'server', p_message: message.slice(0, 2000), p_path: path ?? null, p_digest: digest ?? null });
  } catch {
    // Monitoring must never break the page.
  }
}
