// Turns spreadsheet rows (any header spelling) into the shapes the import functions expect.

const norm = (h: string) => h.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const PEOPLE_ALIASES: Record<string, string> = {
  email: 'email', email_address: 'email', mail: 'email',
  name: 'full_name', full_name: 'full_name', student_name: 'full_name', faculty_name: 'full_name',
  role: 'roles', roles: 'roles',
  student_id: 'student_no', student_no: 'student_no', roll_no: 'student_no', roll_number: 'student_no', id_number: 'student_no',
  programme: 'programme', program: 'programme',
  batch: 'batch', section: 'section', sec: 'section',
  approver_level: 'approver_level', level: 'approver_level',
};

const SESSION_ALIASES: Record<string, string> = {
  date: 'date', session_date: 'date',
  start: 'start_time', start_time: 'start_time', from: 'start_time', time: 'start_time',
  end: 'end_time', end_time: 'end_time', to: 'end_time',
  course: 'course_code', course_code: 'course_code', code: 'course_code',
  course_name: 'course_name', title: 'course_name',
  faculty_email: 'faculty_email', faculty: 'faculty_email', email: 'faculty_email',
  batch: 'batch', section: 'section', sec: 'section',
  cancelled: 'cancelled', canceled: 'cancelled',
};

export const PEOPLE_COLUMNS = ['email', 'full_name', 'roles', 'student_no', 'programme', 'batch', 'section'] as const;
export const SESSION_COLUMNS = ['date', 'start_time', 'end_time', 'course_code', 'course_name', 'faculty_email', 'batch', 'section'] as const;

function remap(rows: Record<string, unknown>[], aliases: Record<string, string>) {
  return rows
    .map((row) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        const key = aliases[norm(k)];
        if (key && v !== null && v !== undefined && String(v).trim() !== '') out[key] = String(v).trim();
      }
      return out;
    })
    .filter((r) => Object.keys(r).length > 0);
}

export function toPeopleRows(rows: Record<string, unknown>[]) {
  return remap(rows, PEOPLE_ALIASES);
}

/** Accepts DD/MM/YYYY, DD-MM-YYYY or YYYY-MM-DD dates and 9:45 / 09:45 / 9.45 AM times. */
export function toSessionRows(rows: Record<string, unknown>[]): Record<string, string>[] {
  return remap(rows, SESSION_ALIASES).map((r) => ({
    ...r,
    date: r.date ? normalizeDate(r.date) : r.date,
    start_time: r.start_time ? normalizeTime(r.start_time) : r.start_time,
    end_time: r.end_time ? normalizeTime(r.end_time) : r.end_time,
  }));
}

export function normalizeDate(s: string) {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return t;
}

export function normalizeTime(s: string) {
  const t = s.trim().toUpperCase();
  const m = t.match(/^(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*(AM|PM)?$/);
  if (!m) return t;
  let h = Number(m[1]);
  if (m[3] === 'PM' && h < 12) h += 12;
  if (m[3] === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Neutralise spreadsheet formulas and quote when needed.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
