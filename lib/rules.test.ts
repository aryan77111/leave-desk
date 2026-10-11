import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earliestPlannedStart, timingProblems, type Rules } from './rules.ts';

const rules: Rules = { noticeHours: 48, medicalLateHours: 24, medicalAheadDays: 7, docDays: 2, maxLeaveDays: 15 };
// Mon 12 Oct 2026, 10:00 in Bhubaneswar
const now = new Date('2026-10-12T10:00:00+05:30');

test('planned leave needs 48 hours notice', () => {
  assert.equal(earliestPlannedStart(now, 48), '2026-10-15');
  assert.match(timingProblems('family', '2026-10-14', '2026-10-14', rules, now)[0], /48 hours' notice.*Thu 15 Oct/);
  assert.deepEqual(timingProblems('official', '2026-10-15', '2026-10-16', rules, now), []);
});

test('medical leave window', () => {
  assert.deepEqual(timingProblems('medical', '2026-10-12', '2026-10-12', rules, now), []);
  // first day yesterday: allowed until the end of today + 24h? Window ends 24h after the first day ends.
  assert.deepEqual(timingProblems('medical', '2026-10-11', '2026-10-12', rules, now), []);
  assert.match(timingProblems('medical', '2026-10-10', '2026-10-10', rules, now)[0], /within 24 hours/);
  assert.match(timingProblems('medical', '2026-10-20', '2026-10-20', rules, now)[0], /7 days ahead/);
});

test('date order and length', () => {
  assert.deepEqual(timingProblems('medical', '2026-10-13', '2026-10-12', rules, now), ['The last day is before the first day.']);
  assert.match(timingProblems('official', '2026-10-20', '2026-11-10', rules, now)[0], /15 days/);
});
