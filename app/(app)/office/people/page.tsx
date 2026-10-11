import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, LinkButton, PageHeader, TableWrap } from '@/components/ui/primitives';
import { ROLE_LABEL } from '@/lib/format';
import { requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { Person, Role } from '@/lib/types';
import { ActiveToggle } from './active-toggle';
import { PeopleImport } from './people-import';

export const metadata: Metadata = { title: 'People' };
const PAGE = 100;
const ROLES: Role[] = ['student', 'faculty', 'approver', 'office'];

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; inactive?: string; page?: string }> }) {
  const { person: me } = await requireViewer('office');
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const role = ROLES.includes(sp.role as Role) ? (sp.role as Role) : undefined;
  const q = (sp.q ?? '').trim().replace(/[%,()*\\]/g, '').slice(0, 60);

  const supabase = await createClient();
  let query = supabase.from('people').select('*', { count: 'exact' }).order('full_name').range((page - 1) * PAGE, page * PAGE - 1);
  if (role) query = query.contains('roles', [role]);
  if (!sp.inactive) query = query.eq('active', true);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,student_no.ilike.%${q}%`);
  const { data, count } = await query;
  const people = (data ?? []) as Person[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) => `/office/people?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <PageHeader title="People" description="The roster. Only people listed here can sign in. Import from a spreadsheet to add or update people; matching is by email." />

      <Card className="mb-6" title="Import people" description="Roles: student, faculty, dean, office (combine with a semicolon, for example faculty;dean). Students need student_no, batch and section.">
        <div className="px-5 py-4"><PeopleImport /></div>
      </Card>

      <Card>
        <form className="grid grid-cols-1 gap-3 border-b border-line px-5 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto]" role="search">
          <label className="flex flex-col gap-1"><span className="label-caps">Search</span>
            <input name="q" defaultValue={sp.q} placeholder="Name, email or student ID" className="field-input" /></label>
          <label className="flex flex-col gap-1"><span className="label-caps">Role</span>
            <select name="role" defaultValue={role ?? ''} className="field-input">
              <option value="">All roles</option>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select></label>
          <label className="flex items-end gap-2 pb-2 text-sm text-ink-soft">
            <input type="checkbox" name="inactive" value="1" defaultChecked={Boolean(sp.inactive)} className="h-4 w-4 accent-navy-700" /> Include deactivated
          </label>
          <div className="flex items-end gap-2">
            <button className="h-9 rounded bg-navy-700 px-3.5 text-sm font-semibold text-white hover:bg-navy-800">Filter</button>
            <Link href="/office/people" className="h-9 rounded px-2 text-sm font-semibold leading-9 text-navy-700 hover:bg-navy-50">Clear</Link>
          </div>
        </form>
        {people.length === 0 ? (
          <EmptyState title={total === 0 && !q && !role ? 'No one on the roster yet' : 'No one matches'}>
            {total === 0 && !q && !role ? 'Import the student list and faculty list above to get started.' : undefined}
          </EmptyState>
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Name</th><th>Roles</th><th>Class</th><th>Sign-in</th><th></th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className={p.active ? '' : 'opacity-60'}>
                    <td className="min-w-[200px]">
                      <span className="font-semibold text-ink">{p.full_name}</span>
                      <div className="break-all text-xs text-ink-muted">{p.email}</div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {p.roles.map((r) => <Badge key={r} tone={r === 'student' ? 'quiet' : 'info'}>{ROLE_LABEL[r]}</Badge>)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-ink-soft">{p.student_no ? `${p.student_no} · ${p.batch} ${p.section}` : '—'}</td>
                    <td className="whitespace-nowrap">{p.user_id ? <span className="text-ok-fg">Signed in</span> : <span className="text-ink-muted">Not yet</span>}</td>
                    <td className="text-right">{p.id !== me.id && <ActiveToggle personId={p.id} active={p.active} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-ink-muted">
          <span>{total} {total === 1 ? 'person' : 'people'}{pages > 1 ? ` · page ${page} of ${pages}` : ''}</span>
          {pages > 1 && (
            <div className="flex gap-2">
              {page > 1 && <LinkButton variant="secondary" href={link(page - 1)}>Previous</LinkButton>}
              {page < pages && <LinkButton variant="secondary" href={link(page + 1)}>Next</LinkButton>}
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
