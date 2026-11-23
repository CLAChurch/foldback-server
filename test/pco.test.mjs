import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { PlanningCenter, connectionInfo, connectionConfig, CALLBACK_PATH } from '../src/pco.mjs';
import { displayState } from '../src/model.mjs';

const origin = 'https://foldback.example';
const configBody = method => ({ method, clientId: 'test-application', clientSecret: 'test-secret-never-return', contactEmail: 'operator@example.org' });
const organization = { data: { type: 'Organization', id: 'org-42', attributes: { name: 'Example Church', secret: 'upstream-secret-never-store' } } };
const tokens = { access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 7200, scope: 'services' };
function fixture(t, fetchImpl, now) {
  const directory = mkdtempSync(join(tmpdir(), 'foldback-pco-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  const pco = new PlanningCenter(store, { fetchImpl, now });
  return { directory, store, pco };
}

test('personal token verifies only Services, persists privately, and allowlists organization data', async t => {
  const calls = [];
  const { store, pco, directory } = fixture(t, async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify(organization));
  });
  pco.save(configBody('pat'), origin);
  const result = await pco.verify();
  assert.deepEqual(result.organization, { id: 'org-42', name: 'Example Church' });
  assert.ok(result.verifiedAt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.planningcenteronline.com/services/v2');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from('test-application:test-secret-never-return').toString('base64')}`);
  assert.match(calls[0].headers['User-Agent'], /operator@example.org/);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
  assert.ok(!JSON.stringify(displayState(store.state)).includes('test-secret'));
  assert.ok(!readFileSync(join(directory, 'state.json'), 'utf8').includes('upstream-secret'));
  assert.equal(connectionInfo(new Store(directory).state).configured, true);
});

test('credential replacement and validation do not silently mix two accounts', t => {
  const { pco, store } = fixture(t);
  pco.save(configBody('pat'), origin);
  const original = structuredClone(store.state.pco);
  pco.save({ ...configBody('pat'), clientId: '', clientSecret: '' }, origin);
  assert.deepEqual(store.state.pco, original);
  assert.throws(() => pco.save({ ...configBody('pat'), clientId: '', clientSecret: 'replacement' }, origin), /both/);
  assert.deepEqual(store.state.pco, original);
  assert.throws(() => connectionConfig({ ...configBody('pat'), contactEmail: 'bad\nheader@example.org' }, null, origin), /contact email/);
  assert.throws(() => connectionConfig({ ...configBody('pat'), clientId: 'contains:colon' }, null, origin), /Application ID/);
  assert.throws(() => connectionConfig({ ...configBody('pat'), clientSecret: 'secret\nheader' }, null, origin), /credential/);
  pco.disconnect();
  assert.equal(store.state.pco, null);
});

test('OAuth uses Services-only scope, PKCE, browser binding and single-use callback', async t => {
  const calls = [];
  const { pco, store } = fixture(t, async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify(tokens));
  });
  pco.save(configBody('oauth'), origin);
  const started = pco.start('admin-session', origin);
  const url = new URL(started.url);
  assert.equal(url.origin, 'https://api.planningcenteronline.com');
  assert.equal(url.searchParams.get('scope'), 'services');
  assert.equal(url.searchParams.get('redirect_uri'), origin + CALLBACK_PATH);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('client_secret'), false);
  const params = new URLSearchParams({ state: started.state, code: 'returned-code' });
  await assert.rejects(pco.callback(params, 'wrong-browser', () => true, origin), /did not match/);
  assert.equal(calls.length, 0);
  await pco.callback(params, started.state, token => token === 'admin-session', origin);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.planningcenteronline.com/oauth/token');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.grant_type, 'authorization_code');
  assert.equal(body.code, 'returned-code');
  assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.equal(store.state.pco.tokens.accessToken, tokens.access_token);
  assert.equal(connectionInfo(store.state).authorized, true);
  assert.ok(!JSON.stringify(connectionInfo(store.state)).includes(tokens.access_token));
  await assert.rejects(pco.callback(params, started.state, () => true, origin), /did not match/);
});

test('expired, cancelled and logged-out OAuth flows cannot exchange a code', async t => {
  let now = 100000;
  let calls = 0;
  const { pco } = fixture(t, async () => { calls++; throw new Error('Must not call provider'); }, () => now);
  pco.save(configBody('oauth'), origin);
  let started = pco.start('session', origin);
  let params = new URLSearchParams({ state: started.state, code: 'code' });
  await assert.rejects(pco.callback(params, started.state, () => false, origin), /expired/);
  now += 600001;
  await assert.rejects(pco.callback(params, started.state, () => true, origin), /expired/);
  started = pco.start('session', origin);
  params = new URLSearchParams({ state: started.state, error: 'access_denied', error_description: 'secret must not echo' });
  await assert.rejects(pco.callback(params, started.state, () => true, origin), /cancelled/);
  assert.equal(calls, 0);
});

test('settings changes and removal invalidate pending OAuth authorization', async t => {
  const { pco } = fixture(t);
  pco.save(configBody('oauth'), origin);
  let started = pco.start('session', origin);
  pco.save({ ...configBody('oauth'), clientId: 'another-application' }, origin);
  await assert.rejects(pco.callback(new URLSearchParams({ state: started.state, code: 'x' }), started.state, () => true, origin), /expired/);
  assert.throws(() => pco.start('session', 'https://other-address.example'), /registered callback address/);
  started = pco.start('session', origin);
  pco.disconnect();
  await assert.rejects(pco.callback(new URLSearchParams({ state: started.state, code: 'x' }), started.state, () => true, origin), /expired/);
});

test('OAuth refresh rotates and persists tokens even if later Services verification fails', async t => {
  let now = 100000;
  let failServices = false;
  const calls = [];
  const { pco, store, directory } = fixture(t, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth/token')) return new Response(JSON.stringify({ ...tokens, access_token: 'new-access', refresh_token: 'new-refresh' }));
    if (failServices) return new Response('secret upstream details', { status: 403 });
    return new Response(JSON.stringify(organization));
  }, () => now);
  pco.save(configBody('oauth'), origin);
  store.update(state => { state.pco.tokens = { accessToken: 'expired-access', refreshToken: 'old-refresh', expiresAt: now + 7200000 }; });
  await pco.verify();
  now += 7200000;
  failServices = true;
  await assert.rejects(pco.verify(), /rejected access/);
  assert.equal(store.state.pco.tokens.refreshToken, 'new-refresh');
  assert.equal(new Store(directory).state.pco.tokens.refreshToken, 'new-refresh');
  assert.equal(connectionInfo(store.state).verifiedAt, null);
  const refresh = calls.find(call => call.url.endsWith('/oauth/token'));
  assert.equal(JSON.parse(refresh.options.body).refresh_token, 'old-refresh');
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer new-access');
});

test('provider failures, invalid scopes and redirects never echo raw credential data', async t => {
  const { pco, store } = fixture(t, async () => { throw new Error('test-secret-never-return'); });
  pco.save(configBody('pat'), origin);
  await assert.rejects(pco.verify(), error => !error.message.includes('test-secret') && error.status === 502);
  pco.fetch = async () => new Response('test-secret-never-return', { status: 401 });
  await assert.rejects(pco.verify(), error => !error.message.includes('test-secret') && error.status === 400);
  assert.equal(store.state.pco.verifiedAt, null);
  assert.throws(() => pco.tokenResult({ ...tokens, scope: 'people' }), /usable Services/);
});
