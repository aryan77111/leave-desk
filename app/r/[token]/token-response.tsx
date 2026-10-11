'use client';
import { RespondPanel } from '@/components/leave/respond-panel';
import { respondByToken } from './actions';

export function TokenResponse({ token }: { token: string }) {
  return <RespondPanel onRespond={(kind, note) => respondByToken(token, kind, note)} />;
}
