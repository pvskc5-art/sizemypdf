/* The endpoint is public, so the validation is the only thing standing between
   the dataset and arbitrary strings. A rejected key and an accepted key both
   answer 204, which is correct behaviour but untestable through the handler -
   so the parser is asserted directly. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKey, SCHEMA, COLUMNS } from '../src/index.js';

const VALID_COMPRESS =
  'compress|engine=worker|kept=text|mode=target|outcome=hit|target=101-200|took=2-5s';
const VALID_BATCH =
  'batch|engine=main|failed=no|files=2-5|over=no|target=201-500|took=5-15s';

test('accepts the keys the client actually emits', () => {
  const c = parseKey(VALID_COMPRESS);
  assert.equal(c.event, 'compress');
  assert.deepEqual(c.fields, {
    engine: 'worker', kept: 'text', mode: 'target',
    outcome: 'hit', target: '101-200', took: '2-5s'
  });

  const b = parseKey(VALID_BATCH);
  assert.equal(b.event, 'batch');
  assert.equal(b.fields.files, '2-5');

  // the bare event, and the already-under path
  assert.equal(parseKey('compress').event, 'compress');
  assert.equal(
    parseKey('compress|kept=text|mode=target|outcome=already-under|target=na|took=<1s')
      .fields.outcome,
    'already-under'
  );
});

test('rejects anything outside the vocabulary', () => {
  const bad = [
    ['unknown event', 'ocr|took=<1s'],
    ['empty string', ''],
    ['field not in this event', 'compress|files=2-5'],
    ['batch field on compress', 'batch|mode=target'],
    ['value not in vocabulary', 'compress|outcome=amazing'],
    ['bucket from the wrong vocabulary', 'compress|target=<1s'],
    ['injected sql', "compress|mode=target'; DROP TABLE--"],
    ['html', 'compress|mode=<script>alert(1)</script>'],
    ['no equals sign', 'compress|mode'],
    ['empty field name', 'compress|=target'],
    ['repeated field', 'compress|mode=target|mode=lossless'],
    ['trailing separator', 'compress|'],
    ['case mismatch', 'compress|outcome=HIT'],
    ['whitespace padded', 'compress|outcome= hit'],
    ['over-long key', 'compress|mode=' + 'a'.repeat(300)],
    ['not a string', 12345],
    ['null', null],
    ['undefined', undefined]
  ];
  for (const [why, key] of bad) {
    assert.equal(parseKey(key), null, 'should have rejected: ' + why);
  }
});

test('every schema field has a blob column, or it would be silently dropped', () => {
  for (const [event, spec] of Object.entries(SCHEMA)) {
    for (const field of Object.keys(spec)) {
      assert.ok(
        COLUMNS.includes(field),
        `${event}.${field} is in SCHEMA but missing from COLUMNS`
      );
    }
  }
  // one index + event blob + the columns, against the 20-blob ceiling
  assert.ok(COLUMNS.length + 1 <= 20, 'too many blobs for Analytics Engine');
});
