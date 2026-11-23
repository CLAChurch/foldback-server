import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { physicalOutputs } from '../src/hardware.mjs';

test('physical display inventory accepts only connector names and connection status', t => {
  const directory = mkdtempSync(join(tmpdir(), 'foldback-output-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'outputs.json');
  assert.deepEqual(physicalOutputs(path), []);
  writeFileSync(path, JSON.stringify([{ name: 'HDMI-1', connected: true, private: 'omit' }, { name: 'DP-1', connected: false }, { name: 'invalid;command', connected: true }]));
  assert.deepEqual(physicalOutputs(path), [{ name: 'HDMI-1', connected: true }, { name: 'DP-1', connected: false }]);
});
