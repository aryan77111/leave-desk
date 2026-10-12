import type { Metadata } from 'next';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { getSettings, requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { SurveyForm } from './survey-form';

export const metadata: Metadata = { title: 'Survey' };

export default async function SurveyPage() {
  const { person } = await requireViewer();
  const s = await getSettings();
  const supabase = await createClient();
  const { data } = await supabase.from('survey_responses').select('satisfaction, ease, faster, comment').eq('person_id', person.id).maybeSingle();

  return (
    <>
      <PageHeader title="How was Leave Desk?" description="Your answers go to the Dean HRM Office and are summarised for the Dean's review of the pilot." />
      {!s.survey_open ? (
        <Alert tone="quiet" title="The survey is not open">The Dean HRM Office opens it near the end of the pilot. Thank you for checking.</Alert>
      ) : (
        <Card className="max-w-2xl">
          <SurveyForm initial={data as { satisfaction: number; ease: number; faster: boolean | null; comment: string | null } | null} />
        </Card>
      )}
    </>
  );
}
