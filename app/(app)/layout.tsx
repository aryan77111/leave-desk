import Link from 'next/link';
import { FeedbackLink } from '@/components/feedback/feedback-link';
import { Nav } from '@/components/shell/nav';
import { LinkButton } from '@/components/ui/primitives';
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
      <a href="#main" className="sr-only z-50 rounded-md bg-navy-900 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <Nav roles={person.roles} delegate={Boolean(delegation?.active)} name={person.full_name} email={email} programme={settings.programme_name} />
      <main id="main" tabIndex={-1} className="outline-none lg:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
          {surveyDue && (
            <div className="mb-6 flex flex-col gap-3 rounded-lg border border-gold-300 bg-gold-100 px-4 py-3 text-sm text-gold-900 sm:flex-row sm:items-center sm:justify-between">
              <p><span className="font-semibold">How was Leave Desk for you?</span> Two quick questions help the Dean decide whether to keep it.</p>
              <LinkButton href="/survey" className="shrink-0">Answer the survey</LinkButton>
            </div>
          )}
          {children}
          <footer className="mt-14 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-5 text-xs text-ink-muted">
            <span>Something not working, or an idea to make this better?</span>
            <FeedbackLink />
            <Link href="/help" className="font-semibold text-navy-700 hover:underline">Help and rules</Link>
          </footer>
        </div>
      </main>
    </div>
  );
}
