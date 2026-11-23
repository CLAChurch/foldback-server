import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, createDisplayHandler } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { PcoFixture, SELECTION } from './fixtures/pco.mjs';

async function setup(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'foldback-test-'));
  const app = createApp({ directory, ...options });
  const server = http.createServer(app.handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const send = async (path, body, cookie = '', headers = {}) => {
    const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie'), headers: response.headers };
  };
  const auth = async () => {
    const result = await send('/api/auth/setup', { code: app.code, password: 'sample test password 123' });
    assert.equal(result.status, 200); return result.cookie.split(';')[0];
  };
  return { app, directory, send, auth, url };
}

test('first setup, password protection, CSRF rejection, logout and login', async t => {
  const { send, auth, url } = await setup(t);
  assert.equal((await send('/api/admin')).status, 401);
  assert.equal((await send('/api/demo/load', {})).status, 401);
  // Fetch normalizes Host. Exercise the actual HTTP header with the native client.
  const foreignPairing = await new Promise((resolve, reject) => {
    http.get(url + '/api/pairing', { headers: { Host: 'foreign.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(foreignPairing, 403);
  assert.equal((await send('/api/auth/setup', { code: 'wrong', password: 'password long enough' })).status, 403);
  const cookie = await auth();
  assert.equal((await send('/api/admin', undefined, cookie)).status, 200);
  assert.equal((await send('/api/demo/load', {}, cookie, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await send('/api/demo/load', {}, cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const display = await send('/api/display');
  assert.equal(display.status, 200); assert.equal(display.body.auth, undefined);
  assert.deepEqual((await send('/api/health')).body, { ok: true, version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version });
  assert.equal((await send('/api/auth/setup', { code: 'x', password: 'another password' })).status, 409);
  await send('/api/auth/logout', {}, cookie);
  assert.equal((await send('/api/admin', undefined, cookie)).status, 401);
  assert.equal((await send('/api/auth/login', { password: 'wrong' })).status, 401);
  const login = await send('/api/auth/login', { password: 'sample test password 123' });
  assert.equal(login.status, 200); assert.match(login.cookie, /HttpOnly/); assert.match(login.cookie, /SameSite=Strict/);
});

test('simultaneous first-setup requests cannot overwrite the campus password', async t => {
  const { send, app } = await setup(t);
  const results = await Promise.all([
    send('/api/auth/setup', { code: app.code, password: 'first valid sample password' }),
    send('/api/auth/setup', { code: app.code, password: 'second valid sample password' }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 429]);
  const winner = results.findIndex(result => result.status === 200);
  const password = winner === 0 ? 'first valid sample password' : 'second valid sample password';
  assert.equal((await send('/api/auth/login', { password })).status, 200);
});

test('settings, video overrides, item start and later edits survive server restart', async t => {
  const { send, auth, directory } = await setup(t); const cookie = await auth();
  const settings = { campus: 'Langley', output: 'propresenter', personMode: 'note', personNote: 'Host', networkPreference: 'wifi' };
  assert.equal((await send('/api/settings', settings, cookie)).status, 200);
  await send('/api/demo/load', {}, cookie);
  const before = (await send('/api/display')).body;
  await send('/api/overrides', { itemId: 'welcome', video: true, source: 'estimate' }, cookie);
  await send('/api/demo/duration', { itemId: 'closing', duration: 420 }, cookie);
  const after = (await send('/api/display')).body;
  assert.equal(after.service.liveStart, before.service.liveStart);
  assert.equal(after.overrides.welcome.video, true);
  const restarted = createApp({ directory }); t.after(restarted.close);
  assert.equal(restarted.store.state.service.liveStart, before.service.liveStart);
  assert.equal(restarted.store.state.settings.networkPreference, 'wifi');
  assert.equal(restarted.store.state.settings.output, 'propresenter');
  assert.equal(restarted.store.state.overrides['sample-abby:welcome'].video, true);
  const stored = readFileSync(join(directory, 'state.json'), 'utf8');
  assert.ok(!stored.includes('sample test password'));
  assert.equal(statSync(join(directory, 'state.json')).mode & 0o777, 0o600);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
});

test('updates stream independently of admin session and current item changes', async t => {
  const { send, auth, url } = await setup(t); const cookie = await auth();
  await send('/api/demo/load', {}, cookie);
  const controller = new AbortController(); t.after(() => controller.abort());
  const response = await fetch(url + '/api/events', { signal: controller.signal });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /"currentItemId":"welcome"/);
  await send('/api/demo/advance', { itemId: 'opening-song' }, cookie);
  assert.match(decoder.decode((await reader.read()).value), /"currentItemId":"opening-song"/);
  await send('/api/auth/logout', {}, cookie);
  assert.equal((await send('/api/display')).body.service.currentItemId, 'opening-song');
  controller.abort();
});

test('input validation is atomic; unknown items and invalid settings do not change state', async t => {
  const { send, auth, app } = await setup(t); const cookie = await auth();
  const original = structuredClone(app.store.state.settings);
  assert.equal((await send('/api/settings', { ...original, campus: 'Changed', output: 'invalid' }, cookie)).status, 400);
  assert.deepEqual(app.store.state.settings, original);
  await send('/api/demo/load', {}, cookie);
  assert.equal((await send('/api/demo/duration', { itemId: 'welcome', duration: -5 }, cookie)).status, 400);
  assert.equal((await send('/api/demo/advance', { itemId: 'missing' }, cookie)).status, 400);
  assert.equal((await send('/api/overrides', { itemId: 'welcome', video: 'yes', source: 'auto' }, cookie)).status, 400);
});

test('login throttling and password rotation revoke previous sessions', async t => {
  const { send, auth } = await setup(t); const cookie = await auth();
  const rotated = await send('/api/auth/password', { currentPassword: 'sample test password 123', password: 'new sample test password 456' }, cookie);
  assert.equal(rotated.status, 200);
  assert.equal((await send('/api/admin', undefined, cookie)).status, 401);
  for (let i = 0; i < 7; i++) assert.equal((await send('/api/auth/login', { password: 'wrong' })).status, 401);
  assert.equal((await send('/api/auth/login', { password: 'wrong' })).status, 429);
});

test('corrupt persisted state is not silently discarded', () => {
  const directory = mkdtempSync(join(tmpdir(), 'foldback-corrupt-'));
  try {
    const store = new Store(directory); store.save({ ...store.state, version: 99 });
    assert.throws(() => new Store(directory), /Unsupported state/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Planning Center setup is optional, password protected, private and saved per installation', async t => {
  const requests = [];
  const { send, auth, directory, url } = await setup(t, { pcoFetch: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ data: { type: 'Organization', id: 'test-org', attributes: { name: 'Test Church', secret: 'provider-organization-secret' } } }));
  } });
  const credentials = { method: 'pat', clientId: 'test-app-id', clientSecret: 'private-pco-test-secret', contactEmail: 'admin@example.org' };
  assert.equal((await send('/api/pco/save', credentials)).status, 401);
  const cookie = await auth();
  assert.equal((await send('/api/pco/defer', {}, cookie)).body.pco.deferred, true);
  let result = await send('/api/pco/save', credentials, cookie);
  assert.equal(result.status, 200);
  assert.equal(result.body.pco.configured, true);
  assert.equal(result.body.pco.deferred, false);
  assert.equal(result.body.pco.verifiedAt, null);
  result = await send('/api/pco/test', {}, cookie);
  assert.equal(result.status, 200);
  assert.equal(result.body.pco.organization.name, 'Test Church');
  assert.equal(requests[0].options.method, 'GET');
  for (const path of ['/api/admin', '/api/display']) {
    const value = await send(path, undefined, cookie);
    assert.ok(!JSON.stringify(value.body).includes('private-pco-test-secret'));
    assert.ok(!JSON.stringify(value.body).includes('provider-organization-secret'));
  }
  assert.equal((await send('/data/state.json')).status, 404);
  assert.equal((await send('/src/pco.mjs')).status, 404);
  assert.equal(new Store(directory).state.pco.clientSecret, credentials.clientSecret);
  // A loopback TCP connection alone cannot permit secret entry through a hostile hostname.
  const foreign = await new Promise((resolve, reject) => {
    const request = http.request(url + '/api/pco/save', { method: 'POST', headers: { Host: 'foreign.example', Cookie: cookie, 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end(JSON.stringify(credentials));
  });
  assert.equal(foreign, 403);
  await send('/api/pco/disconnect', {}, cookie);
  assert.equal((await send('/api/admin', undefined, cookie)).body.pco.configured, false);
  assert.equal(new Store(directory).state.pco, null);
});

test('OAuth callback binds to initiating browser and session without requiring cross-site Strict cookie', async t => {
  const calls = [];
  const { send, auth, url } = await setup(t, { pcoFetch: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.endsWith('/oauth/token')
      ? { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 7200, token_type: 'bearer', scope: 'services' }
      : { data: { type: 'Organization', id: 'org', attributes: { name: 'OAuth Test Church' } } }));
  } });
  const cookie = await auth();
  await send('/api/pco/save', { method: 'oauth', clientId: 'test-oauth-id', clientSecret: 'test-oauth-secret', contactEmail: 'admin@example.org' }, cookie);
  const started = await send('/api/pco/authorize', {}, cookie);
  const state = new URL(started.body.authorizeUrl).searchParams.get('state');
  assert.match(started.cookie, /SameSite=Lax/);
  const callback = `${url}/auth/pco/callback?state=${encodeURIComponent(state)}&code=test-code`;
  const noBinding = await fetch(callback, { redirect: 'manual' });
  assert.equal(noBinding.status, 400); assert.equal(calls.length, 0);
  const response = await fetch(callback, { redirect: 'manual', headers: { Cookie: started.cookie.split(';')[0] } });
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/admin#connections');
  assert.equal(calls.length, 2);
  const info = (await send('/api/admin', undefined, cookie)).body.pco;
  assert.equal(info.organization.name, 'OAuth Test Church');
  assert.ok(info.verifiedAt);
  const replay = await fetch(callback, { redirect: 'manual', headers: { Cookie: started.cookie.split(';')[0] } });
  assert.equal(replay.status, 400);
});

test('loopback kiosk listener serves display data but no admin or credential routes', async t => {
  const { app } = await setup(t);
  const server = http.createServer(createDisplayHandler(app.handler));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + '/display')).status, 200);
  assert.equal((await fetch(origin + '/api/display')).status, 200);
  assert.equal((await fetch(origin + '/api/pairing')).status, 200);
  for (const path of ['/admin', '/api/admin', '/api/auth/status', '/ca.crt', '/auth/pco/callback', '/data/state.json']) {
    assert.equal((await fetch(origin + path)).status, 404);
  }
  assert.equal((await fetch(origin + '/api/auth/setup', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await fetch(origin + '/api/display', { method: 'POST', body: '{}' })).status, 404);
});

test('authenticated PCO catalogs/selection drive the public display independently of producer login', async t => {
  const fixture = new PcoFixture();
  const { send, auth, app, directory } = await setup(t, { pcoFetch: fixture.fetch, pcoNow: () => fixture.now, pcoAutomatic: false });
  assert.equal((await send('/api/pco/service-types', {})).status,401);
  const cookie=await auth();
  await send('/api/pco/save',{method:'pat',clientId:'fixture-id',clientSecret:'fixture-private-credential',contactEmail:'fixture@example.org'},cookie);
  await send('/api/pco/test',{},cookie);
  assert.deepEqual((await send('/api/pco/service-types',{},cookie)).body.choices,[{id:'10',name:'Fixture campus'}]);
  assert.equal((await send('/api/pco/plans',{serviceTypeId:'10'},cookie)).body.choices[0].id,'20');
  assert.deepEqual((await send('/api/pco/times',{serviceTypeId:'10',planId:'20'},cookie)).body.choices.map(time=>time.id),['30','31']);
  assert.equal((await send('/api/pco/select',SELECTION,cookie,{Origin:'https://foreign.example'})).status,403);
  const selected=await send('/api/pco/select',SELECTION,cookie);assert.equal(selected.status,200);assert.equal(selected.body.service.source,'pco');
  assert.equal((await send('/api/demo/advance',{itemId:'1'},cookie)).status,409);
  assert.equal((await send('/api/demo/load',{},cookie)).status,409);
  await send('/api/auth/logout',{},cookie);
  fixture.advance('302',fixture.now-10000);await app.live.poll();
  const display=await send('/api/display');assert.equal(display.body.service.currentItemId,'2');assert.equal(display.body.people['2'],'Leader Early');
  assert.ok(!JSON.stringify(display.body).includes('fixture-private'));
  assert.equal(JSON.parse(readFileSync(join(directory,'state.json'))).pcoSelection.timeId,'30');
  assert.ok(fixture.calls.every(call=>call.options.method==='GET'));
  const login=await send('/api/auth/login',{password:'sample test password 123'});const again=login.cookie.split(';')[0];
  assert.equal((await send('/api/pco/stop',{},again)).body.service,null);
  assert.equal((await send('/api/demo/load',{},again)).status,200);
});
