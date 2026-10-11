'use client';
import { useActionState, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Card, Field } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { createClient } from '@/lib/supabase/client';
import { addDays, dayStart, fmtDay, fmtTime, LEVEL_LABEL, localDate, plural, routeLevel, todayLocal, TYPE_LABEL } from '@/lib/format';
import { timingProblems, type Rules } from '@/lib/rules';
import type { LeaveType } from '@/lib/types';
import { submitLeave } from '../actions';

type SessionRow = { id: string; course_code: string; course_name: string | null; starts_at: string; faculty: { full_name: string } | null };

const TYPES: { value: LeaveType; hint: string }[] = [
  { value: 'medical', hint: 'Illness or injury. Certificate needed.' },
  { value: 'family', hint: 'Family events or emergencies.' },
  { value: 'official', hint: 'Competitions, conferences, university work.' },
];

export function NewLeaveForm({ batch, section, rules }: { batch: string; section: string; rules: Rules }) {
  const today = todayLocal();
  const [type, setType] = useState<LeaveType>('medical');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [away, setAway] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [state, formAction] = useActionState(submitLeave, null);

  useEffect(() => {
    if (!from || !to || to < from) { setSessions([]); return; }
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
        if (error) { setLoadError('Could not load your timetable. Check your connection and try again.'); setSessions([]); return; }
        setSessions(((data ?? []) as unknown as SessionRow[]).filter((s) => localDate(s.starts_at) >= from && localDate(s.starts_at) <= to));
        setSkipped(new Set());
      });
    return () => { cancelled = true; };
  }, [from, to, batch, section]);

  const problems = useMemo(() => timingProblems(type, from, to, rules), [type, from, to, rules]);
  const level = from && to && to >= from ? routeLevel() : null;
  const chosen = (sessions ?? []).filter((s) => !skipped.has(s.id));
  const faculty = [...new Set(chosen.map((s) => s.faculty?.full_name).filter(Boolean))];

  const byDay = useMemo(() => {
    const m = new Map<string, SessionRow[]>();
    for (const s of sessions ?? []) {
      const d = localDate(s.starts_at);
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return [...m.entries()];
  }, [sessions]);

  return (
    <form action={formAction} className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card title="Purpose and dates">
          <div className="flex flex-col gap-5 px-5 py-5">
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="First day" htmlFor="from">
                <input id="from" name="from" type="date" required className="field-input" value={from}
                  onChange={(e) => { setFrom(e.target.value); if (!to || e.target.value > to) setTo(e.target.value); }} />
              </Field>
              <Field label="Last day" htmlFor="to">
                <input id="to" name="to" type="date" required min={from} className="field-input" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>

            {problems.length > 0 && (
              <div className="rounded border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn-fg">
                {problems.map((p) => <p key={p}>{p}</p>)}
              </div>
            )}

            <Field
              label="Reason"
              htmlFor="reason"
              hint={type === 'medical'
                ? 'Faculty see only that this is medical leave. The reason is visible to the Dean and the Dean HRM Office.'
                : 'Faculty see this reason in their notice.'}
            >
              <textarea id="reason" name="reason" required minLength={3} maxLength={1000} rows={3} className="field-input"
                placeholder={type === 'medical' ? 'For example: viral fever, advised rest by the campus clinic' : type === 'family' ? "For example: sister's wedding in Kochi" : 'For example: national HR case competition final, Mumbai'} />
            </Field>
          </div>
        </Card>

        <Card
          title="Sessions you will miss"
          description="Filled in from your timetable. Untick a session only if you will attend it."
        >
          <div className="px-5 py-4">
            {loadError && <p className="text-sm text-bad-fg">{loadError}</p>}
            {sessions === null && <p className="text-sm text-ink-muted">Loading your timetable…</p>}
            {sessions && sessions.length === 0 && !loadError && (
              <p className="text-sm text-ink-muted">No classes fall on these dates. You can still apply.</p>
            )}
            {byDay.length > 0 && (
              <div className="flex flex-col gap-4">
                {byDay.map(([day, list]) => (
                  <div key={day}>
                    <div className="label-caps mb-1.5">{fmtDay(day)}</div>
                    <ul className="divide-y divide-line rounded border border-line">
                      {list.map((s) => {
                        const on = !skipped.has(s.id);
                        return (
                          <li key={s.id}>
                            <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 text-sm hover:bg-canvas">
                              <input type="checkbox" name="session" value={s.id} checked={on} className="h-4 w-4 accent-navy-700"
                                onChange={() => setSkipped((prev) => { const n = new Set(prev); if (on) n.add(s.id); else n.delete(s.id); return n; })} />
                              <span className="w-12 shrink-0 tabular-nums text-ink-muted">{fmtTime(s.starts_at)}</span>
                              <span className="min-w-0 flex-1">
                                <span className="font-semibold text-ink">{s.course_code}</span>
                                {s.course_name && <span className="text-ink-muted"> · {s.course_name}</span>}
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

        <Card title="Where you will be">
          <div className="flex flex-col gap-4 px-5 py-5">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="away" checked={away} onChange={(e) => setAway(e.target.checked)} className="mt-0.5 h-4 w-4 accent-navy-700" />
              <span><span className="font-semibold text-ink">I will be away from campus</span><br /><span className="text-ink-muted">You will be asked for your return date and a contact person.</span></span>
            </label>
            {away && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Return to campus" htmlFor="return_date">
                  <input id="return_date" name="return_date" type="date" required min={to ? addDays(to, 1) : undefined} className="field-input" />
                </Field>
                <Field label="Contact person" htmlFor="contact_name">
                  <input id="contact_name" name="contact_name" required maxLength={120} className="field-input" placeholder="Name and relation" />
                </Field>
                <Field label="Contact phone" htmlFor="contact_phone">
                  <input id="contact_phone" name="contact_phone" type="tel" required maxLength={20} pattern="[0-9+ \-]{7,20}" className="field-input" placeholder="10-digit mobile" />
                </Field>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-6">
        <Card title="Before you submit">
          <dl className="flex flex-col gap-3 px-5 py-4 text-sm">
            <div><dt className="label-caps">Decided by</dt><dd className="mt-0.5 text-ink">{level ? LEVEL_LABEL[level] : '—'}</dd></div>
            <div><dt className="label-caps">Sessions</dt><dd className="mt-0.5 text-ink">{sessions ? plural(chosen.length, 'session') : '—'}</dd></div>
            <div><dt className="label-caps">Faculty notified</dt><dd className="mt-0.5 text-ink">{faculty.length ? faculty.join(', ') : 'None'}</dd></div>
            <div><dt className="label-caps">Documents</dt><dd className="mt-0.5 text-ink">{type === 'medical' ? `Medical certificate within ${rules.docDays} days of resuming classes` : 'None needed'}</dd></div>
          </dl>
          <div className="flex flex-col gap-4 border-t border-line px-5 py-4">
            {type === 'medical' && (
              <label className="flex items-start gap-3 text-xs text-ink-soft">
                <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 shrink-0 accent-navy-700" />
                <span>I agree that my medical certificate will be stored securely, seen only by the Dean and the Dean HRM Office, and deleted at the end of the academic year.</span>
              </label>
            )}
            <FormMessage state={state} />
            <SubmitButton pendingText="Submitting…" disabled={problems.length > 0 || sessions === null} className="w-full">Submit request</SubmitButton>
          </div>
        </Card>
      </div>
    </form>
  );
}
