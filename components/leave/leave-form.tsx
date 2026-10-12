'use client';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { FileUp } from 'lucide-react';
import { Card, Field } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { createClient } from '@/lib/supabase/client';
import { addDays, dayStart, daysInclusive, fmtDay, fmtRange, fmtTime, LEVEL_LABEL, localDate, plural, routeLevel, todayLocal, TYPE_LABEL } from '@/lib/format';
import { timingProblems, type Rules } from '@/lib/rules';
import type { ActionResult, LeaveType } from '@/lib/types';

type SessionRow = { id: string; course_code: string; course_name: string | null; starts_at: string; faculty: { full_name: string } | null };

/**
 * apply  — a student applies (timing rules apply)
 * edit   — a student changes a request that is waiting for a decision
 * office — the Dean HRM Office files a request for a student (no timing rules; reason for filing required)
 * amend  — the Dean HRM Office corrects the dates and sessions of a request (reason required)
 */
export type LeaveFormMode = 'apply' | 'edit' | 'office' | 'amend';

export type LeaveFormInitial = {
  type: LeaveType;
  reason: string;
  from: string;
  to: string;
  sessionIds: string[];
  away: boolean;
  returnDate: string | null;
  contactName: string | null;
  contactPhone: string | null;
};

const TYPES: { value: LeaveType; hint: string }[] = [
  { value: 'medical', hint: 'Illness or injury. Attach the certificate.' },
  { value: 'family', hint: 'Family events or emergencies.' },
  { value: 'official', hint: 'Competitions, conferences, university work.' },
];

