'use client';
import { useActionState } from 'react';
import { Card, Field } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import type { Settings } from '@/lib/types';
import { updateSettings } from '../actions';

const RULES: { key: keyof Settings; label: string; hint: string; unit: string }[] = [
  { key: 'notice_hours', label: 'Notice for family and university leave', hint: 'Students cannot apply later than this before the first day.', unit: 'hours' },
  { key: 'medical_late_hours', label: 'Time to apply for medical leave', hint: 'Counted from the end of the first day of absence.', unit: 'hours' },
  { key: 'medical_ahead_days', label: 'How far ahead medical leave can be applied', hint: 'For a planned procedure or doctor-advised rest.', unit: 'days' },
  { key: 'ack_hours', label: 'Faculty response window', hint: 'No reply after this is recorded as acknowledged.', unit: 'hours' },
  { key: 'escalate_hours', label: 'Reminder to the approver after', hint: 'The approver and the Dean HRM Office are emailed.', unit: 'hours' },
  { key: 'doc_days', label: 'Medical certificate deadline', hint: 'Days after resuming classes. Missing it cancels the leave.', unit: 'days' },
  { key: 'chair_max_days', label: 'Longest leave the Programme Chair decides', hint: 'Longer leave, and all family-reason leave, goes to the Dean.', unit: 'days' },
  { key: 'max_leave_days', label: 'Longest leave students can apply for here', hint: 'Longer leave is handled by the Dean HRM Office directly.', unit: 'days' },
];

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action] = useActionState(updateSettings, null);
  return (
    <form action={action} className="flex max-w-3xl flex-col gap-6">
      <Card title="Leave rules">
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-2">
          {RULES.map((r) => (
            <Field key={r.key} label={r.label} htmlFor={r.key} hint={r.hint}>
              <div className="flex items-center gap-2">
                <input id={r.key} name={r.key} type="number" min={0} max={720} step={1} required defaultValue={settings[r.key] as number} className="field-input w-28 tabular-nums" />
                <span className="text-sm text-ink-muted">{r.unit}</span>
              </div>
            </Field>
          ))}
        </div>
      </Card>

      <Card title="Programme and email">
        <div className="grid grid-cols-1 gap-5 px-5 py-5">
          <Field label="Programme name" htmlFor="programme_name" hint="Shown in the app header and in emails.">
            <input id="programme_name" name="programme_name" required maxLength={60} defaultValue={settings.programme_name} className="field-input max-w-sm" />
          </Field>
          <Field label="App address" htmlFor="app_url" hint="The web address where Leave Desk is deployed. Links in emails point here. Emails are not sent until this is set.">
            <input id="app_url" name="app_url" type="url" placeholder="https://leave-desk.vercel.app" defaultValue={settings.app_url ?? ''} className="field-input" />
          </Field>
          <Field label="Email sender" htmlFor="email_from" hint="Must use a domain verified in Resend, for example Leave Desk <leave@college.edu>.">
            <input id="email_from" name="email_from" placeholder="Leave Desk <leave@college.edu>" defaultValue={settings.email_from ?? ''} className="field-input" />
          </Field>
          <Field label="College email domains" htmlFor="allowed_domains" hint="For your records. Sign-in is limited by the roster in any case.">
            <input id="allowed_domains" name="allowed_domains" placeholder="xim.edu.in, stu.xim.edu.in" defaultValue={settings.allowed_domains.join(', ')} className="field-input" />
          </Field>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
