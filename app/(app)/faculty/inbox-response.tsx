'use client';
import { RespondPanel } from '@/components/leave/respond-panel';
import { respondToLeave } from './actions';

export function InboxResponse({ leaveId }: { leaveId: string }) {
  return <RespondPanel onRespond={(kind, note) => respondToLeave(leaveId, kind, note)} />;
}
