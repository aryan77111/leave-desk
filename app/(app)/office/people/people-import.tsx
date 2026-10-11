'use client';
import { CsvImporter } from '@/components/office/csv-importer';
import { importPeople } from '../actions';

export function PeopleImport() {
  return <CsvImporter kind="people" onImport={importPeople} />;
}
