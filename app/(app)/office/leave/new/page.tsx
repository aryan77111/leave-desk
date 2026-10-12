import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { LeaveForm } from '@/components/leave/leave-form';
import { Card, EmptyState, LinkButton, PageHeader } from '@/components/ui/primitives';
import { getSettings, requireViewer } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { Person } from '@/lib/types';
import { fileLeave } from '../../actions';

export const metadata: Metadata = { title: 'File leave for a student' };

export default async function FileLeavePage({ searchParams }: { searchParams: Promise<{ q?: string; student?: string }> }) {
  await requireViewer('office');
  const sp = await searchParams;
  const supabase = await createClient();
  const s = await getSettings();

  if (sp.student && /^[0-9a-f-]{36}$/i.test(sp.student)) {
    const { data } = await supabase.from('people').select('*').eq('id', sp.student).contains('roles', ['student']).eq('active', true).maybeSingle();
    const st = data as Person | null;
    if (st) {
      return (
        <>
          <PageHeader
            eyebrow={<Link href="/office/leave/new" className="hover:text-navy-700">File leave for a student</Link>}
            title={`Leave for ${st.full_name}`}
            description="For a student who could not apply themselves, for example while in hospital. Timing rules do not apply, so the dates can be in the past. The request goes to the Dean as usual, and faculty are emailed."
          />
          <LeaveForm
            mode="office"
            action={fileLeave}
            hidden={{ student_id: st.id }}
            studentName={`${st.full_name} · ${st.student_no}`}
            batch={st.batch!}
            section={st.section!}
            rules={{ noticeHours: s.notice_hours, medicalLateHours: s.medical_late_hours, medicalAheadDays: s.medical_ahead_days, docDays: s.doc_days, maxLeaveDays: 120 }}
          />
        </>
      );
    }
  }

  const q = (sp.q ?? '').trim().replace(/[%,()*\\]/g, '').slice(0, 60);
  let rows: Person[] = [];
  if (q) {
    const { data } = await supabase.from('people').select('*').contains('roles', ['student']).eq('active', true)
      .or(`full_name.ilike.%${q}%,student_no.ilike.%${q}%,email.ilike.%${q}%`).order('student_no').limit(30);
    rows = (data ?? []) as Person[];
  }

  return (
    <>
      <PageHeader
        title="File leave for a student"
        description="Use this when a student cannot apply themselves: in hospital, a family emergency, or a request that arrived on paper. First choose the student."
      />
      <Card className="max-w-2xl">
        <form className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-end" role="search">
          <label className="flex flex-1 flex-col gap-1">
            <span className="label-caps">Student</span>
            <input name="q" defaultValue={sp.q} autoFocus placeholder="Name, student ID or email" className="field-input" />
          </label>
          <button className="h-10 rounded bg-navy-700 px-4 text-sm font-semibold text-white hover:bg-navy-800 sm:h-9">Find</button>
        </form>
        {!q ? (
          <EmptyState title="Search for the student">Type part of a name or a student ID.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title="No active student matches" action={<LinkButton href="/office/people" variant="secondary">Open People</LinkButton>}>
            Check the spelling, or add the student on People first.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/office/leave/new?student=${p.id}`} className="group flex min-h-[52px] items-center gap-3 px-5 py-3 hover:bg-navy-50/50">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{p.full_name}</span>
                    <span className="block text-xs text-ink-muted">{p.student_no} · {p.batch} {p.section} · {p.email}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint group-hover:text-navy-700" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
