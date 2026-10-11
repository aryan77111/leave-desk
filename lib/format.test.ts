import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysInclusive, fmtDay, fmtRange, fmtStamp, fmtTime, homeFor, localDate, routeLevel } from './format.ts';
import { normalizeDate, normalizeTime, toCsv, toPeopleRows, toSessionRows } from './csv.ts';

test('dates format in college time', () => {
  assert.equal(fmtDay('2026-10-12'), 'Mon 12 Oct');
  assert.equal(fmtRange('2026-10-12', '2026-10-12'), 'Mon 12 Oct');
  assert.equal(fmtRange('2026-10-12', '2026-10-13'), 'Mon 12 Oct – Tue 13 Oct');
  // 04:15 UTC is 09:45 in Bhubaneswar
  assert.equal(fmtTime('2026-10-12T04:15:00Z'), '09:45');
  assert.equal(fmtStamp('2026-10-12T04:15:00Z'), 'Mon 12 Oct, 09:45');
  // 20:00 UTC on the 11th is already the 12th in IST
  assert.equal(localDate('2026-10-11T20:00:00Z'), '2026-10-12');
});

test('day arithmetic', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(daysInclusive('2026-10-12', '2026-10-12'), 1);
  assert.equal(daysInclusive('2026-10-12', '2026-10-15'), 4);
});

test('every request goes to the Dean', () => {
  assert.equal(routeLevel(), 'dean');
});

test('landing page by role', () => {
  assert.equal(homeFor(['student']), '/student');
  assert.equal(homeFor(['faculty', 'approver']), '/approve');
  assert.equal(homeFor(['faculty', 'office']), '/office');
});

test('CSV import normalises headers, dates and times', () => {
  assert.equal(normalizeDate('1/9/2026'), '2026-09-01');
  assert.equal(normalizeDate('2026-9-1'), '2026-09-01');
  assert.equal(normalizeTime('9:45'), '09:45');
  assert.equal(normalizeTime('6.00 PM'), '18:00');
  assert.equal(normalizeTime('12:30 AM'), '00:30');
  const people = toPeopleRows([{ 'Email Address': 'A@x.edu', Name: 'A', Role: 'student', 'Roll No': 'UH1', Batch: '2025-27', Section: 'A', Extra: 'ignored' }]);
  assert.deepEqual(people, [{ email: 'A@x.edu', full_name: 'A', roles: 'student', student_no: 'UH1', batch: '2025-27', section: 'A' }]);
  const sessions = toSessionRows([{ Date: '01/09/2026', Start: '9:45', End: '11:15', Course: 'INHRM', 'Faculty Email': 'f@x.edu', Batch: '2025-27', Section: 'A' }]);
  assert.equal(sessions[0].date, '2026-09-01');
  assert.equal(sessions[0].start_time, '09:45');
  assert.equal(sessions[0].faculty_email, 'f@x.edu');
  assert.deepEqual(toPeopleRows([{ Email: '  ' }]), []);
});

test('CSV export quotes and neutralises formulas', () => {
  const csv = toCsv(['a', 'b'], [['=SUM(A1)', 'x, y'], ['plain', null]]);
  assert.equal(csv, `a,b\r\n'=SUM(A1),"x, y"\r\nplain,`);
});
