import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@/lib/csv';
import { getSignedIn } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const s = await getSignedIn();
  if (!s?.person?.roles.includes('office')) return new NextResponse('Not allowed', { status: 403 });
  const from = request.nextUrl.searchParams.get('from') ?? '';
  const to = request.nextUrl.searchParams.get('to') ?? '';
  if (!DATE.test(from) || !DATE.test(to) || to < from) return new NextResponse('Choose a valid date range.', { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('attendance_export', { p_from: from, p_to: to });
  if (error) return new NextResponse('Export failed. Try again.', { status: 500 });

  type Row = { request_ref: string; student_no: string; student_name: string; batch: string; section: string; course_code: string; session_start: string; faculty_name: string; leave_type: string; leave_status: string };
  const rows = (data ?? []) as Row[];
  const csv = toCsv(
    ['Request', 'Student ID', 'Student name', 'Batch', 'Section', 'Course', 'Session start', 'Faculty', 'Leave type', 'Status'],
    rows.map((r) => [r.request_ref, r.student_no, r.student_name, r.batch, r.section, r.course_code, r.session_start, r.faculty_name, r.leave_type, r.leave_status]),
  );
  return new NextResponse('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="approved-leave-${from}-to-${to}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
