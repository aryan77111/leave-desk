import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFileId } from './sheet-link.ts';

test('reads the file id from the links people paste', () => {
  const id = '1bp3Hq7Qx4zK0njWRf9en2Z34JltJdown';
  assert.equal(extractFileId(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing&ouid=1&rtpof=true&sd=true`), id);
  assert.equal(extractFileId(`https://drive.google.com/file/d/${id}/view?usp=drivesdk`), id);
  assert.equal(extractFileId(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(extractFileId(`  ${id} `), id);
  assert.equal(extractFileId('https://docs.google.com/spreadsheets/'), null);
  assert.equal(extractFileId('timetable'), null);
});