const OFFICE_MAX_DAYS = 120;
const CERT_MAX_BYTES = 5 * 1024 * 1024;
const CERT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function LeaveForm({ mode = 'apply', batch, section, rules, action, initial, hidden, studentName, userId }: {
  mode?: LeaveFormMode;
  batch: string;
  section: string;
  rules: Rules;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  initial?: LeaveFormInitial;
  hidden?: Record<string, string>;
  studentName?: string;
  /** The student's sign-in id: their certificate is uploaded into their own folder. Needed in apply mode. */
  userId?: string;
}) {
  const today = todayLocal();
  const isOffice = mode === 'office' || mode === 'amend';
  const fixedType = mode === 'edit' || mode === 'amend';
  const [type, setType] = useState<LeaveType>(initial?.type ?? 'medical');
  const [from, setFrom] = useState(initial?.from ?? today);
  const [to, setTo] = useState(initial?.to ?? today);
  const [away, setAway] = useState(initial?.away ?? false);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certError, setCertError] = useState<string | null>(null);
  const certInput = useRef<HTMLInputElement>(null);
  // If the request is refused (say, a date problem) the same file is not uploaded twice.
  const uploaded = useRef<{ file: File; path: string } | null>(null);
  const needsCert = mode === 'apply' && type === 'medical';

  function pickCert(f: File | null) {
    setCertError(null);
    if (!f) { setCertFile(null); return; }
    if (!CERT_TYPES.includes(f.type)) { setCertError('Upload a PDF, JPG or PNG file.'); setCertFile(null); return; }
    if (f.size > CERT_MAX_BYTES) { setCertError('The file is larger than 5 MB. Scan at a lower resolution or upload a PDF.'); setCertFile(null); return; }
    setCertFile(f);
  }

  // A medical certificate goes to storage first, straight from the browser; the request then
  // carries its path. Other requests go to the server action as they are.
  async function submit(prev: ActionResult | null, form: FormData): Promise<ActionResult> {
    form.delete('certificate');
    if (needsCert) {
      if (!certFile) return { error: 'Attach your medical certificate. The Dean HRM Office checks it before the request goes to the Dean.' };
      let path = uploaded.current?.file === certFile ? uploaded.current.path : null;
      if (!path) {
        if (!userId) return { error: 'Sign in again and retry.' };
        const safe = certFile.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(-60) || 'certificate';
        path = `${userId}/apply-${crypto.randomUUID()}/${safe}`;
        const { error } = await createClient().storage.from('certificates').upload(path, certFile, { contentType: certFile.type, upsert: false });
        if (error) return { error: 'The certificate did not upload. Check your connection and try again.' };
        uploaded.current = { file: certFile, path };
      }
      form.set('doc_path', path);
    }
    return action(prev, form);
  }
  const [state, formAction] = useActionState(submit, null);

  const initialIds = useMemo(() => new Set(initial?.sessionIds ?? []), [initial]);

  useEffect(() => {
    if (!from || !to || to < from || daysInclusive(from, to) > OFFICE_MAX_DAYS) { setSessions([]); return; }
    let cancelled = false;
    setSessions(null);
    setLoadError(null);
    const supabase = createClient();
    supabase
      .from('class_sessions')
      .select('id, course_code, course_name, starts_at, faculty:people(full_name)')
      .eq('batch', batch)
      .eq('section', section)
      .eq('cancelled', false)
      .gte('starts_at', dayStart(from).toISOString())
      .lt('starts_at', dayStart(addDays(to, 1)).toISOString())
      .order('starts_at')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setLoadError('Could not load the timetable. Check your connection and try again.'); setSessions([]); return; }
        setSessions(((data ?? []) as unknown as SessionRow[]).filter((s) => localDate(s.starts_at) >= from && localDate(s.starts_at) <= to));
      });
    return () => { cancelled = true; };
  }, [from, to, batch, section]);

  // When changing a request, sessions already on it stay ticked, sessions the student had unticked stay
  // unticked, and sessions on newly added days start ticked. A new request starts with everything ticked.
  const defaultOn = (s: SessionRow) => {
    if (!initial || mode === 'office' || mode === 'apply') return true;
    const d = localDate(s.starts_at);
    return initialIds.has(s.id) || d < initial.from || d > initial.to;
  };
  const isOn = (s: SessionRow) => overrides.get(s.id) ?? defaultOn(s);
  const toggle = (s: SessionRow) => setOverrides((prev) => new Map(prev).set(s.id, !isOn(s)));

  const problems = useMemo(() => {
    if (isOffice) {
      if (from && to && to < from) return ['The last day is before the first day.'];
      if (from && to && daysInclusive(from, to) > OFFICE_MAX_DAYS) return [`Leave can cover at most ${OFFICE_MAX_DAYS} days.`];
      return [];
    }
    // When a student changes a request, the timing rules apply again only if the first day moves.
    const timing = mode === 'apply' || from !== initial?.from;
    const all = timingProblems(type, from, to, rules);
    return timing ? all : all.filter((p) => !/notice|within|ahead/.test(p));
  }, [isOffice, mode, type, from, to, rules, initial]);

  const level = from && to && to >= from ? routeLevel() : null;
  const chosen = (sessions ?? []).filter(isOn);
  const faculty = [...new Set(chosen.map((s) => s.faculty?.full_name).filter(Boolean))];
  const pastDays = isOffice && to && to < today;

  const byDay = useMemo(() => {
    const m = new Map<string, SessionRow[]>();
    for (const s of sessions ?? []) {
      const d = localDate(s.starts_at);
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return [...m.entries()];
  }, [sessions]);

  const submitLabel = { apply: 'Submit request', edit: 'Save changes', office: 'File request', amend: 'Save correction' }[mode];
  const pendingLabel = { apply: 'Submitting…', edit: 'Saving…', office: 'Filing…', amend: 'Saving…' }[mode];
  const who = mode === 'office' || mode === 'amend' ? 'the student' : 'you';

  return (
    <form action={formAction} className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="flex min-w-0 flex-col gap-6">
        <Card title={mode === 'amend' ? 'Dates' : 'Purpose and dates'}>
          <div className="flex flex-col gap-5 px-5 py-5">
            {fixedType ? (
              <p className="text-sm text-ink-soft">
                <span className="label-caps mr-2">Purpose</span>{TYPE_LABEL[type]}
                {mode === 'edit' && <span className="text-ink-muted"> · to change the purpose, withdraw this request and apply again</span>}
              </p>
            ) : (
              <fieldset>
                <legend className="text-sm font-semibold text-ink-soft">Purpose of leave</legend>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {TYPES.map((t) => (
                    <label
                      key={t.value}
                      className={clsx(
                        'flex cursor-pointer flex-col rounded border px-3.5 py-3 transition-colors',
                        type === t.value ? 'border-navy-700 bg-navy-50 ring-1 ring-navy-700' : 'border-line-strong bg-white hover:border-ink-faint',
                      )}
                    >
                      <input type="radio" name="type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} className="sr-only" />
                      <span className="text-sm font-semibold text-ink">{TYPE_LABEL[t.value]}</span>
                      <span className="mt-0.5 text-xs text-ink-muted">{t.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="First day" htmlFor="from">
                <input id="from" name="from" type="date" required className="field-input" value={from}
                  onChange={(e) => { setFrom(e.target.value); if (!to || e.target.value > to) setTo(e.target.value); }} />
              </Field>
              <Field label="Last day" htmlFor="to">
                <input id="to" name="to" type="date" required min={from} className="field-input" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            {mode === 'amend' && initial && (
              <p className="text-xs text-ink-muted">Currently {fmtRange(initial.from, initial.to)}.</p>
            )}

            {problems.length > 0 && (
              <div className="rounded border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn-fg">
                {problems.map((p) => <p key={p}>{p}</p>)}
              </div>
            )}
            {pastDays && (
              <p className="rounded border border-info-line bg-info-bg px-4 py-3 text-sm text-info-fg">
                These dates are in the past. Faculty are told the leave was recorded after the dates.
              </p>
            )}

            {mode !== 'amend' && (
              <Field
                label="Reason"
                htmlFor="reason"
                hint={type === 'medical'
                  ? 'Faculty see only that this is medical leave. The reason is visible to the Dean and the Dean HRM Office.'
                  : 'Faculty see this reason in their notice.'}
              >
                <textarea id="reason" name="reason" required minLength={3} maxLength={1000} rows={3} className="field-input" defaultValue={initial?.reason}
                  placeholder={type === 'medical' ? 'For example: viral fever, advised rest by the campus clinic' : type === 'family' ? "For example: sister's wedding in Kochi" : 'For example: national HR case competition final, Mumbai'} />
              </Field>
            )}
          </div>
        </Card>

        {needsCert && (
          <Card title="Medical certificate" description="Checked by the Dean HRM Office before the request goes to the Dean. Seen only by them and the Dean; faculty never see it.">
            <div className="flex flex-col gap-3 px-5 py-4">
              <button
                type="button"
                onClick={() => certInput.current?.click()}
                className={clsx(
                  'flex flex-col items-center gap-2 rounded border border-dashed px-4 py-6 text-center',
                  certFile ? 'border-navy-700 bg-navy-50' : 'border-bronze-600/60 bg-gold-100/50 hover:bg-gold-100',
                )}
              >
                <FileUp className="h-5 w-5 text-bronze-600" />
                <span className="max-w-full truncate text-sm font-semibold text-ink">{certFile ? certFile.name : 'Choose the certificate'}</span>
                <span className="text-xs text-ink-muted">{certFile ? 'Tap to choose a different file' : 'PDF, JPG or PNG, up to 5 MB. A clear phone photo is fine.'}</span>
              </button>
              <input ref={certInput} type="file" name="certificate" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only"
                onChange={(e) => pickCert(e.target.files?.[0] ?? null)} aria-label="Medical certificate file" />
              {certError && <p role="alert" className="text-sm text-bad-fg">{certError}</p>}
            </div>
          </Card>
        )}

        <Card
          title={isOffice ? 'Sessions missed' : 'Sessions you will miss'}
          description={`Filled in from the timetable${studentName ? ` for ${studentName}` : ''} (${batch}, section ${section}). Untick a session only if ${who === 'you' ? 'you' : 'the student'} attended or will attend it.`}
        >
          <div className="px-5 py-4">
            {loadError && <p className="text-sm text-bad-fg">{loadError}</p>}
            {sessions === null && <p className="text-sm text-ink-muted">Loading the timetable…</p>}
            {sessions && sessions.length === 0 && !loadError && (
              <p className="text-sm text-ink-muted">No classes fall on these dates. {mode === 'apply' ? 'You can still apply.' : ''}</p>
            )}
            {byDay.length > 0 && (
              <div className="flex flex-col gap-4">
                {byDay.map(([day, list]) => (
                  <div key={day}>
                    <div className="label-caps mb-1.5">{fmtDay(day)}</div>
                    <ul className="divide-y divide-line rounded border border-line">
                      {list.map((s) => {
                        const on = isOn(s);
                        return (
                          <li key={s.id}>
                            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3.5 py-2.5 text-sm hover:bg-canvas">
                              <input type="checkbox" name="session" value={s.id} checked={on} className="h-4 w-4 shrink-0 accent-navy-700" onChange={() => toggle(s)} />
                              <span className="w-12 shrink-0 tabular-nums text-ink-muted">{fmtTime(s.starts_at)}</span>
                              <span className="min-w-0 flex-1">
                                <span className="font-semibold text-ink">{s.course_code}</span>
                                {s.course_name && <span className="text-ink-muted"> · {s.course_name}</span>}
                                {s.faculty?.full_name && <span className="block truncate text-xs text-ink-muted sm:hidden">{s.faculty.full_name}</span>}
                              </span>
                              <span className="hidden truncate text-ink-muted sm:block">{s.faculty?.full_name}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {mode !== 'amend' && (
          <Card title={who === 'you' ? 'Where you will be' : 'Where the student will be'}>
            <div className="flex flex-col gap-4 px-5 py-5">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="away" checked={away} onChange={(e) => setAway(e.target.checked)} className="mt-0.5 h-4 w-4 accent-navy-700" />
                <span>
                  <span className="font-semibold text-ink">{who === 'you' ? 'I will be away from campus' : 'The student is away from campus'}</span><br />
                  <span className="text-ink-muted">Add the return date and a contact person.</span>
                </span>
              </label>
              {away && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Return to campus" htmlFor="return_date">
                    <input id="return_date" name="return_date" type="date" required min={to ? addDays(to, 1) : undefined} defaultValue={initial?.returnDate ?? ''} className="field-input" />
                  </Field>
                  <Field label="Contact person" htmlFor="contact_name">
                    <input id="contact_name" name="contact_name" required maxLength={120} defaultValue={initial?.contactName ?? ''} className="field-input" placeholder="Name and relation" />
                  </Field>
                  <Field label="Contact phone" htmlFor="contact_phone">
                    <input id="contact_phone" name="contact_phone" type="tel" inputMode="tel" required maxLength={20} pattern="[0-9+ \-]{7,20}" defaultValue={initial?.contactPhone ?? ''} className="field-input" placeholder="10-digit mobile" />
                  </Field>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-6">
        <Card title={mode === 'apply' ? 'Before you submit' : mode === 'edit' ? 'Before you save' : 'Summary'}>
          <dl className="flex flex-col gap-3 px-5 py-4 text-sm">
            {studentName && <div><dt className="label-caps">Student</dt><dd className="mt-0.5 text-ink">{studentName}</dd></div>}
            <div><dt className="label-caps">Decided by</dt><dd className="mt-0.5 text-ink">{level ? LEVEL_LABEL[level] : '—'}</dd></div>
            <div><dt className="label-caps">Sessions</dt><dd className="mt-0.5 text-ink">{sessions ? plural(chosen.length, 'session') : '—'}</dd></div>
            <div><dt className="label-caps">Faculty {mode === 'apply' || mode === 'office' ? 'notified' : 'on the request'}</dt><dd className="mt-0.5 text-ink">{faculty.length ? faculty.join(', ') : 'None'}</dd></div>
            {mode !== 'amend' && (
              <div><dt className="label-caps">{type === 'medical' && !isOffice ? 'Who checks' : 'Documents'}</dt><dd className="mt-0.5 text-ink">{
                type !== 'medical' ? 'None needed'
                  : isOffice ? 'None needed when the office files it. It goes straight to the Dean.'
                  : mode === 'edit' ? 'The Dean HRM Office, then the Dean. If you change the dates after the check, the office checks again.'
                  : certFile ? 'The Dean HRM Office checks your certificate, then the Dean decides.' : 'Attach the certificate above. The Dean HRM Office checks it, then the Dean decides.'
              }</dd></div>
            )}
            {(mode === 'edit' || mode === 'amend') && (
              <p className="text-xs text-ink-muted">Faculty whose sessions change are emailed again. Faculty no longer affected are told no response is needed.</p>
            )}
          </dl>
          <div className="flex flex-col gap-4 border-t border-line px-5 py-4">
            {isOffice && (
              <Field label={mode === 'office' ? 'Why the office is filing this' : 'Why it is being corrected'} htmlFor="office_note"
                hint={mode === 'office' ? 'Kept on the request for the Dean and the office. The student does not see it.' : 'Shown on the history and emailed to the student.'}>
                <textarea id="office_note" name="office_note" required minLength={3} maxLength={1000} rows={3} className="field-input"
                  placeholder={mode === 'office' ? 'For example: student in hospital, father called on Monday' : 'For example: discharged a day later than planned'} />
              </Field>
            )}
            {mode === 'apply' && type === 'medical' && (
              <label className="flex items-start gap-3 text-xs text-ink-soft">
                <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 shrink-0 accent-navy-700" />
                <span>I agree that my medical certificate will be stored securely, seen only by the Dean HRM Office and the Dean, and deleted at the end of the academic year.</span>
              </label>
            )}
            <FormMessage state={state} />
            <SubmitButton pendingText={needsCert ? 'Uploading and submitting…' : pendingLabel} disabled={problems.length > 0 || sessions === null || (needsCert && !certFile)} className="h-11 w-full lg:h-9">{submitLabel}</SubmitButton>
            {needsCert && !certFile && <p className="text-center text-xs text-ink-muted">Attach the medical certificate to submit.</p>}
          </div>
        </Card>
      </div>
    </form>
  );
}
