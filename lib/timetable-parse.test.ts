import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSheet, parseSlot, type CourseCode } from '../supabase/functions/sync-timetable/parse.ts';

const cc = (course_code: string, variant: string, faculty_id: string, sections: string[], elective = false): CourseCode =>
  ({ course_code, variant, course_name: `${course_code} course`, faculty_id, sections, elective });

const codes: CourseCode[] = [
  cc('TAMA', 'A', 'f-mousumi', ['A']), cc('TAMA', 'B', 'f-mousumi', ['B']),
  cc('MARM', 'A', 'f-avinash', ['A']), cc('MARM', 'B', 'f-nirali', ['B']),
  cc('MDI', '', 'f-sanjay', ['A', 'B'], true),
  cc('DTHR', 'A', 'f-arup', ['A', 'B'], true), cc('DTHR', 'SB', 'f-sanjay', ['A', 'B'], true),
  cc('STHR', 'RGP', 'f-rgp', ['A', 'B'], true), cc('STHR', 'LKJ', 'f-lkj', ['A', 'B'], true),
];

const grid = [
  ['XIM University', null, null],
  [null],
  ['Date', 'Day', '08:00AM-\n09:30AM', '09:45AM-\n11:15AM', 'QUIZ\n01:50PM- 02:25PM', '02:30PM- 04:00PM'],
  [new Date('2026-09-21T00:00:00Z'), 'Mon', 'Reserve', 'TAMA_B1\nMARM_A78', 'MARM\nQuiz 1', 'DTHR_SB2 /  /'],
  ['22/09/2026', 'Tue', 'Gandhi Jayanti', 'MDI_4', null, 'STHR_RGP_3\nSTHR_LKJ_3'],
  [new Date('2026-09-23T00:00:00Z'), 'Wed', 'Mid-Term', 'OCDE_2', 'TAMA_C1', 'DTHR_A1'],
  [1, 'Staffing for Organisations', 'Prof. X (x@college.edu)'],
];

test('reads time slots in 12- and 24-hour forms', () => {
  assert.deepEqual(parseSlot('09:45AM-\n11:15AM'), ['09:45', '11:15']);
  assert.deepEqual(parseSlot('QUIZ\n01:50PM- 02:25PM'), ['13:50', '14:25']);
  assert.deepEqual(parseSlot('11:30AM-\n01:00PM'), ['11:30', '13:00']);
  assert.deepEqual(parseSlot('14:30-16:00'), ['14:30', '16:00']);
  assert.deepEqual(parseSlot('2.30-4.00'), ['14:30', '16:00']);
  assert.equal(parseSlot('Day'), null);
});

test('turns cells into sessions per section with the right faculty', () => {
  const r = parseSheet(grid, codes);
  const key = (s: { date: string; start: string; code: string; section: string; faculty_id: string }) => `${s.date} ${s.start} ${s.code} ${s.section} ${s.faculty_id}`;
  const got = r.sessions.map(key);
  assert.ok(got.includes('2026-09-21 09:45 TAMA B f-mousumi'));
  assert.ok(got.includes('2026-09-21 09:45 MARM A f-avinash'), 'MARM_A78 typo still reads as section A');
  assert.ok(got.includes('2026-09-21 13:50 MARM A f-avinash') && got.includes('2026-09-21 13:50 MARM B f-nirali'), 'quiz for every section');
  assert.equal(r.sessions.find((s) => s.start === '13:50')?.name, 'MARM course (Quiz 1)');
  assert.ok(got.includes('2026-09-21 14:30 DTHR A f-sanjay') && got.includes('2026-09-21 14:30 DTHR B f-sanjay'), 'faculty initials pick the teacher, elective goes to both sections');
  assert.ok(got.includes('2026-09-22 09:45 MDI A f-sanjay'), 'DD/MM/YYYY dates work');
  assert.ok(got.includes('2026-09-22 14:30 STHR A f-rgp') && got.includes('2026-09-22 14:30 STHR A f-lkj') === false, 'same course in one slot is kept once per section');
  assert.equal(r.firstDate, '2026-09-21');
  assert.equal(r.lastDate, '2026-09-23');
});

test('reports what it could not read and skips notes', () => {
  const r = parseSheet(grid, codes);
  assert.deepEqual(r.unreadable.map((u) => u.text), ['OCDE_2', 'TAMA_C1']);
  assert.match(r.unreadable[0].reason, /Unknown course code OCDE/);
  assert.match(r.unreadable[1].reason, /No section or faculty/);
  assert.deepEqual(r.skipped, ['Gandhi Jayanti', 'Mid-Term', 'Reserve']);
});

test('refuses a sheet without a header row', () => {
  assert.throws(() => parseSheet([['Week', 'Mon']], codes), /header row/);
});
