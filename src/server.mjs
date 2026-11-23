import http from 'node:http';
import https from 'node:https';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { Store } from './store.mjs';
import { Sessions, pairingCode, hashPassword, verifyPassword } from './auth.mjs';
import { displayState, overrideKey, sampleService } from './model.mjs';
import { PlanningCenter, connectionInfo, CALLBACK_PATH } from './pco.mjs';
import { physicalOutputs } from './hardware.mjs';
import { LiveSync } from './pco-live.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const appVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, maximum = 120) => typeof value === 'string' && value.trim().length <= maximum ? value.trim() : fail(400, 'Invalid text value.');
const choice = (value, choices) => choices.includes(value) ? value : fail(400, 'Invalid setting.');
const loopback = request => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
const localHost = request => /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(request.headers.host || '');

export function createDisplayHandler(handler) {
  const paths = new Set(['/display', '/display.css', '/display.mjs', '/stage.mjs', '/lib/model.mjs', '/fonts/AtkinsonHyperlegibleNext.ttf', '/api/display', '/api/pairing', '/api/events', '/api/health']);
  return (request, response) => {
    let path;
    try { path = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400); response.end(); return; }
    if (request.method !== 'GET' || !paths.has(path)) { response.writeHead(404); response.end(); return; }
    return handler(request, response);
  };
}

