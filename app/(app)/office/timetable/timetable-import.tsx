'use client';
import { CsvImporter } from '@/components/office/csv-importer';
import { importSessions } from '../actions';

export function TimetableImport() {
  return <CsvImporter kind="sessions" onImport={importSessions} />;
}
