'use client';
import { useActionState } from 'react';
import clsx from 'clsx';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { answerSurvey } from '../feedback-actions';

function Scale({ name, legend, low, high, initial }: { name: string; legend: string; low: string; high: string; initial?: number }) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      <div className="mt-2 grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input type="radio" name={name} value={n} required defaultChecked={initial === n} className="peer sr-only" />
            <span className={clsx('flex h-11 items-center justify-center rounded border border-line-strong text-base font-semibold tabular-nums text-ink-soft',
              'peer-checked:border-navy-700 peer-checked:bg-navy-700 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-gold-500 hover:border-ink-faint')}>
              {n}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-muted"><span>{low}</span><span>{high}</span></div>
    </fieldset>
  );
}

export function SurveyForm({ initial }: { initial: { satisfaction: number; ease: number; faster: boolean | null; comment: string | null } | null }) {
  const [state, action] = useActionState(answerSurvey, null);
  return (
    <form action={action} className="flex flex-col gap-6 px-5 py-5">
      <Scale name="satisfaction" legend="Overall, how satisfied are you with Leave Desk?" low="1 · Not at all" high="5 · Very" initial={initial?.satisfaction} />
      <Scale name="ease" legend="How easy was it to use?" low="1 · Very hard" high="5 · Very easy" initial={initial?.ease} />
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Was it quicker than the paper form?</legend>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-ink-soft">
          {[['yes', 'Yes'], ['no', 'No'], ['', 'Not sure']].map(([v, l]) => (
            <label key={l} className="flex items-center gap-2">
              <input type="radio" name="faster" value={v} defaultChecked={(initial?.faster === true && v === 'yes') || (initial?.faster === false && v === 'no') || ((initial?.faster ?? null) === null && v === '')} className="h-4 w-4 accent-navy-700" />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="comment" className="text-sm font-semibold text-ink">Anything else? <span className="font-normal text-ink-muted">(optional)</span></label>
        <textarea id="comment" name="comment" rows={3} maxLength={2000} defaultValue={initial?.comment ?? ''} className="field-input" placeholder="What worked, what got in the way, what you would change." />
      </div>
      <FormMessage state={state} />
      <div><SubmitButton pendingText="Saving…">{initial ? 'Update my answers' : 'Send answers'}</SubmitButton></div>
    </form>
  );
}
