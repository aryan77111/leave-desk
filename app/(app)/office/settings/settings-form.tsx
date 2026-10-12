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
  { key: 'escalate_hours', label: 'Reminder to the Dean after', hint: 'The approver and the Dean HRM Office are emailed.', unit: 'hours' },
  { key: 'doc_days', label: 'Medical certificate deadline', hint: 'Days after resuming classes. Missing it cancels the leave.', unit: 'days' },
  { key: 'max_leave_days', label: 'Longest leave students can apply for here', hint: 'Longer leave is handled by the Dean HRM Office directly.', unit: 'days' },
  { key: 'link_days', label: 'Faculty email links work for', hint: 'After this a link shows nothing about the request. Faculty can always sign in instead.', unit: 'days' },
];

const TARGETS: { key: keyof Settings; label: string; unit: string; step?: number; max: number; min: number }[] = [
  { key: 'target_decision_pct', label: 'Requests decided within the reminder time', unit: '%', min: 0, max: 100 },
  { key: 'target_ack_pct', label: 'Faculty replying within their window', unit: '%', min: 0, max: 100 },
  { key: 'target_cert_pct', label: 'Medical certificates uploaded on time', unit: '%', min: 0, max: 100 },
  { key: 'target_satisfaction', label: 'Average satisfaction in the survey', unit: 'out of 5', step: 0.1, min: 1, max: 5 },
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
                <input id={r.key} name={r.key} type="number" inputMode="numeric" min={r.key === 'link_days' ? 1 : 0} max={r.key === 'link_days' ? 30 : 720} step={1} required defaultValue={settings[r.key] as number} className="field-input w-28 tabular-nums" />
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
          <Field label="Email sender" htmlFor="email_from" hint="The name recipients see, for example Leave Desk – Dean HRM Office <deanhrm_office@xim.edu.in>. With Gmail connected, the address is always the connected account. With Resend, the address must use a domain verified there.">
            <input id="email_from" name="email_from" placeholder="Leave Desk – Dean HRM Office <deanhrm_office@xim.edu.in>" defaultValue={settings.email_from ?? ''} className="field-input" />
          </Field>
          <Field label="College email domains" htmlFor="allowed_domains" hint="For your records. Sign-in is limited by the roster in any case.">
            <input id="allowed_domains" name="allowed_domains" placeholder="xim.edu.in, stu.xim.edu.in" defaultValue={settings.allowed_domains.join(', ')} className="field-input" />
          </Field>
        </div>
      </Card>

      <Card title="Help page contact" description="Shown on the public Help and rules page that every email links to.">
        <div className="grid grid-cols-1 gap-5 px-5 py-5 sm:grid-cols-3">
          <Field label="Name or desk" htmlFor="help_contact_name">
            <input id="help_contact_name" name="help_contact_name" maxLength={120} defaultValue={settings.help_contact_name ?? ''} className="field-input" placeholder="Dean HRM Office" />
          </Field>
          <Field label="Email" htmlFor="help_contact_email">
            <input id="help_contact_email" name="help_contact_email" type="email" maxLength={200} defaultValue={settings.help_contact_email ?? ''} className="field-input" placeholder="hrm.office@college.edu" />
          </Field>
          <Field label="Phone" htmlFor="help_contact_phone">
            <input id="help_contact_phone" name="help_contact_phone" type="tel" maxLength={40} defaultValue={settings.help_contact_phone ?? ''} className="field-input" />
          </Field>
        </div>
      </Card>

      <div id="survey" className="scroll-mt-6">
        <Card title="Pilot targets and survey" description="The targets in the proposal. Pilot results compares the real figures with these.">
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-2">
            {TARGETS.map((t) => (
              <Field key={t.key} label={t.label} htmlFor={t.key}>
                <div className="flex items-center gap-2">
                  <input id={t.key} name={t.key} type="number" inputMode="decimal" min={t.min} max={t.max} step={t.step ?? 1} required defaultValue={settings[t.key] as number} className="field-input w-28 tabular-nums" />
                  <span className="text-sm text-ink-muted">{t.unit}</span>
                </div>
              </Field>
            ))}
          </div>
          <label className="flex items-start gap-3 border-t border-line px-5 py-4 text-sm">
            <input type="checkbox" name="survey_open" defaultChecked={settings.survey_open} className="mt-0.5 h-4 w-4 accent-navy-700" />
            <span>
              <span className="font-semibold text-ink">Survey is open</span><br />
              <span className="text-ink-muted">Everyone who has not answered sees a short banner asking two questions. Open it in the last week of the pilot.</span>
            </span>
          </label>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
