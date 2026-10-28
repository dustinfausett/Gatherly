import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { hash } from '../server/security.js';

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'churp-google-'));
  const runtime = createApp({ dataDir: dir, testing: true, googleClientId: 'fixture.apps.googleusercontent.com', pushEnabled: false, mailer: null, googleVerifyToken: async value => JSON.parse(value), ...options });
  const server = createServer(runtime.app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => { runtime.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const jar = () => new Map();
  async function req(path, cookies = jar(), method = 'GET', body, headers = {}) {
    const response = await fetch(base + path, { method, headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const setCookies = response.headers.getSetCookie();
    for (const cookie of setCookies) {
      const [name, value] = cookie.split(';')[0].split('=');
      if (!value) cookies.delete(name); else cookies.set(name, value);
    }
    return { status: response.status, data: await response.json(), setCookies };
  }
  async function ok(...args) { const r = await req(...args); assert.ok(r.status < 300, JSON.stringify(r.data)); return r.data; }
  async function register(username) {
    const cookies = jar(), { user } = await ok('/auth/register', cookies, 'POST', { username, name: username, password: 'Existing Churp password!', birth_date: '1990-01-01' });
    return { cookies, user };
  }
  async function proof(cookies, linking = false, createAccount = false) {
    return (await ok(linking ? '/me/google/challenge' : '/auth/google/challenge', cookies, 'POST', linking ? { currentPassword: 'Existing Churp password!' } : { createAccount })).nonce;
  }
  const credential = (nonce, extra = {}) => JSON.stringify({ sub: 'google-subject', email: 'owner@example.com', email_verified: true, name: 'Google owner', nonce, ...extra });
  return { runtime, req, ok, register, proof, credential, jar };
}

test('connecting Google preserves the existing account, membership, message keys and password login', async t => {
  const f = await fixture(t), a = await f.register('existing_google_owner');
  const device = await f.ok('/e2ee/managed-device', a.cookies, 'POST', { deviceId: 'b3e721f6-a10e-4c2e-af32-ed544d5a3d02', deviceName: 'Google fixture' });
  const community = (await f.ok('/communities', a.cookies, 'POST', { name: 'Original Tree' })).community;
  assert.equal((await f.req('/me/google/challenge', a.cookies, 'POST', { currentPassword: 'wrong' })).status, 403);
  const originalSession = a.cookies.get('gatherly_session'), nonce = await f.proof(a.cookies, true);
  const stored = f.runtime.db.prepare('SELECT * FROM google_auth_challenges').get();
  assert.equal(stored.token_hash, hash(nonce)); assert.ok(!JSON.stringify(stored).includes(nonce));
  const linked = await f.ok('/me/google', a.cookies, 'POST', { credential: f.credential(nonce) });
  assert.equal(linked.user.id, a.user.id); assert.equal(linked.user.username, a.user.username);
  assert.equal(linked.user.has_password, true); assert.equal(linked.user.has_google, true); assert.equal(linked.user.google_email, 'owner@example.com');
  assert.notEqual(a.cookies.get('gatherly_session'), originalSession);
  assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  assert.equal((await f.ok('/e2ee/account', a.cookies)).identity.fingerprint, device.identity.fingerprint);
  assert.equal(f.runtime.db.prepare('SELECT role FROM community_members WHERE community_id=? AND user_id=?').get(community.id, a.user.id).role, 'owner');
  const signedOut = f.jar(); let loginNonce = await f.proof(signedOut);
  const returned = await f.ok('/auth/google', signedOut, 'POST', { credential: f.credential(loginNonce, { email: 'new-google-email@example.com' }) });
  assert.equal(returned.user.id, a.user.id); assert.equal(returned.user.google_email, 'new-google-email@example.com');
  assert.equal(returned.user.name, a.user.name); assert.equal(returned.user.recovery_email, null);
  assert.equal((await f.ok('/auth/login', f.jar(), 'POST', { username: a.user.username, password: 'Existing Churp password!' })).user.id, a.user.id);
  assert.equal((await f.req('/me/google', signedOut, 'DELETE', { currentPassword: 'wrong' })).status, 403);
  const disconnected = await f.ok('/me/google', signedOut, 'DELETE', { currentPassword: 'Existing Churp password!' });
  assert.equal(disconnected.user.has_google, false); assert.equal(disconnected.user.google_email, null);
  loginNonce = await f.proof(signedOut);
  assert.equal((await f.req('/auth/google', signedOut, 'POST', { credential: f.credential(loginNonce) })).status, 409);
  assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  assert.deepEqual(f.runtime.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('new Google accounts require explicit signup; known verified emails never auto-merge', async t => {
  const f = await fixture(t), cookies = f.jar();
  let nonce = await f.proof(cookies);
  assert.equal((await f.req('/auth/google', cookies, 'POST', { credential: f.credential(nonce), createAccount: true })).status, 409);
  assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  nonce = await f.proof(cookies, false, true);
  const created = await f.ok('/auth/google', cookies, 'POST', { credential: f.credential(nonce) });
  assert.equal(created.user.has_password, false); assert.equal(created.user.has_google, true); assert.equal(created.user.family.needs_setup, true);
  assert.equal((await f.req('/contacts', cookies)).status, 403);
  assert.equal((await f.req('/me/google', cookies, 'DELETE', { currentPassword: 'anything' })).status, 400);
  const existing = await f.register('recovery_google_owner');
  f.runtime.db.prepare('UPDATE users SET email=?,email_verified_at=? WHERE id=?').run('registered@example.com', Date.now(), existing.user.id);
  const other = f.jar(); nonce = await f.proof(other, false, true);
  const refused = await f.req('/auth/google', other, 'POST', { credential: f.credential(nonce, { sub: 'other-subject', email: 'Registered@Example.com' }) });
  assert.equal(refused.status, 409); assert.match(refused.data.error, /Connect Google/);
  assert.equal(f.runtime.db.prepare('SELECT google_id FROM users WHERE id=?').get(existing.user.id).google_id, null);
  assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
  // An old Google-only account created before google_email was stored still signs in by subject.
  f.runtime.db.prepare('UPDATE users SET google_email=NULL WHERE id=?').run(created.user.id);
  nonce = await f.proof(other);
  assert.equal((await f.ok('/auth/google', other, 'POST', { credential: f.credential(nonce) })).user.id, created.user.id);
});

test('Google proof is verified, browser-bound, expiring, single-use and protected against cross-site requests', async t => {
  const f = await fixture(t), cookies = f.jar();
  assert.equal((await f.req('/auth/google', cookies, 'POST', { credential: f.credential('absent') })).status, 400);
  assert.equal((await f.req('/auth/google/challenge', cookies, 'POST', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.req('/auth/google/challenge', cookies, 'POST', { createAccount: 'true' })).status, 400);
  let nonce = await f.proof(cookies, false, true);
  assert.equal((await f.req('/auth/google', f.jar(), 'POST', { credential: f.credential(nonce) })).status, 400);
  const oldCookie = cookies.get('churp_google_login');
  assert.equal((await f.req('/auth/google', cookies, 'POST', { credential: f.credential('wrong') })).status, 401);
  cookies.set('churp_google_login', oldCookie);
  assert.equal((await f.req('/auth/google', cookies, 'POST', { credential: f.credential(nonce) })).status, 400);
  for (const extra of [{ email_verified: false }, { sub: '' }, { email: 'invalid' }]) {
    nonce = await f.proof(cookies, false, true);
    assert.equal((await f.req('/auth/google', cookies, 'POST', { credential: f.credential(nonce, extra) })).status, 401);
  }
  nonce = await f.proof(cookies, false, true);
  assert.equal((await f.req('/auth/google', cookies, 'POST', { credential: 'not a verified token' })).status, 401);
  nonce = await f.proof(cookies, false, true);
  f.runtime.db.prepare('UPDATE google_auth_challenges SET expires_at=0').run();
  assert.equal((await f.req('/auth/google', cookies, 'POST', { credential: f.credential(nonce) })).status, 400);
  assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  const secure = await fixture(t, { production: true });
  const headers = (await secure.req('/auth/google/challenge', secure.jar(), 'POST', {})).setCookies.join(';');
  assert.match(headers, /HttpOnly/i); assert.match(headers, /Secure/); assert.match(headers, /SameSite=Lax/); assert.match(headers, /Path=\/api/);
});

test('Google linking cannot move identities between accounts or survive a session/password change', async t => {
  const f = await fixture(t), a = await f.register('first_linked'), b = await f.register('second_linked');
  let nonce = await f.proof(a.cookies, true);
  const saved = a.cookies.get('churp_google_link');
  b.cookies.set('churp_google_link', saved);
  assert.equal((await f.req('/me/google', b.cookies, 'POST', { credential: f.credential(nonce) })).status, 400);
  nonce = await f.proof(a.cookies, true);
  await f.ok('/me/google', a.cookies, 'POST', { credential: f.credential(nonce) });
  nonce = await f.proof(b.cookies, true);
  assert.equal((await f.req('/me/google', b.cookies, 'POST', { credential: f.credential(nonce) })).status, 409);
  assert.equal(f.runtime.db.prepare('SELECT google_id FROM users WHERE id=?').get(b.user.id).google_id, null);
  nonce = await f.proof(b.cookies, true); const pending = b.cookies.get('churp_google_link');
  await f.ok('/me/password', b.cookies, 'POST', { currentPassword: 'Existing Churp password!', password: 'Changed Churp password!' });
  b.cookies.set('churp_google_link', pending);
  assert.equal((await f.req('/me/google', b.cookies, 'POST', { credential: f.credential(nonce, { sub: 'unused' }) })).status, 400);
});

test('an in-flight Google connection is rejected after logout and a verification proof cannot be replayed concurrently', async t => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { googleVerifyToken: async value => { started(); await new Promise(resolve => { release = resolve; }); return JSON.parse(value); } });
  const a = await f.register('pending_google_owner'); const nonce = await f.proof(a.cookies, true), replayCookies = new Map(a.cookies);
  const request = f.req('/me/google', a.cookies, 'POST', { credential: f.credential(nonce) });
  await waiting;
  assert.equal((await f.req('/me/google', replayCookies, 'POST', { credential: f.credential(nonce) })).status, 400);
  await f.ok('/auth/logout', new Map(a.cookies), 'POST', {});
  release(); assert.equal((await request).status, 401);
  assert.equal(f.runtime.db.prepare('SELECT google_id FROM users WHERE id=?').get(a.user.id).google_id, null);
});

test('Google remains optional when no client is configured', async t => {
  const f = await fixture(t, { googleClientId: '' });
  assert.equal((await f.ok('/config')).googleClientId, null);
  assert.equal((await f.req('/auth/google/challenge', f.jar(), 'POST', {})).status, 503);
  assert.equal((await f.req('/auth/google', f.jar(), 'POST', { credential: 'fake' })).status, 503);
  const a = await f.register('without_google');
  assert.equal((await f.req('/me/google/challenge', a.cookies, 'POST', { currentPassword: 'Existing Churp password!' })).status, 503);
  assert.equal((await f.ok('/auth/login', f.jar(), 'POST', { username: a.user.username, password: 'Existing Churp password!' })).user.id, a.user.id);
});
