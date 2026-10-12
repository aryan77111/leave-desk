import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtPct, targetState } from './metrics.ts';

test('percent targets', () => {
  assert.equal(targetState(92, 90), 'met');
  assert.equal(targetState(90, 90), 'met');
  assert.equal(targetState(85.5, 90), 'close');
  assert.equal(targetState(79, 90), 'below');
  assert.equal(targetState(null, 90), 'none');
  assert.equal(targetState('100.0', 100), 'met');
});

test('rating targets', () => {
  assert.equal(targetState('4.25', 4, 'rating'), 'met');
  assert.equal(targetState(3.6, 4, 'rating'), 'close');
  assert.equal(targetState(3.2, 4, 'rating'), 'below');
});

test('percent formatting', () => {
  assert.equal(fmtPct(50), '50%');
  assert.equal(fmtPct('66.7'), '66.7%');
  assert.equal(fmtPct(null), '—');
});
