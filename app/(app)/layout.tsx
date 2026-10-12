import Link from 'next/link';
import { FeedbackLink } from '@/components/feedback/feedback-link';
import { Nav } from '@/components/shell/nav';
import { getDelegation, getSettings, requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { person, email } = await requireViewer();
  const [settings, delegation] = await Promise.all([getSettings(), getDelegation()]);

  let surveyDue = false;
  if (settings.survey_open) {
    const supabase = await createClient();
    const { count } = await supabase.from('survey_responses').select('person_id', { count: 'exact', head: true }).eq('person_id', person.id);
    surveyDue = (count ?? 0) === 0;
  }

  return (
    <div className="min-h-screen">
      <Nav roles={person.roles} delegate={Boolean(delegation?.active)} name={person.full_name} email={email} programme={settings.programme_name} />
      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          {surveyDue && (
            <div className="mb-6 flex flex-col gap-3 rounded-md border border-gold-300 bg-gold-100 px-4 py-3 text-sm text-gold-900 sm:flex-row sm:items-center sm:justify-between">
              <p><span className="font-semibold">How was Leave Desk for you?</span> Two quick questions help the Dean decide whether to keep it.</p>
              <Link href="/survey" className="inline-flex h-9 shrink-0 items-center justify-center rounded bg-navy-700 px-3.5 font-semibold text-white hover:bg-navy-800">Answer the survey</Link>
            </div>
          )}
          {children}
          <footer className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-xs text-ink-muted">
            <span>Something not working, or an idea to make this better?</span>
            <FeedbackLink />
            <Link href="/help" className="font-semibold text-navy-700 hover:underline">Help and rules</Link>
          </footer>
        </div>
      </main>
    </div>
  );
}
