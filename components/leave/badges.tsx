import { Badge } from '@/components/ui/primitives';
import { ACK_LABEL, ACK_TONE, STATUS_LABEL, STATUS_TONE, STEP_LABEL, STEP_TONE, type MedicalStep } from '@/lib/format';
import type { AckStatus, LeaveStatus } from '@/lib/types';

/** Pass `step` (from medicalStep) where the medical certificate step should show instead of "Awaiting decision". */
export function StatusBadge({ status, step }: { status: LeaveStatus; step?: MedicalStep | null }) {
  if (step) return <Badge tone={STEP_TONE[step]}>{STEP_LABEL[step]}</Badge>;
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function AckBadge({ status }: { status: AckStatus }) {
  return <Badge tone={ACK_TONE[status]}>{ACK_LABEL[status]}</Badge>;
}
