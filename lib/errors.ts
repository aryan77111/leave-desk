type PgError = { message?: string; code?: string } | null | undefined;

// Errors raised by the workflow functions are written for people (codes 22023, 42501,
// P0002, 23P01). Anything else is unexpected and gets a generic message.
const READABLE = new Set(['22023', '42501', 'P0002', '23P01', 'P0001']);

export function readableError(error: PgError, fallback = 'Something went wrong. Try again, and contact the programme office if it keeps happening.') {
  if (!error) return fallback;
  if (error.code && READABLE.has(error.code) && error.message) return error.message;
  if (error.message?.includes('JWT') || error.code === 'PGRST301') return 'Your session has expired. Sign in again.';
  console.error('Unexpected database error', error);
  return fallback;
}
