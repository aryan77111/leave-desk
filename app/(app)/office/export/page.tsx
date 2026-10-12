import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui/primitives';
import { addDays, todayLocal } from '@/lib/format';
import { requireViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Attendance export' };

export default async function ExportPage() {
  await requireViewer('office');
  const today = todayLocal();
  return (
    <>
      <PageHeader
        title="Attendance export"
        description="A spreadsheet of every session missed on approved leave, one row per student per session. Use it to mark approved leave in the attendance system."
      />
      <Card className="max-w-2xl">
        <form action="/office/export/csv" method="get" className="flex flex-col gap-5 px-5 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink-soft">Sessions from</span>
              <input type="date" name="from" required defaultValue={addDays(today, -30)} className="field-input" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink-soft">Sessions to</span>
              <input type="date" name="to" required defaultValue={today} className="field-input" />
            </label>
          </div>
          <p className="text-sm text-ink-muted">
            Columns: request, student ID, name, batch, section, course, session start, faculty, leave type and status. Provisional rows are medical leave still waiting for a checked certificate.
          </p>
          <div><button className="h-9 rounded bg-navy-700 px-3.5 text-sm font-semibold text-white hover:bg-navy-800">Download CSV</button></div>
        </form>
      </Card>
    </>
  );
}
