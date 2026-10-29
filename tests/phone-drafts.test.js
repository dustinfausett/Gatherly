import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { phoneTextUrl, phoneDraftText } from '../shared/phone-drafts.js';
import { smsConfiguration } from '../server/sms-provider.js';

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'churp-phone-drafts-')); let clock = Date.now(), runtime, server, base, calls = 0, running = false;
  async function start() {
    runtime = createApp({ dataDir: dir, testing: true, googleClientId: '', pushEnabled: false, phoneDraftNow: () => clock, phoneDraftAutoProcess: false, smsTransport: async () => { calls++; throw new Error('No real provider calls allowed.'); }, ...options });
    server = createServer(runtime.app); await new Promise(r => server.listen(0, '127.0.0.1', r)); running = true; base = `http://127.0.0.1:${server.address().port}/api`;
  }
  await start();
  async function stop() { if (!running) return; running = false; runtime.close(); await new Promise(r => server.close(r)); }
  t.after(async () => { await stop(); rmSync(dir, { recursive: true, force: true }); });
  async function req(path, a, method = 'GET', body, headers = {}) {
    const response = await fetch(base + path, { method, headers: { ...(a ? { cookie: a.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function ok(...args) { const r = await req(...args); assert.ok(r.status < 300, JSON.stringify(r)); return r.data; }
  async function register(name, birth = '1990-01-01') { const r = await req('/auth/register', null, 'POST', { username: name, name, password: 'Phone draft fixture password!', birth_date: birth }); assert.equal(r.status, 201); return { ...r.data.user, cookie: r.cookie }; }
  const saved = async (a, name = 'Phone friend', phone = '+12025550123') => (await ok('/contacts', a, 'POST', { name, phone })).contact;
  const packet = (c, extra = {}) => ({ client_id: randomUUID(), contact_ids: [c.id], body: 'Birthday picnic\nBring snacks 🐦 & drinks?', ...extra });
  return { dir, stop, req, ok, register, saved, packet, get runtime() { return runtime; }, get calls() { return calls; }, get now() { return clock; }, advance(ms) { clock += ms; }, restart: async () => { await stop(); await start(); } };
}

test('phone URLs preserve Unicode and newlines and always address exactly one saved number', () => {
  const text = 'Hello 🐦\nA & B? #picnic';
  for (const ios of [true, false]) { const url = phoneTextUrl('+12025550123', text, ios); assert.equal(url, `sms:+12025550123${ios ? '&' : '?'}body=${encodeURIComponent(text)}`); assert.ok(!url.includes(',')); assert.equal(decodeURIComponent(url.split('body=')[1]), text); }
  for (const unsafe of ['+12025550123,+12025550124', '+12025550123?body=hijack', 'javascript:alert(1)', 'someone@example.com']) assert.throws(() => phoneTextUrl(unsafe, 'Hello'));
  assert.equal(phoneDraftText(' Hello ', 'Sam\nInjected', 'Family', 'https://churptree.com/i/ABCDE23456'), 'Hello\n\n— Sam Injected · Family\nJoin us on Churp: https://churptree.com/i/ABCDE23456');
});

test('phone drafts persist encrypted with idempotency, owner isolation and truthful manual handoff states', async t => {
  const f = await fixture(t), owner = await f.register('draft_owner'), other = await f.register('draft_other'), c = await f.saved(owner), packet = f.packet(c);
  const draft = await f.ok('/phone-drafts', owner, 'POST', packet);
  assert.equal(draft.status, 'ready'); assert.equal(draft.recipients[0].state, 'ready');
  const stored = f.runtime.db.prepare('SELECT * FROM phone_drafts WHERE id=?').get(draft.id);
  assert.ok(!JSON.stringify(stored).includes('Birthday picnic')); assert.ok(!JSON.stringify(stored).includes(c.phone));
  assert.equal((await f.ok('/phone-drafts', owner, 'POST', packet)).id, draft.id);
  assert.equal((await f.req('/phone-drafts', owner, 'POST', { ...packet, body: 'Different body' })).status, 409);
  assert.equal((await f.req(`/phone-drafts/${draft.id}`, other)).status, 404);
  assert.equal((await f.ok('/phone-drafts', other)).drafts.length, 0);
  assert.equal((await f.req('/phone-drafts', owner, 'POST', f.packet(c), { origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.req('/phone-drafts', owner, 'POST', { ...f.packet(c), contact_ids: ['not-my-contact'] })).status, 404);
  await f.restart();
  let row = await f.ok(`/phone-drafts/${draft.id}`, owner);
  const prepared = await f.ok(`/phone-drafts/${draft.id}/prepare`, owner, 'POST', { expected_version: row.version, contact_id: c.id });
  assert.match(prepared.text, /Birthday picnic/); assert.match(prepared.text, /Find us on Churp:/); assert.equal(prepared.phone, c.phone); assert.ok(!prepared.text.includes('Reply STOP')); assert.ok(!prepared.text.includes('Reply R'));
  assert.equal(f.calls, 0); assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM sms_messages').get().n, 0);
  row = await f.ok(`/phone-drafts/${draft.id}/recipient`, owner, 'PATCH', { expected_version: row.version, contact_id: c.id, state: 'opened' });
  assert.equal(row.recipients[0].state, 'opened'); assert.equal(row.status, 'ready');
  assert.equal((await f.req(`/phone-drafts/${draft.id}`, owner, 'PUT', { ...packet, expected_version: row.version })).status, 409);
  row = await f.ok(`/phone-drafts/${draft.id}/recipient`, owner, 'PATCH', { expected_version: row.version, contact_id: c.id, state: 'ready' });
  row = await f.ok(`/phone-drafts/${draft.id}`, owner, 'PUT', { ...packet, body: 'I cancelled the phone composer and edited this draft.', expected_version: row.version });
  assert.equal(row.recipients[0].state, 'ready'); assert.match(row.body, /edited this draft/);
  row = await f.ok(`/phone-drafts/${draft.id}/recipient`, owner, 'PATCH', { expected_version: row.version, contact_id: c.id, state: 'done' });
  assert.equal(row.status, 'complete'); assert.equal(f.calls, 0);
  assert.equal((await f.req(`/phone-drafts/${draft.id}/prepare`, owner, 'POST', { expected_version: row.version, contact_id: c.id })).status, 409);
  assert.deepEqual(f.runtime.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('phone reminders can be edited, rescheduled and cancelled, survive restart, and never auto-send', async t => {
  const f = await fixture(t), a = await f.register('reminder_owner'), c = await f.saved(a);
  const request = f.packet(c, { ready_at: f.now + 3600000 }); let row = await f.ok('/phone-drafts', a, 'POST', request);
  assert.equal(row.status, 'scheduled'); assert.equal(f.runtime.phoneDrafts.canNotify(a.id, row.id), false);
  assert.equal((await f.req(`/phone-drafts/${row.id}/prepare`, a, 'POST', { expected_version: row.version, contact_id: c.id })).status, 409);
  row = await f.ok(`/phone-drafts/${row.id}`, a, 'PUT', { ...request, body: 'Edited reminder', ready_at: f.now + 7200000, expected_version: row.version });
  assert.equal((await f.req(`/phone-drafts/${row.id}`, a, 'PUT', { ...request, expected_version: row.version - 1 })).status, 409);
  await f.restart(); f.advance(7200001); await f.runtime.phoneDrafts.tick();
  row = await f.ok(`/phone-drafts/${row.id}`, a); assert.equal(row.status, 'ready'); assert.equal(row.notified, true); assert.equal(row.body, 'Edited reminder');
  assert.equal(f.runtime.phoneDrafts.canNotify(a.id, row.id), true); await f.runtime.phoneDrafts.tick(); assert.equal(f.calls, 0);
  row = await f.ok(`/phone-drafts/${row.id}/cancel`, a, 'POST', { expected_version: row.version }); assert.equal(row.status, 'cancelled'); assert.equal(f.runtime.phoneDrafts.canNotify(a.id, row.id), false);
  assert.equal((await f.req(`/phone-drafts/${row.id}/prepare`, a, 'POST', { expected_version: row.version, contact_id: c.id })).status, 409);
});

test('fresh Tree invitations keep member approval rules, while revoked membership and changed contacts stop handoffs', async t => {
  const f = await fixture(t), a = await f.register('invitation_owner'), b = await f.register('invitation_member'), guest = await f.register('invitation_guest');
  const tree = (await f.ok('/communities', a, 'POST', { name: 'Party Tree' })).community;
  const invite = await f.ok('/invitations', a, 'POST', { community_id: tree.id }); await f.ok('/invitations/accept', b, 'POST', { token: invite.code });
  const c = await f.saved(b), row = await f.ok('/phone-drafts', b, 'POST', f.packet(c, { tree_id: tree.id }));
  const prepared = await f.ok(`/phone-drafts/${row.id}/prepare`, b, 'POST', { expected_version: row.version, contact_id: c.id });
  assert.match(prepared.text, /Party Tree/); const link = prepared.text.match(/https?:\/\/\S+$/)[0];
  const request = await f.ok('/invitations/accept', guest, 'POST', { token: link }); assert.equal(request.pending, true);
  await f.ok(`/communities/${tree.id}/members/${b.id}`, a, 'DELETE');
  assert.equal((await f.req(`/phone-drafts/${row.id}/prepare`, b, 'POST', { expected_version: row.version, contact_id: c.id })).status, 403);
  const own = await f.saved(a), draft = await f.ok('/phone-drafts', a, 'POST', f.packet(own));
  await f.ok(`/contacts/${own.id}`, a, 'PATCH', { phone: '+12025550124' });
  assert.equal((await f.req(`/phone-drafts/${draft.id}/prepare`, a, 'POST', { expected_version: draft.version, contact_id: own.id })).status, 409);
});

test('linked Churp contacts, known youth and protected senders cannot bypass Churp through phone drafts', async t => {
  const f = await fixture(t), a = await f.register('linked_draft_owner'), b = await f.register('linked_draft_peer'), c = await f.saved(a);
  let row = await f.ok('/phone-drafts', a, 'POST', f.packet(c));
  // Linking after preparation must still close the external path.
  f.runtime.db.prepare('UPDATE personal_contacts SET linked_user_id=? WHERE id=?').run(b.id, c.id);
  assert.equal((await f.req(`/phone-drafts/${row.id}/prepare`, a, 'POST', { expected_version: row.version, contact_id: c.id })).status, 403);
  assert.equal((await f.req('/phone-drafts', a, 'POST', f.packet(c))).status, 403);
  const youthContact = await f.saved(b);
  f.runtime.db.prepare("UPDATE users SET birth_date='2012-01-01' WHERE id=?").run(b.id);
  assert.equal((await f.req('/phone-drafts', a, 'POST', f.packet(c))).status, 403);
  assert.equal((await f.req('/phone-drafts', b, 'POST', f.packet(youthContact))).status, 403);
  const { code } = await f.ok('/family/codes', a, 'POST', {});
  await f.ok('/family/claim', b, 'POST', { code });
  const link = (await f.ok('/family', a)).links.find(l => l.child_id === b.id);
  await f.ok(`/family/links/${link.id}/confirm`, a, 'POST', { confirm_parent: true });
  assert.equal((await f.ok('/me', b)).user.family.needs_setup, false);
  const protectedResult = await f.req('/phone-drafts', b, 'POST', f.packet(youthContact));
  assert.equal(protectedResult.status, 403); assert.match(protectedResult.data.error, /adult accounts/);
});

test('production ignores old live Twilio settings and cannot dispatch or accept new provider sends', async t => {
  const config = smsConfiguration({ SMS_MODE: 'live', SMS_LIVE_APPROVED: 'true', TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'not-real', TWILIO_MESSAGING_SERVICE_SID: 'MG' + 'b'.repeat(32), TWILIO_FROM_NUMBER: '+12025550123', SMS_PILOT_TREE_ID: 'unused', SMS_LIVE_SENDER_IDS: 'unused' });
  const f = await fixture(t, { production: true, smsConfig: config, appUrl: 'https://app.churptree.com' }), a = await f.register('retired_provider_owner');
  const mode = await f.ok('/sms/config', a); assert.equal(mode.mode, 'disabled'); assert.equal(mode.ready, false); assert.equal(mode.live_configured, false);
  const c = await f.saved(a); assert.equal((await f.req('/sms/threads', a, 'POST', { contact_id: c.id, tree_id: 'unused' })).status, 503);
  await f.runtime.sms.tick(); assert.equal(f.calls, 0);
});

test('a due phone reminder emits one generic device alert and never sends the draft text', async t => {
  const alerts = [], f = await fixture(t, { pushEnabled: true, pushSender: async (_subscription, body) => { alerts.push(JSON.parse(body)); } });
  const a = await f.register('phone_push_owner'), c = await f.saved(a);
  await f.ok('/push/subscribe', a, 'POST', { subscription: { endpoint: 'https://fcm.googleapis.com/churp-phone-reminder-test', keys: { p256dh: 'fixture', auth: 'fixture' } } });
  const draft = await f.ok('/phone-drafts', a, 'POST', f.packet(c, { ready_at: f.now + 60000 }));
  await f.runtime.phoneDrafts.tick(); assert.equal(alerts.length, 0);
  f.advance(60001); await f.runtime.phoneDrafts.tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(alerts.length, 1); assert.match(alerts[0].title, /phone text drafts are ready/); assert.equal(alerts[0].url, '/?phone_texts=1');
  assert.ok(!JSON.stringify(alerts[0]).includes('Birthday picnic')); assert.ok(!JSON.stringify(alerts[0]).includes(c.phone));
  await f.runtime.phoneDrafts.tick(); assert.equal(alerts.length, 1); assert.equal(f.calls, 0);
  assert.equal((await f.ok(`/phone-drafts/${draft.id}`, a)).recipients[0].state, 'ready');
});

test('a draft-only installation refuses to replace a missing vault master on startup', async t => {
  const f = await fixture(t), a = await f.register('phone_only_vault_owner'), c = await f.saved(a);
  await f.ok('/phone-drafts', a, 'POST', f.packet(c));
  assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM e2ee_managed_keys').get().n, 0);
  await f.stop();
  const master = join(f.dir, 'key-vault.key'); rmSync(master);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import {createApp} from './server/app.js';createApp({dataDir:process.argv[1],testing:true,googleClientId:'',pushEnabled:false});", f.dir], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /vault is missing its master key/);
  assert.equal(existsSync(master), false);
});

test('phone templates personalize per recipient, keep reviewed names across restarts, and refresh names on edit',async t=>{
  const f=await fixture(t),owner=await f.register('phone_template_owner'),avery=await f.saved(owner,'Avery Brown','+12025550123'),blake=await f.saved(owner,'Blake Rivera','+12025550124');
  const packet=f.packet(avery,{contact_ids:[avery.id,blake.id],body:'Hi [first name],\nSee you soon, [First Name]!',ready_at:f.now+60000});
  let row=await f.ok('/phone-drafts',owner,'POST',packet);
  assert.equal(row.body,packet.body);assert.equal(row.personalization,'first-name');
  await f.restart();f.advance(60001);
  let a=await f.ok(`/phone-drafts/${row.id}/prepare`,owner,'POST',{contact_id:avery.id,expected_version:row.version}),b=await f.ok(`/phone-drafts/${row.id}/prepare`,owner,'POST',{contact_id:blake.id,expected_version:row.version});
  assert.match(a.text,/Hi Avery,\nSee you soon, Avery!/);assert.match(b.text,/Hi Blake,\nSee you soon, Blake!/);assert.ok(!a.text.includes('[first name]'));
  await f.ok(`/contacts/${avery.id}`,owner,'PATCH',{name:'Robin Brown'});
  a=await f.ok(`/phone-drafts/${row.id}/prepare`,owner,'POST',{contact_id:avery.id,expected_version:row.version});assert.match(a.text,/Hi Avery,/);
  row=await f.ok(`/phone-drafts/${row.id}`,owner,'PUT',{...packet,ready_at:null,body:'Updated for [first name].',expected_version:row.version});
  a=await f.ok(`/phone-drafts/${row.id}/prepare`,owner,'POST',{contact_id:avery.id,expected_version:row.version});b=await f.ok(`/phone-drafts/${row.id}/prepare`,owner,'POST',{contact_id:blake.id,expected_version:row.version});
  assert.match(a.text,/Updated for Robin\./);assert.match(b.text,/Updated for Blake\./);
  assert.equal(f.calls,0);
  const overflow=f.packet(avery,{body:'[first name]'.repeat(800)});await f.ok(`/contacts/${avery.id}`,owner,'PATCH',{name:'A'.repeat(80)});
  assert.equal((await f.req('/phone-drafts',owner,'POST',overflow)).status,400);
});
