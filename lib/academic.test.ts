import { test } from 'node:test';
import assert from 'node:assert/strict';
import { academicYearStart, batchStartYear, yearLabel, yearOfStudy } from './academic.ts';

test('academic year starts in June', () => {
  assert.equal(academicYearStart(new Date('2026-10-12T10:00:00+05:30')), 2026);
  assert.equal(academicYearStart(new Date('2027-03-01T10:00:00+05:30')), 2026);
  assert.equal(academicYearStart(new Date('2027-06-01T00:30:00+05:30')), 2027);
});

test('year of study from the batch label', () => {
  const oct2026 = new Date('2026-10-12T10:00:00+05:30');
  assert.equal(batchStartYear('2025-27'), 2025);
  assert.equal(batchStartYear('MBA 2026-2028'), 2026);
  assert.equal(batchStartYear('Section A'), null);
  assert.equal(yearOfStudy('2026-28', oct2026), 1);
  assert.equal(yearOfStudy('2025-27', oct2026), 2);
  assert.equal(yearLabel(yearOfStudy('2024-26', oct2026)), 'Passed out');
  assert.equal(yearLabel(yearOfStudy('2025-27', oct2026)), 'Second year');
  assert.equal(yearLabel(null), '—');
});
