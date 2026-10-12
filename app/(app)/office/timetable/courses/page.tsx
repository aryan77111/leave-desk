import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Card, EmptyState, PageHeader, TableWrap } from '@/components/ui/primitives';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { CourseForm, EditableRow, type CourseCodeRow, type SheetOption } from './course-form';

export const metadata: Metadata = { title: 'Course codes' };

type SheetRow = { id: string; batch: string; term: string; archived_at: string | null };

function CodeTable({ list, sheets, faculty, nameOf, readOnly = false }: {
  list: CourseCodeRow[]; sheets: SheetOption[]; faculty: { id: string; full_name: string }[]; nameOf: Map<string, string>; readOnly?: boolean;
}) {
  return (
    <TableWrap>
      <table className="data-table">
        <thead><tr><th>In the sheet</th><th>Course</th><th>Faculty</th><th>Sections</th><th></th></tr></thead>
        <tbody>
          {list.map((r) => (
            <EditableRow key={r.id} row={r} sheets={sheets} faculty={faculty} facultyName={nameOf.get(r.faculty_id) ?? 'No longer on the roster'} readOnly={readOnly} />
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export default async function CourseCodesPage() {
  await requireViewer('office');
  const supabase = await createClient();
  const [{ data: rows }, { data: fac }, { data: sh }] = await Promise.all([
    supabase.from('sheet_course_codes').select('id, sheet_id, course_code, variant, course_name, faculty_id, sections, elective').order('course_code').order('variant'),
    supabase.from('people').select('id, full_name').contains('roles', ['faculty']).eq('active', true).order('full_name'),
    supabase.from('timetable_sheets').select('id, batch, term, archived_at').order('batch', { ascending: false }).order('created_at', { ascending: false }),
  ]);
  const codes = (rows ?? []) as CourseCodeRow[];
  const faculty = (fac ?? []) as { id: string; full_name: string }[];
  const allSheets = (sh ?? []) as SheetRow[];
  const active = allSheets.filter((s) => !s.archived_at);
  const past = allSheets.filter((s) => s.archived_at);
  const options: SheetOption[] = active.map((s) => ({ id: s.id, label: `${s.batch} · ${s.term}` }));
  const nameOf = new Map(faculty.map((f) => [f.id, f.full_name]));
  // Faculty on archived terms may have left; look their names up too.
  const missing = [...new Set(codes.map((c) => c.faculty_id).filter((id) => !nameOf.has(id)))];
  if (missing.length) {
    const { data: more } = await supabase.from('people').select('id, full_name').in('id', missing);
    for (const p of (more ?? []) as { id: string; full_name: string }[]) nameOf.set(p.id, p.full_name);
  }

  return (
    <>
      <Link href="/office/timetable" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-navy-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />Timetable
      </Link>
      <PageHeader
        title="Course codes"
        description="How to read each term's sheet: which course and faculty member TAMA_A12 or DTHR_SB3 means, and which sections attend. Each term has its own list. Changes apply at the next sync."
      />

      {active.length === 0 ? (
        <Card><EmptyState title="No active term sheets">Add a term's sheet on the <Link href="/office/timetable" className="font-semibold text-navy-700 hover:underline">Timetable</Link> page first.</EmptyState></Card>
      ) : (
        <>
          <Card className="mb-6" title="Add a course code" description="One line per teacher or section. A course taught to each section separately needs one line for A and one for B.">
            <div className="px-5 py-5"><CourseForm sheets={options} faculty={faculty} /></div>
          </Card>

          {active.map((s) => {
            const list = codes.filter((c) => c.sheet_id === s.id);
            return (
              <div key={s.id} id={`sheet-${s.id}`} className="scroll-mt-6">
                <Card className="mb-6" title={`${s.batch} · ${s.term}`} description={`${list.length} code${list.length === 1 ? '' : 's'}`}>
                  {list.length === 0
                    ? <EmptyState title="No course codes yet">Add them above. Until then this sheet is not read.</EmptyState>
                    : <CodeTable list={list} sheets={options} faculty={faculty} nameOf={nameOf} />}
                </Card>
              </div>
            );
          })}
        </>
      )}

      {past.length > 0 && (
        <details className="rounded-md border border-line bg-white px-5 py-4 shadow-card">
          <summary className="cursor-pointer text-sm font-semibold text-ink">Past terms ({past.length})</summary>
          <p className="mt-2 text-sm text-ink-muted">Kept for reference. Archived sheets are no longer read.</p>
          {past.map((s) => {
            const list = codes.filter((c) => c.sheet_id === s.id);
            return (
              <div key={s.id} className="mt-4">
                <h3 className="mb-2 text-sm font-semibold text-ink">{s.batch} · {s.term} <span className="font-normal text-ink-muted">({list.length})</span></h3>
                {list.length > 0 && <div className="rounded border border-line"><CodeTable list={list} sheets={options} faculty={faculty} nameOf={nameOf} readOnly /></div>}
              </div>
            );
          })}
        </details>
      )}
    </>
  );
}
