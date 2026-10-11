// Year of study from a batch label such as "2025-27" or "2025-2027".
// The academic year starts in June: from June 2026, the 2026 intake is first year.

export const ACADEMIC_YEAR_START_MONTH = 6; // June

export function academicYearStart(now: Date = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 36e5);
  const y = ist.getUTCFullYear();
  return ist.getUTCMonth() + 1 >= ACADEMIC_YEAR_START_MONTH ? y : y - 1;
}

export function batchStartYear(batch: string | null | undefined) {
  const m = (batch ?? '').match(/(20\d{2})/);
  return m ? Number(m[1]) : null;
}

/** 1 for first year, 2 for second year, null when the batch label has no year. */
export function yearOfStudy(batch: string | null | undefined, now: Date = new Date()) {
  const start = batchStartYear(batch);
  if (start === null) return null;
  return academicYearStart(now) - start + 1;
}

export function yearLabel(year: number | null, programmeYears = 2) {
  if (year === null) return '—';
  if (year < 1) return 'Incoming';
  if (year > programmeYears) return 'Passed out';
  return year === 1 ? 'First year' : year === 2 ? 'Second year' : `Year ${year}`;
}
