import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/primitives';
import { fmtStamp } from '@/lib/format';
import { getSettings, requireViewer } from '@/lib/session';
import { EmailAccount } from './email-account';
import { SettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Rules and settings' };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ gmail?: string; reason?: string }> }) {
  await requireViewer('office');
  const { gmail, reason } = await searchParams;
  const s = await getSettings();
  return (
    <>
      <PageHeader
        title="Rules and settings"
        description={`The rules the Dean has set. Changes apply to new requests and to the next run of the reminders. Last changed ${fmtStamp(s.updated_at)}.`}
      />
      <div className="flex flex-col gap-6">
        <EmailAccount settings={s} result={gmail} reason={reason?.slice(0, 160)} />
        <SettingsForm settings={s} />
      </div>
    </>
  );
}
