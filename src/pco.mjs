import { randomBytes, createHash } from 'node:crypto';

const BASE = 'https://api.planningcenteronline.com';
export const CALLBACK_PATH = '/auth/pco/callback';
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
const checkedText = (value, max = 256) => {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x20\x7f]/.test(value)) throw problem('Invalid Planning Center credential.');
  return value;
};
const fingerprint = config => createHash('sha256').update(JSON.stringify(config)).digest('hex');

export function connectionInfo(state) {
  const config = state.pco;
  return {
    configured: Boolean(config), method: config?.method ?? 'oauth',
    contactEmail: config?.contactEmail ?? '', redirectUri: config?.redirectUri ?? '',
    authorized: Boolean(config?.tokens), verifiedAt: config?.verifiedAt ?? null,
    organization: config?.organization ?? null,
    deferred: Boolean(state.pcoDeferred),
  };
}

export function connectionConfig(body, previous, origin) {
  if (!['pat', 'oauth'].includes(body.method)) throw problem('Choose a Planning Center connection method.');
  const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : '';
  if (contactEmail.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contactEmail)) {
    throw problem('Enter a contact email for Planning Center API requests.');
  }
  let clientId = checkedText(body.clientId ?? '');
  let clientSecret = checkedText(body.clientSecret ?? '', 2048);
  const keepCredentials = !clientId && !clientSecret && previous?.method === body.method;
  if (keepCredentials) { clientId = previous.clientId; clientSecret = previous.clientSecret; }
  if (!clientId || !clientSecret) throw problem('Enter both the Application ID and Secret. Leave both blank to keep a saved connection.');
  if (body.method === 'pat' && clientId.includes(':')) throw problem('Invalid Application ID.');
  const redirectUri = body.method === 'oauth' ? new URL(CALLBACK_PATH, origin).href : '';
  const unchanged = keepCredentials && previous.redirectUri === redirectUri && previous.contactEmail === contactEmail;
  return unchanged ? structuredClone(previous) : {
    method: body.method, clientId, clientSecret, contactEmail, redirectUri,
    tokens: null, verifiedAt: null, organization: null,
  };
}

