import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { Person } from '@/lib/types';
import { updatePerson } from '../../actions';
import { PersonForm } from '../person-form';

export const metadata: Metadata = { title: 'Edit person' };

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  await requireViewer('office');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from('people').select('*').eq('id', id).maybeSingle();
  const person = data as Person | null;
  if (!person) notFound();
  const { count } = await supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('student_id', id);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/office/people" className="hover:text-navy-700">People</Link>}
        title={person.full_name}
        description={
          <>
            {person.user_id ? 'Has signed in.' : 'Has not signed in yet.'}
            {person.roles.includes('student') && (
              <> {count ?? 0} leave request{count === 1 ? '' : 's'}. {count ? <Link className="font-semibold text-navy-700 hover:underline" href={`/office/leave?q=${encodeURIComponent(person.student_no ?? '')}`}>View leave</Link> : null}</>
            )}
          </>
        }
      />
      <PersonForm person={person} action={updatePerson} submitLabel="Save changes" />
    </>
  );
}
