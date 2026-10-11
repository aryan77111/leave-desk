import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Card, EmptyState, PageHeader, TableWrap } from '@/components/ui/primitives';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { CourseForm, EditableRow, type CourseCodeRow } from './course-form';

export const metadata: Metadata = { title: 'Course codes' };

export default async function CourseCodesPage() {
  await requireViewer('office');
  const supabase = await createClient();
  const [{ data: rows }, { data: fac }, { data: src }] = await Promise.all([
    supabase.from('course_codes').select('id, batch, course_code, variant, course_name, faculty_id, sections, elective').order('course_code').order('variant'),
    supabase.from('people').select('id, full_name').contains('roles', ['faculty']).eq('active', true).order('full_name'),
    supabase.from('timetable_sources').select('batch').order('batch', { ascending: false }),
  ]);
  const codes = (rows ?? []) as CourseCodeRow[];
  const faculty = (fac ?? []) as { id: string; full_name: string }[];
  const batches = ((src ?? []) as { batch: string }[]).map((s) => s.batch);
  const nameOf = new Map(faculty.map((f) => [f.id, f.full_name]));

  return (
    <>
      <Link href="/office/timetable" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-navy-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />Timetable
      </Link>
      <PageHeader
        title="Course codes"
        description="How to read the codes in each sheet: which course and faculty member TAMA_A12 or DTHR_SB3 means, and which sections attend. Changes apply at the next sync."
      />

      {batches.length === 0 ? (
        <Card><EmptyState title="No sheets connected yet">Connect a batch's sheet on the <Link href="/office/timetable" className="font-semibold text-navy-700 hover:underline">Timetable</Link> page first.</EmptyState></Card>
      ) : (
        <>
          <Card className="mb-6" title="Add a course code" description="One line per teacher or section. A course taught to each section separately needs one line for A and one for B.">
            <div className="px-5 py-5"><CourseForm batches={batches} faculty={faculty} /></div>
          </Card>

          {batches.map((b) => {
            const list = codes.filter((c) => c.batch === b);
            return (
              <Card key={b} className="mb-6" title={`Batch ${b}`} description={`${list.length} code${list.length === 1 ? '' : 's'}`}>
                {list.length === 0 ? (
                  <EmptyState title="No course codes yet" />
                ) : (
                  <TableWrap>
                    <table className="data-table">
                      <thead><tr><th>In the sheet</th><th>Course</th><th>Faculty</th><th>Sections</th><th></th></tr></thead>
                      <tbody>
                        {list.map((r) => (
                          <EditableRow key={r.id} row={r} batches={batches} faculty={faculty} facultyName={nameOf.get(r.faculty_id) ?? 'Not on the roster'} />
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </Card>
            );
          })}
        </>
      )}
    </>
  );
}