export function createApp({ directory = process.env.FOLDBACK_DATA_DIR || join(root, 'data'), secure = false, pcoFetch, pcoNow, pcoAutomatic = true } = {}) {
  const store = new Store(directory);
  const sessions = new Sessions();
  const pco = new PlanningCenter(store, { fetchImpl: pcoFetch, now: pcoNow });
  const code = pairingCode();
  const clients = new Set();
  const attempts = new Map();
  let hashing = false;
  const status = () => ({ configured: Boolean(store.state.auth), serverTime: Date.now() });
  const adminState = () => ({
    settings: store.state.settings, service: store.state.service, overrides: store.state.overrides,
    view: displayState(store.state),
    pco: connectionInfo(store.state),
    pcoLive: live.info(),
    system: { appliance: process.env.FOLDBACK_APPLIANCE === '1', outputs: physicalOutputs() },
    integrations: { pco: 'Read-only plan selection and PCO Live synchronization', propresenter: 'Current Mac/Windows releases; awaiting campus connection and routing test' },
  });
  const publish = () => {
    const event = `event: state\ndata: ${JSON.stringify(displayState(store.state))}\n\n`;
    for (const client of clients) {
      if (client.writableLength > 256000) { client.destroy(); clients.delete(client); }
      else client.write(event);
    }
  };
  const heartbeat = setInterval(publish, 10000);
  heartbeat.unref();
  const live = new LiveSync(store, pco, { publish, ...(pcoNow ? { now: pcoNow } : {}), automatic: pcoAutomatic });
  const json = (response, data, statusCode = 200, headers = {}) => {
    response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    response.end(JSON.stringify(data));
  };
  const cookie = (token, age = 43200) => `foldback_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const oauthCookie = (state, age = 600) => `foldback_pco_oauth=${state}; HttpOnly; SameSite=Lax; Path=${CALLBACK_PATH}; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const originOf = request => {
    try {
      const origin = new URL(`${secure ? 'https' : 'http'}://${request.headers.host}`);
      if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) fail(400, 'Invalid server address.');
      return origin.origin;
    } catch { fail(400, 'Invalid server address.'); }
  };
  const requirePrivateTransport = request => {
    if (!secure && !(loopback(request) && localHost(request))) fail(403, 'Use HTTPS or open the control panel on the server itself to set up Planning Center.');
  };
  const readBody = async request => {
    if (!request.headers['content-type']?.startsWith('application/json')) fail(415, 'Send JSON.');
    let body = '';
    for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 32768) fail(413, 'Request too large.'); }
    try { const value = JSON.parse(body); if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Invalid request.'); return value; }
    catch { fail(400, 'Invalid JSON.'); }
  };
  const limitAuth = request => {
    const now = Date.now();
    for (const [ip, entry] of attempts) if (entry.until < now) attempts.delete(ip);
    const ip = request.socket.remoteAddress;
    const entry = attempts.get(ip) ?? { count: 0, until: now + 15 * 60000 };
    if (entry.count >= 8 || attempts.size > 1000) fail(429, 'Too many attempts. Try again in 15 minutes.');
    entry.count++;
    attempts.set(ip, entry);
  };
  const files = new Map([
    ['/', ['public/index.html', 'text/html']], ['/admin', ['public/index.html', 'text/html']],
    ['/display', ['public/display.html', 'text/html']],
    ...['app.mjs', 'pco.mjs', 'service-picker.mjs', 'stage.mjs', 'display.mjs', 'styles.css', 'display.css'].map(name => [`/${name}`, [`public/${name}`, name.endsWith('.css') ? 'text/css' : 'text/javascript']]),
    ['/lib/model.mjs', ['src/model.mjs', 'text/javascript']],
    ['/fonts/AtkinsonHyperlegibleNext.ttf', ['public/fonts/AtkinsonHyperlegibleNext.ttf', 'font/ttf']],
  ]);

  const handler = async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'");
    try {
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname;
      if (request.method === 'GET') {
        if (path === '/api/health') return json(response, { ok: true, version: appVersion });
        if (path === '/ca.crt' && process.env.FOLDBACK_CA_CERT) {
          response.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="foldback-campus-ca.crt"' });
          return response.end(readFileSync(process.env.FOLDBACK_CA_CERT));
        }
        if (path === CALLBACK_PATH) {
          requirePrivateTransport(request);
          const binding = /(?:^|;\s*)foldback_pco_oauth=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
          try {
            await live.manual(async () => {
              await pco.callback(url.searchParams, binding, token => sessions.validToken(token), originOf(request));
              // A completed sign-in is distinct from proof that Services is accessible.
              await pco.verify();
            });
            publish();
            response.writeHead(303, { Location: '/admin#connections', 'Set-Cookie': oauthCookie('', 0) });
            return response.end();
          } catch (error) {
            response.writeHead(error.status || 502, { 'Content-Type': 'text/plain; charset=utf-8', 'Set-Cookie': oauthCookie('', 0) });
            return response.end(`${error.status ? error.message : 'Planning Center sign-in failed.'}\n\nReturn to /admin#connections to try again.`);
          }
        }
        if (path === '/api/auth/status') return json(response, { ...status(), loggedIn: sessions.valid(request) });
        if (path === '/api/display') return json(response, displayState(store.state));
        if (path === '/api/pairing') {
          if (!loopback(request) || !localHost(request)) fail(403, 'Read the pairing code on the server screen.');
          return json(response, { code: store.state.auth ? null : code });
        }
        if (path === '/api/events') {
          if (clients.size >= 100) fail(503, 'Too many displays connected.');
          response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
          clients.add(response);
          request.on('close', () => clients.delete(response));
          response.write(`retry: 2000\nevent: state\ndata: ${JSON.stringify(displayState(store.state))}\n\n`);
          return;
        }
        if (path === '/api/admin') {
          if (!sessions.valid(request)) fail(401, 'Please log in.');
          return json(response, adminState());
        }
        const file = files.get(path);
        if (!file) fail(404, 'Not found.');
        const content = readFileSync(join(root, file[0]));
        response.writeHead(200, { 'Content-Type': `${file[1]}${file[1].startsWith('text/') ? '; charset=utf-8' : ''}` });
        return response.end(content);
      }
      if (request.method !== 'POST') fail(405, 'Method not allowed.');
      // JSON alone is insufficient: also reject foreign browser origins and cross-site requests.
      if (request.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Cross-site request rejected.');
      if (request.headers.origin) {
        const expected = `${secure ? 'https' : 'http'}://${request.headers.host}`;
        if (request.headers.origin !== expected) fail(403, 'Cross-site request rejected.');
      }
      if (path === '/api/auth/setup' || path === '/api/auth/login') {
        limitAuth(request);
        if (hashing) fail(429, 'Another login is in progress. Try again shortly.');
        hashing = true;
        try {
          const body = await readBody(request);
          if (path.endsWith('/setup')) {
            if (store.state.auth) fail(409, 'This server is already set up.');
            if (body.code !== code) fail(403, 'Pairing code does not match.');
            const auth = await hashPassword(body.password);
            store.update(state => { state.auth = auth; });
          } else if (!(await verifyPassword(body.password, store.state.auth))) fail(401, 'Password does not match.');
          attempts.delete(request.socket.remoteAddress);
          publish();
          return json(response, { ok: true }, 200, { 'Set-Cookie': cookie(sessions.create()) });
        } finally { hashing = false; }
      }
      if (!sessions.valid(request)) fail(401, 'Please log in.');
      const body = await readBody(request);
      if (path.startsWith('/api/pco/')) {
        if (path !== '/api/pco/defer') requirePrivateTransport(request);
        return await live.manual(async () => {
          if (pco.busy) fail(409, 'Another Planning Center request is in progress. Try again shortly.');
          const kind = path.slice('/api/pco/'.length);
          if (['service-types', 'plans', 'times'].includes(kind)) return json(response, await live.browse(kind, body));
          if (path === '/api/pco/select') await live.select(body);
          else if (path === '/api/pco/stop') live.stop();
          else if (path === '/api/pco/save') pco.save(body, originOf(request));
          else if (path === '/api/pco/test') await pco.verify();
          else if (path === '/api/pco/disconnect') pco.disconnect();
          else if (path === '/api/pco/defer') store.update(state => { state.pcoDeferred = true; });
          else if (path === '/api/pco/authorize') {
            const started = pco.start(sessions.token(request), originOf(request));
            return json(response, { authorizeUrl: started.url }, 200, { 'Set-Cookie': oauthCookie(started.state) });
          } else fail(404, 'Not found.');
          publish();
          return json(response, adminState());
        });
      }
      if (path === '/api/auth/logout') {
        sessions.remove(request);
        return json(response, { ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
      }
      if (path === '/api/auth/password') {
        limitAuth(request);
        if (hashing) fail(429, 'Another login is in progress.');
        hashing = true;
        try {
          if (!(await verifyPassword(body.currentPassword, store.state.auth))) fail(401, 'Current password does not match.');
          const auth = await hashPassword(body.password);
          store.update(state => { state.auth = auth; });
          sessions.records.clear();
          return json(response, { ok: true }, 200, { 'Set-Cookie': cookie(sessions.create()) });
        } finally { hashing = false; }
      }
      if (path === '/api/settings') {
        const peopleBefore = JSON.stringify([store.state.settings.personMode, store.state.settings.personNote]);
        store.update(state => {
          state.settings.campus = text(body.campus, 60) || fail(400, 'Enter a campus name.');
          state.settings.output = choice(body.output, ['direct', 'propresenter']);
          const connector = body.connector ?? state.settings.connector ?? 'auto';
          if (connector !== 'auto' && connector !== state.settings.connector && !physicalOutputs().some(output => output.name === connector)) fail(400, 'Choose a detected display output.');
          state.settings.connector = connector;
          state.settings.personMode = choice(body.personMode, ['note', 'scheduled', 'scheduled-fallback']);
          state.settings.personNote = text(body.personNote, 80);
          state.settings.networkPreference = choice(body.networkPreference, ['ethernet', 'wifi']);
        });
        if (peopleBefore !== JSON.stringify([store.state.settings.personMode, store.state.settings.personNote])) live.invalidate();
      } else if (path === '/api/demo/load') {
        if (store.state.service && store.state.service.source !== 'sample') fail(409, 'A real service is selected.');
        store.update(state => { state.service = sampleService(); state.playback = null; });
      } else if (path === '/api/demo/advance') {
        if (store.state.service?.source !== 'sample') fail(409, 'Load the sample service first.');
        const item = store.state.service.items.find(item => item.id === body.itemId);
        if (!item) fail(400, 'Unknown item.');
        store.update(state => {
          state.service.currentItemId = item.id;
          state.service.liveStart = new Date().toISOString();
          state.playback = null;
        });
      } else if (path === '/api/demo/duration') {
        if (store.state.service?.source !== 'sample') fail(409, 'Sample service only.');
        if (!Number.isInteger(body.duration) || body.duration < 0 || body.duration > 86400) fail(400, 'Enter a duration from 0 to 1,440 minutes.');
        store.update(state => {
          const item = state.service.items.find(item => item.id === body.itemId);
          if (!item) fail(400, 'Unknown item.');
          item.duration = body.duration;
        });
      } else if (path === '/api/overrides') {
        const service = store.state.service;
        if (!service || !service.items.some(item => item.id === body.itemId)) fail(400, 'Unknown item.');
        if (typeof body.video !== 'boolean') fail(400, 'Invalid video flag.');
        const source = choice(body.source, ['auto', 'estimate']);
        store.update(state => {
          state.overrides[overrideKey(service.id, body.itemId)] = { video: body.video, source, mediaId: text(body.mediaId ?? '', 200) };
        });
      } else fail(404, 'Not found.');
      publish();
      return json(response, adminState());
    } catch (error) {
      if (response.headersSent) return response.destroy();
      if (!error.status) console.error('Request failed:', error.message);
      json(response, { error: error.status ? error.message : 'Server error. Check the server log.' }, error.status || 500);
    }
  };
  return { handler, store, code, live, close: () => { live.close(); pco.close(); clearInterval(heartbeat); for (const client of clients) client.end(); } };
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const tlsKey = process.env.FOLDBACK_TLS_KEY;
  const tlsCert = process.env.FOLDBACK_TLS_CERT;
  if (Boolean(tlsKey) !== Boolean(tlsCert)) throw new Error('Set both FOLDBACK_TLS_KEY and FOLDBACK_TLS_CERT.');
  if (process.env.FOLDBACK_DISPLAY_PORT && !tlsKey) throw new Error('The local display listener requires a separate HTTPS admin listener.');
  const app = createApp({ secure: Boolean(tlsKey) });
  const server = tlsKey ? https.createServer({ key: readFileSync(tlsKey), cert: readFileSync(tlsCert) }, app.handler) : http.createServer(app.handler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const port = Number(process.env.PORT || 3210);
  server.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`Foldback Server: ${tlsKey ? 'https' : 'http'}://localhost:${server.address().port}/admin`);
    if (!app.store.state.auth) console.log(`First setup pairing code: ${app.code}`);
  });
  let displayServer;
  if (process.env.FOLDBACK_DISPLAY_PORT) {
    displayServer = http.createServer(createDisplayHandler(app.handler));
    displayServer.listen(Number(process.env.FOLDBACK_DISPLAY_PORT), '127.0.0.1');
  }
  const stop = () => { app.close(); server.close(); displayServer?.close(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