export class PlanningCenter {
  constructor(store, { fetchImpl = fetch, now = Date.now } = {}) {
    this.store = store;
    this.fetch = fetchImpl;
    this.now = now;
    this.pending = new Map();
    this.busy = false;
  }
  reset() { this.pending.clear(); }
  async exclusive(operation) {
    if (this.busy) throw problem('Another Planning Center request is in progress. Try again shortly.', 409);
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  save(body, origin) {
    const config = connectionConfig(body, this.store.state.pco, origin);
    this.reset();
    this.store.update(state => { state.pco = config; state.pcoDeferred = false; });
  }
  disconnect() {
    this.reset();
    this.store.update(state => {
      state.pco = null; state.pcoDeferred = false;
      if (state.service?.source === 'pco') state.service.connected = false;
    });
  }
  async request(path, { config, method = 'GET', body, authorization } = {}) {
    try {
      const response = await this.fetch(BASE + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: {
          Accept: 'application/json',
          'User-Agent': `CampusFoldback/0.1 (mailto:${config.contactEmail})`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(authorization ? { Authorization: authorization } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw problem('Planning Center rejected access. Check the credentials and this account’s Services permissions.');
        if (response.status === 429) throw problem('Planning Center is rate limiting requests. Wait before trying again.', 429);
        throw problem('Planning Center could not complete the request. Try again later.', 502);
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 1048576) throw problem('Planning Center returned an unexpectedly large response.', 502);
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error.status) throw error;
      // Upstream bodies and exceptions can contain credentials. Never pass them to logs or clients.
      throw problem('Could not reach Planning Center. Check the server’s internet connection and try again.', 502);
    }
  }
  tokenResult(result) {
    const accessToken = checkedText(result.access_token ?? '', 4096);
    const refreshToken = checkedText(result.refresh_token ?? '', 4096);
    if (!accessToken || !refreshToken || !Number.isFinite(result.expires_in) || result.expires_in <= 0 ||
        result.token_type?.toLowerCase() !== 'bearer' ||
        (result.scope !== undefined && !String(result.scope).split(/\s+/).includes('services'))) {
      throw problem('Planning Center did not grant a usable Services connection.', 502);
    }
    return { accessToken, refreshToken, expiresAt: this.now() + result.expires_in * 1000 };
  }
  async authorization(config) {
    if (config.method === 'pat') return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
    if (!config.tokens) throw problem('Sign in with Planning Center first.');
    if (config.tokens.expiresAt <= this.now() + 60000) {
      const result = await this.request('/oauth/token', { config, method: 'POST', body: {
        grant_type: 'refresh_token', refresh_token: config.tokens.refreshToken,
        client_id: config.clientId, client_secret: config.clientSecret,
      } });
      config.tokens = this.tokenResult(result);
      // Persist immediately: refresh token rotation must survive a later verification failure.
      this.store.update(state => { state.pco.tokens = config.tokens; });
    }
    return `Bearer ${config.tokens.accessToken}`;
  }
  async verify() {
    return this.exclusive(async () => {
      const config = structuredClone(this.store.state.pco);
      if (!config) throw problem('Save a Planning Center connection first.');
      this.store.update(state => { state.pco.verifiedAt = null; });
      const authorization = await this.authorization(config);
      const result = await this.request('/services/v2', { config, authorization });
      const organization = result.data;
      if (organization?.type !== 'Organization' || typeof organization.id !== 'string' || typeof organization.attributes?.name !== 'string') {
        throw problem('Planning Center returned unexpected organization information.', 502);
      }
      this.store.update(state => {
        state.pco.verifiedAt = new Date(this.now()).toISOString();
        // Explicit allowlist: the Organization response also has an unrelated secret attribute.
        state.pco.organization = { id: organization.id, name: organization.attributes.name.slice(0, 200) };
      });
      return connectionInfo(this.store.state);
    });
  }
  start(sessionToken, origin) {
    const config = this.store.state.pco;
    if (config?.method !== 'oauth') throw problem('Save OAuth application details first.');
    if (new URL(config.redirectUri).origin !== origin) throw problem('Open the control panel at the registered callback address before signing in.');
    for (const [key, value] of this.pending) if (value.expiresAt <= this.now() || value.sessionToken === sessionToken) this.pending.delete(key);
    if (this.pending.size >= 25) throw problem('Too many sign-ins are in progress. Try again later.', 429);
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    this.pending.set(state, { verifier, sessionToken, expiresAt: this.now() + 600000, configHash: fingerprint(config) });
    const url = new URL('/oauth/authorize', BASE);
    url.search = new URLSearchParams({
      client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'services',
      state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }).toString();
    return { url: url.href, state };
  }
  async callback(parameters, bindingCookie, validSession, origin) {
    return this.exclusive(async () => {
      const state = parameters.get('state');
      const pending = this.pending.get(state);
      if (!state || state !== bindingCookie || !pending || pending.expiresAt <= this.now() || !validSession(pending.sessionToken)) {
        throw problem('Planning Center sign-in expired or did not match this browser. Start again in the control panel.');
      }
      this.pending.delete(state); // One attempt only; never replay a code.
      const config = structuredClone(this.store.state.pco);
      if (!config || fingerprint(config) !== pending.configHash || new URL(config.redirectUri).origin !== origin) {
        throw problem('Connection settings changed. Start Planning Center sign-in again.');
      }
      if (parameters.has('error')) throw problem('Planning Center sign-in was cancelled. You can try again in the control panel.');
      const code = checkedText(parameters.get('code') ?? '', 2048);
      if (!code) throw problem('Planning Center did not return a sign-in code.');
      const result = await this.request('/oauth/token', { config, method: 'POST', body: {
        grant_type: 'authorization_code', code, client_id: config.clientId, client_secret: config.clientSecret,
        redirect_uri: config.redirectUri, code_verifier: pending.verifier,
      } });
      config.tokens = this.tokenResult(result);
      this.store.update(state => { state.pco.tokens = config.tokens; state.pco.verifiedAt = null; state.pco.organization = null; });
    });
  }
}
