import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/primitives';
import { requireViewer } from '@/lib/session';
import { addPerson } from '../../actions';
import { PersonForm } from '../person-form';

export const metadata: Metadata = { title: 'Add person' };

export default async function NewPersonPage() {
  await requireViewer('office');
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/office/people" className="hover:text-navy-700">People</Link>}
        title="Add person"
        description="For one-off additions, such as a late admission or a visiting faculty member. For a whole batch, import a spreadsheet instead."
      />
      <PersonForm action={addPerson} submitLabel="Add person" />
    </>
  );
}
