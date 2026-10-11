import { Badge } from '@/components/ui/primitives';
import { ACK_LABEL, ACK_TONE, STATUS_LABEL, STATUS_TONE } from '@/lib/format';
import type { AckStatus, LeaveStatus } from '@/lib/types';

export function StatusBadge({ status }: { status: LeaveStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function AckBadge({ status }: { status: AckStatus }) {
  return <Badge tone={ACK_TONE[status]}>{ACK_LABEL[status]}</Badge>;
}
