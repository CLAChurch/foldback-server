import { randomBytes, randomInt, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const pairingCode = () => String(randomInt(10000000, 100000000));
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw Object.assign(new Error('Use a password between 12 and 256 characters.'), { status: 400 });
  }
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await derive(password, salt, 64, options)).toString('hex') };
}
export async function verifyPassword(password, record) {
  if (typeof password !== 'string' || password.length > 256 || !record) return false;
  const candidate = await derive(password, record.salt, 64, options);
  return timingSafeEqual(candidate, Buffer.from(record.hash, 'hex'));
}
const digest = value => createHash('sha256').update(value).digest('hex');
export class Sessions {
  constructor() { this.records = new Map(); }
  create() {
    this.prune();
    if (this.records.size >= 100) this.records.delete(this.records.keys().next().value);
    const token = randomBytes(32).toString('base64url');
    this.records.set(digest(token), Date.now() + 12 * 3600000);
    return token;
  }
  token(request) { return /(?:^|;\s*)foldback_session=([^;]+)/.exec(request.headers.cookie ?? '')?.[1] ?? ''; }
  validToken(token) { return typeof token === 'string' && (this.records.get(digest(token)) ?? 0) > Date.now(); }
  valid(request) { return this.validToken(this.token(request)); }
  remove(request) { this.records.delete(digest(this.token(request))); }
  prune() { for (const [id, expires] of this.records) if (expires <= Date.now()) this.records.delete(id); }
}
