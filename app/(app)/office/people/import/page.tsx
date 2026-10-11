import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui/primitives';
import { requireViewer } from '@/lib/session';
import { PeopleImport } from '../people-import';

export const metadata: Metadata = { title: 'Import people' };

const COLUMNS: [string, string][] = [
  ['email', 'College email. Used to match existing people, so re-importing updates instead of duplicating.'],
  ['full_name', 'Name as it should appear in emails and lists.'],
  ['roles', 'student, faculty, dean or office. Combine with a semicolon, for example faculty;dean.'],
  ['student_no', 'Roll number. Required for students.'],
  ['programme', 'Optional, for example MBA-HRM.'],
  ['batch', 'Required for students. Write it the same way as in the timetable, for example 2025-27.'],
  ['section', 'Required for students, for example A.'],
];

export default async function ImportPeoplePage() {
  await requireViewer('office');
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/office/people" className="hover:text-navy-700">People</Link>}
        title="Import people"
        description="Add or update many people at once from a CSV file, such as a new batch of students or the faculty list."
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Upload a CSV file" description="Download the template, fill it in (Excel or Google Sheets), save as CSV and upload it here. You will see a preview before anything is saved.">
          <div className="px-5 py-5"><PeopleImport /></div>
        </Card>
        <Card title="Columns">
          <dl className="flex flex-col gap-3 px-5 py-4 text-sm">
            {COLUMNS.map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-xs font-semibold text-ink">{k}</dt>
                <dd className="mt-0.5 text-ink-muted">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">Common headings like “Name”, “Roll No” or “Email Address” are recognised too.</p>
        </Card>
      </div>
    </>
  );
}
