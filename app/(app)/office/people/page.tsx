import type { Metadata } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { Badge, Card, EmptyState, LinkButton, PageHeader, TableWrap } from '@/components/ui/primitives';
import { academicYearStart, yearLabel, yearOfStudy } from '@/lib/academic';
import { ROLE_LABEL } from '@/lib/format';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { Person } from '@/lib/types';
import { BatchAction } from './batch-actions';
import { PeopleImport } from './people-import';

export const metadata: Metadata = { title: 'People' };
const PAGE = 100;

const VIEWS = [
  { key: 'all', label: 'Everyone' },
  { key: 'students', label: 'All students' },
  { key: 'year1', label: 'First year' },
  { key: 'year2', label: 'Second year' },
  { key: 'faculty', label: 'Faculty' },
  { key: 'dean', label: 'Dean' },
  { key: 'office', label: 'Dean HRM Office' },
  { key: 'inactive', label: 'Deactivated' },
] as const;
type View = (typeof VIEWS)[number]['key'];

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; batch?: string; page?: string; sort?: string }> }) {
  await requireViewer('office');
  const sp = await searchParams;
  const view: View = (VIEWS.find((v) => v.key === sp.view)?.key ?? 'all') as View;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? '').trim().replace(/[%,()*\\]/g, '').slice(0, 60);
  const batchFilter = (sp.batch ?? '').trim();
  const sortByName = sp.sort === 'name';
  const Y = academicYearStart();
  const supabase = await createClient();

  // Batch summary (students only)
  const { data: studentRows } = await supabase.from('people').select('batch, section, active').contains('roles', ['student']).limit(20000);
  const batchMap = new Map<string, { batch: string; section: string; active: number; inactive: number }>();
  for (const r of (studentRows ?? []) as { batch: string | null; section: string | null; active: boolean }[]) {
    if (!r.batch) continue;
    const key = `${r.batch}|${r.section ?? ''}`;
    const b = batchMap.get(key) ?? { batch: r.batch, section: r.section ?? '', active: 0, inactive: 0 };
    if (r.active) b.active++; else b.inactive++;
    batchMap.set(key, b);
  }
  const batches = [...batchMap.values()].sort((a, b) => b.batch.localeCompare(a.batch) || a.section.localeCompare(b.section));
  const batchNames = [...new Set(batches.map((b) => b.batch))];

  // Default: students in roll-number order, then everyone without a roll number (staff) by name.
  let query = supabase.from('people').select('*', { count: 'exact' });
  query = sortByName
    ? query.order('full_name')
    : query.order('student_no', { ascending: true, nullsFirst: false }).order('full_name');
  query = query.range((page - 1) * PAGE, page * PAGE - 1);
  query = view === 'inactive' ? query.eq('active', false) : query.eq('active', true);
  if (view === 'students' || view === 'year1' || view === 'year2') query = query.contains('roles', ['student']);
  if (view === 'year1') query = query.like('batch', `${Y}%`);
  if (view === 'year2') query = query.like('batch', `${Y - 1}%`);
  if (view === 'faculty') query = query.contains('roles', ['faculty']);
  if (view === 'dean') query = query.contains('roles', ['approver']);
  if (view === 'office') query = query.contains('roles', ['office']);
  if (batchFilter) query = query.eq('batch', batchFilter);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,student_no.ilike.%${q}%`);
  const { data, count } = await query;
  const people = (data ?? []) as Person[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (over: Record<string, string | undefined>) => {
    const params = Object.entries({ view: view === 'all' ? undefined : view, q: sp.q, batch: sp.batch, sort: sp.sort, ...over }).filter(([, v]) => v) as [string, string][];
    return `/office/people${params.length ? `?${new URLSearchParams(params)}` : ''}`;
  };
  const studentView = view === 'students' || view === 'year1' || view === 'year2';

  return (
    <>
      <PageHeader
        title="People"
        description="The roster. Only active people listed here can sign in."
        action={<LinkButton href="/office/people/new"><Plus className="h-4 w-4" />Add person</LinkButton>}
      />

      <nav aria-label="People views" className="mb-4 flex gap-5 overflow-x-auto border-b border-line">
        {VIEWS.map((v) => (
          <Link key={v.key} href={href({ view: v.key === 'all' ? undefined : v.key, page: undefined })} aria-current={view === v.key ? 'page' : undefined}
            className={clsx('whitespace-nowrap border-b-2 px-1 pb-2.5 text-sm font-semibold', view === v.key ? 'border-gold-500 text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
            {v.label}
          </Link>
        ))}
      </nav>

      <Card>
        <form className="grid grid-cols-1 gap-3 border-b border-line px-5 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]" role="search">
          {view !== 'all' && <input type="hidden" name="view" value={view} />}
          <label className="flex flex-col gap-1"><span className="label-caps">Search</span>
            <input name="q" defaultValue={sp.q} placeholder="Name, email or student ID" className="field-input" /></label>
          <label className="flex flex-col gap-1"><span className="label-caps">Batch</span>
            <select name="batch" defaultValue={batchFilter} className="field-input">
              <option value="">All batches</option>
              {batchNames.map((b) => <option key={b} value={b}>{b} · {yearLabel(yearOfStudy(b))}</option>)}
            </select></label>
          <div className="flex items-end gap-2">
            <button className="h-9 rounded bg-navy-700 px-3.5 text-sm font-semibold text-white hover:bg-navy-800">Filter</button>
            <Link href={href({ q: undefined, batch: undefined, page: undefined })} className="h-9 rounded px-2 text-sm font-semibold leading-9 text-navy-700 hover:bg-navy-50">Clear</Link>
          </div>
        </form>
        {people.length === 0 ? (
          <EmptyState title={total === 0 && view === 'all' && !q && !batchFilter ? 'No one on the roster yet' : 'No one matches'}>
            {total === 0 && view === 'all' && !q && !batchFilter ? 'Import the student and faculty lists below, or add people one at a time.' : undefined}
          </EmptyState>
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  {studentView ? <><th>Student ID</th><th>Batch</th><th>Year</th></> : <><th>Roles</th><th>Class</th></>}
                  <th>Sign-in</th><th></th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className={clsx('row-link', !p.active && 'text-ink-muted')}>
                    <td className="min-w-[200px]">
                      <Link href={`/office/people/${p.id}`} className="font-semibold text-navy-700 hover:underline">{p.full_name}</Link>
                      <div className="break-all text-xs text-ink-muted">{p.email}</div>
                    </td>
                    {studentView ? (
                      <>
                        <td className="whitespace-nowrap">{p.student_no}</td>
                        <td className="whitespace-nowrap">{p.batch} · {p.section}</td>
                        <td className="whitespace-nowrap">{yearLabel(yearOfStudy(p.batch))}</td>
                      </>
                    ) : (
                      <>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {p.roles.map((r) => <Badge key={r} tone={r === 'student' ? 'quiet' : 'info'}>{ROLE_LABEL[r]}</Badge>)}
                            {!p.active && <Badge tone="quiet">Deactivated</Badge>}
                          </div>
                        </td>
                        <td className="whitespace-nowrap text-ink-soft">{p.student_no ? `${p.student_no} · ${p.batch} ${p.section}` : '—'}</td>
                      </>
                    )}
                    <td className="whitespace-nowrap">{p.user_id ? <span className="text-ok-fg">Signed in</span> : <span className="text-ink-muted">Not yet</span>}</td>
                    <td className="text-right"><Link href={`/office/people/${p.id}`} className="text-sm font-semibold text-navy-700 hover:underline">Edit</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-ink-muted">
          <span>
            {total} {total === 1 ? 'person' : 'people'}{pages > 1 ? ` · page ${page} of ${pages}` : ''} · Sorted by{' '}
            {sortByName ? 'name' : 'roll number'} ·{' '}
            <Link href={href({ sort: sortByName ? undefined : 'name', page: undefined })} className="font-semibold text-navy-700 hover:underline">
              Sort by {sortByName ? 'roll number' : 'name'}
            </Link>
          </span>
          {pages > 1 && (
            <div className="flex gap-2">
              {page > 1 && <LinkButton variant="secondary" href={href({ page: String(page - 1) })}>Previous</LinkButton>}
              {page < pages && <LinkButton variant="secondary" href={href({ page: String(page + 1) })}>Next</LinkButton>}
            </div>
          )}
        </div>
      </Card>

      <Card className="mt-6" title="Batches" description={`Year of study is worked out from the batch name for the academic year starting June ${Y}. Graduating a batch deactivates its students; their leave history is kept.`}>
        {batches.length === 0 ? (
          <EmptyState title="No student batches yet" />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Batch</th><th>Section</th><th>Year</th><th>Active</th><th>Graduated</th><th></th></tr></thead>
              <tbody>
                {batches.map((b) => {
                  const yr = yearOfStudy(b.batch);
                  return (
                    <tr key={`${b.batch}|${b.section}`}>
                      <td className="whitespace-nowrap font-semibold"><Link href={href({ view: 'students', batch: b.batch, page: undefined })} className="text-navy-700 hover:underline">{b.batch}</Link></td>
                      <td>{b.section || '—'}</td>
                      <td className="whitespace-nowrap">{yr !== null && yr > 2 && b.active > 0 ? <Badge tone="warn">Passed out</Badge> : yearLabel(yr)}</td>
                      <td className="tabular-nums">{b.active}</td>
                      <td className="tabular-nums text-ink-muted">{b.inactive}</td>
                      <td className="text-right"><BatchAction batch={b.batch} section={b.section} active={b.active} inactive={b.inactive} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card className="mt-6" title="Import from a spreadsheet" description="Add or update many people at once; matching is by email. Roles: student, faculty, dean, office (combine with a semicolon, for example faculty;dean). Students need student_no, batch and section.">
        <div className="px-5 py-4"><PeopleImport /></div>
      </Card>
    </>
  );
}
