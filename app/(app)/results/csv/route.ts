import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@/lib/csv';
import { getSignedIn } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const s = await getSignedIn();
  const roles = s?.person?.roles ?? [];
  if (!roles.includes('office') && !roles.includes('approver')) return new NextResponse('Not allowed', { status: 403 });
  const from = request.nextUrl.searchParams.get('from') ?? '';
  const to = request.nextUrl.searchParams.get('to') ?? '';
  const batch = request.nextUrl.searchParams.get('batch') || null;
  if (!DATE.test(from) || !DATE.test(to) || to < from) return new NextResponse('Choose a valid date range.', { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pilot_metrics_rows', { p_from: from, p_to: to, p_batch: batch });
  if (error) return new NextResponse('Export failed. Try again.', { status: 500 });

  type Row = Record<string, string | number | boolean | null>;
  const rows = (data ?? []) as Row[];
  const cols: [string, string][] = [
    ['request_ref', 'Request'], ['student_no', 'Student ID'], ['batch', 'Batch'], ['section', 'Section'], ['leave_type', 'Leave type'],
    ['status', 'Status'], ['filed_by_office', 'Filed by office'], ['edited', 'Changed before decision'], ['submitted_at', 'Submitted'],
    ['decided_at', 'Decided'], ['hours_to_decision', 'Hours to decision'], ['decided_by_delegate', 'Decided by delegate'],
    ['faculty_notified', 'Faculty notified'], ['faculty_replied_in_window', 'Faculty replied in window'], ['faculty_deemed', 'Faculty deemed'],
    ['certificate_due', 'Certificate due'], ['certificate_first_uploaded', 'Certificate first uploaded'], ['certificate_on_time', 'Certificate on time'],
  ];
  const cell = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : v === null || v === undefined ? '' : String(v));
  const csv = toCsv(cols.map((c) => c[1]), rows.map((r) => cols.map(([k]) => cell(r[k]))));
  return new NextResponse('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pilot-results-${from}-to-${to}${batch ? `-${batch}` : ''}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
