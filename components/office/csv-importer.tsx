'use client';
import { useRef, useState, useTransition } from 'react';
import Papa from 'papaparse';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { toPeopleRows, toSessionRows } from '@/lib/csv';
import type { ImportResult } from '@/app/(app)/office/actions';

type Kind = 'people' | 'sessions';

const TEMPLATES: Record<Kind, { file: string; header: string[]; sample: string[][] }> = {
  people: {
    file: 'leave-desk-people-template.csv',
    header: ['email', 'full_name', 'roles', 'student_no', 'programme', 'batch', 'section'],
    sample: [
      ['student.name@college.edu', 'Student Name', 'student', 'UH25001', 'MBA-HRM', '2025-27', 'A'],
      ['faculty.name@college.edu', 'Dr. Faculty Name', 'faculty', '', '', '', ''],
      ['dean@college.edu', 'Dean Name', 'dean', '', '', '', ''],
      ['deanhrm.office@college.edu', 'Dean HRM Office Staff', 'office', '', '', '', ''],
    ],
  },
  sessions: {
    file: 'leave-desk-timetable-template.csv',
    header: ['date', 'start_time', 'end_time', 'course_code', 'course_name', 'faculty_email', 'batch', 'section'],
    sample: [
      ['2026-10-13', '09:45', '11:15', 'INHRM', 'International HRM', 'faculty.name@college.edu', '2025-27', 'A'],
      ['2026-10-13', '11:30', '13:00', 'PICM', '', 'faculty.name@college.edu', '2025-27', 'A'],
    ],
  },
};

export function CsvImporter({ kind, onImport }: { kind: Kind; onImport: (rows: Record<string, string>[]) => Promise<ImportResult> }) {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const t = TEMPLATES[kind];

  function load(file: File | undefined) {
    setResult(null);
    setParseError(null);
    setRows(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setParseError('The file is larger than 5 MB.'); return; }
    setFileName(file.name);
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const mapped = kind === 'people' ? toPeopleRows(res.data) : toSessionRows(res.data);
        if (mapped.length === 0) { setParseError('No usable rows found. Check the column headings against the template.'); return; }
        setRows(mapped);
      },
      error: () => setParseError('The file could not be read. Save it as CSV (comma separated) and try again.'),
    });
  }

  function downloadTemplate() {
    const csv = [t.header, ...t.sample].map((r) => r.join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: t.file });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const cols = t.header;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" type="button" onClick={() => input.current?.click()}><Upload className="h-4 w-4" />Choose CSV file</Button>
        <Button variant="ghost" type="button" onClick={downloadTemplate}><Download className="h-4 w-4" />Download template</Button>
        <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={(e) => { load(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {parseError && <p role="alert" className="text-sm text-bad-fg">{parseError}</p>}

      {rows && !result && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft"><span className="font-semibold text-ink">{fileName}</span>: {rows.length} row{rows.length === 1 ? '' : 's'} ready. First rows:</p>
          <div className="overflow-x-auto rounded border border-line">
            <table className="data-table">
              <thead><tr>{cols.map((c) => <th key={c}>{c.replace(/_/g, ' ')}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="whitespace-nowrap">{r[c] ?? ''}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button disabled={pending} onClick={() => start(async () => setResult(await onImport(rows)))}>
              {pending ? 'Importing…' : `Import ${rows.length} row${rows.length === 1 ? '' : 's'}`}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setRows(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          {result.error ? (
            <p role="alert" className="text-sm text-bad-fg">{result.error}</p>
          ) : (
            <p role="status" className="text-sm text-ink">
              <span className="font-semibold text-ok-fg">{result.inserted ?? 0} added, {result.updated ?? 0} updated.</span>
              {result.errors && result.errors.length > 0 && <span className="text-bad-fg"> {result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped:</span>}
            </p>
          )}
          {result.errors && result.errors.length > 0 && (
            <div className="max-h-72 overflow-auto rounded border border-bad-line">
              <table className="data-table">
                <thead><tr><th>Row</th>{kind === 'people' && <th>Email</th>}<th>Problem</th></tr></thead>
                <tbody>
                  {result.errors.map((e) => (
                    <tr key={e.row}><td className="tabular-nums">{e.row + 1}</td>{kind === 'people' && <td>{e.email}</td>}<td className="text-bad-fg">{e.message}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div><Button variant="secondary" onClick={() => { setResult(null); setRows(null); }}>Import another file</Button></div>
        </div>
      )}
    </div>
  );
}
