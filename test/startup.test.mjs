import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('server started through the appliance release symlink listens and reports its version', { timeout: 15000 }, async t => {
  const temporary = mkdtempSync(join(tmpdir(), 'foldback-entry-'));
  const link = join(temporary, 'current');
  symlinkSync(fileURLToPath(new URL('../', import.meta.url)), link, 'dir');
  const child = spawn(process.execPath, [join(link, 'src/server.mjs')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', FOLDBACK_DATA_DIR: join(temporary, 'data'),
      FOLDBACK_TLS_CERT: '', FOLDBACK_TLS_KEY: '', FOLDBACK_DISPLAY_PORT: '', FOLDBACK_APPLIANCE: '0' },
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    rmSync(temporary, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = /http:\/\/localhost:(\d+)\/admin/.exec(output); if (match) resolve(Number(match[1])); });
    child.on('error', reject);
    child.once('exit', code => reject(new Error(`Server exited before listening: ${code}`)));
  });
  const result = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).ok, true);
});
