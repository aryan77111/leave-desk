import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/primitives';
import { fmtStamp } from '@/lib/format';
import { getSettings, requireViewer } from '@/lib/session';
import { SettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Rules and settings' };

export default async function SettingsPage() {
  await requireViewer('office');
  const s = await getSettings();
  return (
    <>
      <PageHeader
        title="Rules and settings"
        description={`The rules the Dean has set. Changes apply to new requests and to the next run of the reminders. Last changed ${fmtStamp(s.updated_at)}.`}
      />
      <SettingsForm settings={s} />
    </>
  );
}
