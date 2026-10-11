// Reads the Dean HRM Office class-schedule sheet into Leave Desk sessions.
//
// Sheet layout (as used by XIM's HRM schedules):
//   a header row whose first cell is "Date"; the other header cells name time slots,
//   e.g. "09:45AM-\n11:15AM" or "QUIZ\n01:50PM- 02:25PM";
//   then one row per day: a date in the first column and, under each slot, the classes held,
//   one per line, as COURSE_<section or faculty initials><session no.>, e.g. "TAMA_A12", "DTHR_SB3", "STHR_RGP_4",
//   or a plain number for courses taught to the whole batch, e.g. "MDI_7".
//   A quiz is written as the course code followed by "Quiz <n>", e.g. "FRAN\nQuiz 1".
// Anything else in a slot (Reserve, holidays, exams, events) is noted and skipped.
//
// This file has no runtime dependencies so it can be unit tested with Node and deployed with the edge function.

export type Cell = string | number | boolean | Date | null | undefined;

export type CourseCode = {
  course_code: string;
  variant: string; // '' for the whole batch; otherwise a section letter or faculty initials
  course_name: string;
  faculty_id: string;
  sections: string[];
  elective: boolean;
};

export type SessionRow = {
  date: string; // YYYY-MM-DD
  start: string; // HH:MM, 24h
  end: string | null;
  code: string;
  name: string;
  faculty_id: string;
  section: string;
  elective: boolean;
};

export type Problem = { date: string; start: string; text: string; reason: string };

export type ParseResult = {
  sessions: SessionRow[];
  unreadable: Problem[]; // looked like a class but could not be matched; that slot is protected
  skipped: string[]; // distinct non-class texts, e.g. "Gandhi Jayanti"
  firstDate: string | null;
  lastDate: string | null;
};

const pad = (n: number) => String(n).padStart(2, '0');

function toIsoDate(v: Cell): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // SheetJS (cellDates) gives midnight in the runtime's zone; edge functions run in UTC.
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  }
  return null;
}

/** "09:45AM-\n11:15AM", "QUIZ 01:50PM- 02:25PM", "14:30-16:00" → ["09:45", "11:15"] */
export function parseSlot(header: Cell): [string, string] | null {
  if (typeof header !== 'string') return null;
  const times = [...header.toUpperCase().matchAll(/(\d{1,2})[:.](\d{2})\s*([AP]\.?M\.?)?/g)];
  if (times.length < 2) return null;
  const conv = (t: RegExpMatchArray, fallbackPm: boolean) => {
    let h = Number(t[1]);
    const ap = t[3]?.replace(/\./g, '');
    if (ap === 'PM' && h !== 12) h += 12;
    else if (ap === 'AM' && h === 12) h = 0;
    else if (!ap && fallbackPm && h < 8) h += 12;
    return `${pad(h)}:${t[2]}`;
  };
  const start = conv(times[0], true);
  let end = conv(times[1], true);
  if (end <= start && !times[1][3]) end = `${pad(Number(end.slice(0, 2)) + 12)}${end.slice(2)}`;
  return [start, end];
}

const isHeader = (row: Cell[] | undefined) => !!row && typeof row[0] === 'string' && row[0].trim().toLowerCase() === 'date';

export function parseSheet(grid: Cell[][], codes: CourseCode[]): ParseResult {
  const headerIdx = grid.findIndex(isHeader);
  if (headerIdx < 0) throw new Error('Could not find the header row. The first column should have a cell that says "Date".');
  const header = grid[headerIdx];
  const slots = new Map<number, [string, string]>();
  header.forEach((h, i) => {
    if (i === 0) return;
    const s = parseSlot(h);
    if (s) slots.set(i, s);
  });
  if (slots.size === 0) throw new Error('Could not read any time slots from the header row.');

  const byCode = new Map<string, CourseCode[]>();
  for (const c of codes) {
    const k = c.course_code.toUpperCase();
    byCode.set(k, [...(byCode.get(k) ?? []), c]);
  }
  for (const list of byCode.values()) list.sort((a, b) => b.variant.length - a.variant.length);
  const batchSections = [...new Set(codes.flatMap((c) => c.sections))].sort();

  const sessions: SessionRow[] = [];
  const seen = new Set<string>();
  const unreadable: Problem[] = [];
  const skipped = new Set<string>();
  let firstDate: string | null = null;
  let lastDate: string | null = null;

  const push = (date: string, slot: [string, string], c: CourseCode, section: string, name = c.course_name) => {
    const key = `${section}|${c.course_code}|${date}|${slot[0]}`;
    if (seen.has(key)) return;
    seen.add(key);
    sessions.push({ date, start: slot[0], end: slot[1], code: c.course_code.toUpperCase(), name, faculty_id: c.faculty_id, section, elective: c.elective });
  };

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    if (isHeader(row)) break; // a second table further down
    const date = toIsoDate(row[0]);
    if (!date) continue;
    if (!firstDate || date < firstDate) firstDate = date;
    if (!lastDate || date > lastDate) lastDate = date;

    for (const [col, slot] of slots) {
      const raw = row[col];
      if (raw === null || raw === undefined || raw === '') continue;
      const text = String(raw).trim();
      if (!text) continue;
      const problem = (reason: string, piece = text) => unreadable.push({ date, start: slot[0], text: piece, reason });

      // Quiz for the whole batch: "FRAN\nQuiz 1"
      const quiz = text.match(/^([A-Za-z][A-Za-z0-9]{1,9})[\s/_-]+(quiz\s*\d*)$/i);
      if (quiz) {
        const list = byCode.get(quiz[1].toUpperCase());
        if (!list) { problem(`Unknown course code ${quiz[1].toUpperCase()}`); continue; }
        const label = quiz[2].replace(/\s+/g, ' ').replace(/^quiz/i, 'Quiz');
        for (const sec of batchSections) {
          const c = list.find((x) => x.sections.includes(sec));
          if (c) push(date, slot, c, sec, `${c.course_name} (${label})`);
        }
        continue;
      }

      for (const piece0 of text.split(/[\n/,;]+/)) {
        const piece = piece0.trim();
        if (!piece) continue;
        const m = piece.match(/^([A-Za-z][A-Za-z0-9]{1,9})\s*[_-]\s*([A-Za-z0-9_ -]*)$/);
        const bare = byCode.has(piece.toUpperCase()) ? piece.toUpperCase() : null;
        if (!m && !bare) { skipped.add(piece.replace(/\s+/g, ' ')); continue; }
        const code = (m ? m[1] : bare!).toUpperCase();
        const rest = m ? m[2].toUpperCase().replace(/[\s-]/g, '') : '';
        const list = byCode.get(code);
        if (!list) {
          // Class entries carry a session number; "Mid-Term" and the like are just notes.
          if (/\d/.test(rest)) problem(`Unknown course code ${code}. Add it under Course codes.`, piece);
          else skipped.add(piece.replace(/\s+/g, ' '));
          continue;
        }
        const c =
          list.find((x) => x.variant !== '' && rest.startsWith(x.variant) && /^(\d|_|$)/.test(rest.slice(x.variant.length))) ??
          list.find((x) => x.variant === '');
        if (!c) { problem(`No section or faculty set up for ${piece}. Add it under Course codes.`, piece); continue; }
        for (const sec of c.sections) push(date, slot, c, sec);
      }
    }
  }

  sessions.sort((a, b) => (a.date + a.start + a.section + a.code).localeCompare(b.date + b.start + b.section + b.code));
  return { sessions, unreadable, skipped: [...skipped].sort(), firstDate, lastDate };
}
