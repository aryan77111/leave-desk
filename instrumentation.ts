// Unexpected errors while rendering pages or running server actions are recorded for
// System health (Dean HRM Office) as well as the hosting logs.
export async function register() {}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const e = err as { message?: string; digest?: string };
  // Redirects and "not found" are normal control flow, not errors.
  if (e?.digest?.startsWith('NEXT_REDIRECT') || e?.digest?.startsWith('NEXT_HTTP_ERROR_FALLBACK') || e?.digest === 'NEXT_NOT_FOUND') return;
  const { reportServerError } = await import('./lib/report');
  await reportServerError(`${context.routeType}: ${e?.message ?? String(err)}`, request.path, e?.digest);
}
