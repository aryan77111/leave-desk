/** Accepts a Google Sheets or Drive link, or a bare file id, and returns the file id. */
export function extractFileId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/) ?? s.match(/[?&]id=([A-Za-z0-9_-]{20,})/) ?? s.match(/^([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : null;
}

export const sheetUrl = (fileId: string) => `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
