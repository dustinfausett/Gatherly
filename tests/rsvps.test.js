import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import * as enc from '../shared/encryption.js';
import { validateRsvp, parseRsvp, validateResponse, encodeResponse, parseResponse, responseSummary } from '../shared/rsvps.js';

const definition = () => validateRsvp({title:'Family picnic',start:'2027-04-17T17:00:00Z',timeZone:'America/Denver',location:'Park',description:'Bring a blanket.'});
test('RSVP definitions and guest counts validate and keep Going and Maybe totals separate', () => {
  assert.deepEqual(parseRsvp(JSON.stringify(definition())),definition());
  assert.throws(()=>validateRsvp({...definition(),end:'2020-01-01T00:00:00Z'}));
  assert.throws(()=>validateRsvp({...definition(),timeZone:'Invalid/Zone'}));
  assert.equal(parseRsvp(JSON.stringify({...definition(),allDay:true,start:'2027-02-30'})),null);
  assert.equal(validateRsvp({...definition(),allDay:true,start:'2027-04-17'}).start,'2027-04-17');
  for(const value of [{choice:'going',guests:-1},{choice:'going',guests:1.5},{choice:'maybe',guests:100},{choice:'declined',guests:1},{choice:'other',guests:0}])assert.throws(()=>validateResponse(value));
  assert.equal(parseResponse(encodeResponse(7,{choice:'going',guests:2}),8),null);
  assert.deepEqual(responseSummary([{choice:'going',guests:2},{choice:'maybe',guests:3},{choice:'going',guests:0},{choice:'declined',guests:0}]),{going:{members:2,guests:2,total:4},maybe:{members:1,guests:3,total:4},declined:{members:1,guests:0,total:1}});
});
test('encrypted RSVPs enforce permissions, history, quiet responses, deadlines, edits and cancellation', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'churp-rsvps-'));
  const runtime = createApp({ dataDir: dir, testing: true, googleClientId: '', pushEnabled: false });
  const server = createServer(runtime.app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => { runtime.close(); await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); });
  async function req(path, actor, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { ...(actor ? { cookie: actor.cookie, 'x-churp-device': actor.deviceId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }
  async function ok(...args) { const result = await req(...args); assert.ok(result.status < 300, JSON.stringify(result)); return result.data; }
  async function actor(name, self = false) {
    const response = await fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, name, password: 'Poll fixture password!' }) });
    const a = { ...(await response.json()).user, cookie: response.headers.get('set-cookie').split(';')[0], deviceId: randomUUID() };
    if (self) {
      const keys = await enc.generateIdentity(a.id), backup = await enc.protectPrivate(keys.privateKey, enc.randomSecret());
      const payload = enc.enrollmentPayload({ userId: a.id, publicKey: keys.publicKey, backupHash: await enc.digest(backup), deviceId: a.deviceId, deviceName: 'Poll fixture' });
      await ok('/e2ee/identity', a, 'POST', { ...payload, backup, signature: await enc.sign(keys.privateKey, 'enroll', payload) }); a.privateKey = keys.privateKey;
    } else { const result = await ok('/e2ee/managed-device', a, 'POST', { deviceId: a.deviceId, deviceName: 'Poll fixture' }); a.privateKey = await enc.readPrivate(result.privateKey); }
    return a;
  }
  const owner = await actor('rsvp_owner', true), member = await actor('rsvp_member'), outsider = await actor('rsvp_outsider');
  const tree = (await ok('/communities', owner, 'POST', { name: 'Poll Tree' })).community;
  const invite = (await ok('/invitations', owner, 'POST', { community_id: tree.id })).path.split('invite=')[1];
  await ok('/invitations/accept', member, 'POST', { token: invite });
  const nest = (await ok(`/communities/${tree.id}/circles`, owner, 'POST', { name: 'Announcements', admin_only: true })).group;
  await ok(`/groups/${nest.id}/join`, member, 'POST');
  async function prepare(a, body, kind, replyTo = null) {
    const rs = await ok(`/groups/${nest.id}/e2ee/roster`, a), clientId = randomUUID();
    const ciphertext = await enc.seal(a.privateKey, rs.readers.map(r => r.public_key), { version: 1, kind: 'nest-message', groupId: nest.id, clientId, senderId: a.id, signerId: a.id, rosterHash: rs.roster_hash, replyTo, migrated: false, selfEncrypted: rs.self_encrypted, contentType: kind, body, attachments: [] });
    const payload = enc.sendPayload({ groupId: nest.id, clientId, rosterHash: rs.roster_hash, cipherHash: await enc.digest(ciphertext), files: [], replyTo });
    return { ciphertext, clientId, rosterHash: rs.roster_hash, files: [], reply_to: replyTo, signature: await enc.sign(a.privateKey, 'send', payload) };
  }
  const body=JSON.stringify(definition());
  const sent={...await prepare(owner,body,'rsvp'),message_kind:'rsvp'};
  assert.equal((await req(`/groups/${nest.id}/messages`,member,'POST',{...await prepare(member,body,'rsvp'),message_kind:'rsvp'})).status,403);
  assert.equal((await req(`/groups/${nest.id}/messages`,owner,'POST',{...sent,response_deadline:'invalid'})).status,400);
  const id=(await ok(`/groups/${nest.id}/messages`,owner,'POST',sent)).id;
  assert.equal((await ok(`/groups/${nest.id}/messages`,owner,'POST',sent)).id,id);
  await ok(`/groups/${nest.id}/membership`,member,'PATCH',{read_to:id});
  const notifications=runtime.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
  const response=async(a,choice,guests,eventVersion=0)=>({...await prepare(a,encodeResponse(id,{choice,guests}),'rsvp_response',id),eventVersion});
  const going=await response(member,'going',2);
  assert.equal((await req(`/groups/${nest.id}/messages`,member,'POST',{...going,message_kind:'rsvp_response'})).status,400);
  assert.equal((await req(`/messages/${id}/rsvp/respond`,member,'POST',{body:'plaintext',reply_to:id,eventVersion:0})).status,400);
  const first=(await ok(`/messages/${id}/rsvp/respond`,member,'POST',going)).id;
  assert.equal((await ok(`/messages/${id}/rsvp/respond`,member,'POST',going)).id,first);
  await ok(`/messages/${id}/rsvp/respond`,member,'POST',await response(member,'maybe',3));
  await ok(`/messages/${id}/rsvp/respond`,owner,'POST',await response(owner,'going',1));
  let results=await ok(`/messages/${id}/rsvp`,owner);
  assert.equal(results.responses.length,2);assert.equal(results.eligible.length,2);
  let decoded=await Promise.all(results.responses.map(async m=>parseResponse((await enc.open(owner.privateKey,m.signer_key,m.ciphertext)).body,id)));
  assert.deepEqual(responseSummary(decoded),{going:{members:1,guests:1,total:2},maybe:{members:1,guests:3,total:4},declined:{members:0,guests:0,total:0}});
  assert.equal((await ok(`/messages/${id}/rsvp/status`,member)).responses.length,1);
  assert.equal((await ok(`/messages/${id}/rsvp`,member)).eligible.length,0);
  assert.equal((await ok(`/groups/${nest.id}/messages`,owner)).messages.length,1);
  assert.equal((await ok(`/groups/${nest.id}/shared`,member)).messages[0].id,id);
  assert.equal((await ok(`/groups/${nest.id}/threads/${id}`,member)).messages.length,1);
  assert.equal((await req(`/groups/${nest.id}/threads/${first}`,member)).status,404);
  assert.equal((await ok(`/communities/${tree.id}`,owner)).community.circles[0].unread,0);
  assert.equal((await ok(`/communities/${tree.id}`,member)).community.circles[0].unread,0);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n,notifications);
  assert.equal((await req(`/messages/${id}/rsvp`,outsider)).status,403);
  assert.equal((await req(`/messages/${id}/rsvp`,member,'PATCH',{closed:true})).status,403);
  assert.equal((await req(`/messages/${id}/e2ee/edit-roster`,member)).status,403);
  await ok(`/messages/${id}/rsvp`,owner,'PATCH',{closed:true});
  assert.equal((await req(`/messages/${id}/rsvp/respond`,member,'POST',await response(member,'going',0))).status,409);
  await ok(`/messages/${id}/rsvp`,owner,'PATCH',{closed:false,canceled:true});
  assert.equal((await req(`/messages/${id}/rsvp/respond`,member,'POST',await response(member,'going',0))).status,409);
  await ok(`/messages/${id}/rsvp`,owner,'PATCH',{canceled:false});
  const late=await actor('rsvp_late');await ok('/invitations/accept',late,'POST',{token:invite});await ok(`/groups/${nest.id}/join`,late,'POST');
  assert.equal((await req(`/messages/${id}/rsvp`,late)).status,404);
  assert.equal((await req(`/messages/${id}/rsvp/respond`,late,'POST',{reply_to:id,eventVersion:0})).status,404);
  assert.equal((await ok(`/messages/${id}/rsvp`,owner)).eligible.length,2);
  // The server enforces the response deadline even when a caller bypasses the UI.
  runtime.db.prepare('UPDATE rsvps SET response_deadline=? WHERE message_id=?').run('2020-01-01T00:00:00.000Z',id);
  assert.equal((await req(`/messages/${id}/rsvp/respond`,member,'POST',await response(member,'going',0))).status,409);
  assert.equal((await ok(`/messages/${id}/rsvp`,owner)).deadline_passed,true);
  runtime.db.prepare('UPDATE rsvps SET response_deadline=NULL WHERE message_id=?').run(id);
  // A signed edit preserves the original audience and keeps existing responses.
  const editRoster=await ok(`/messages/${id}/e2ee/edit-roster`,owner),nonce=randomUUID();
  assert.equal(editRoster.readers.length,2);
  const original=runtime.db.prepare('SELECT * FROM messages WHERE id=?').get(id),updated=validateRsvp({...definition(),title:'Picnic at the park'});
  const editCipher=await enc.seal(owner.privateKey,editRoster.readers.map(r=>r.public_key),{version:1,kind:'nest-message',groupId:nest.id,clientId:original.client_id,senderId:owner.id,signerId:owner.id,rosterHash:editRoster.roster_hash,replyTo:null,migrated:false,selfEncrypted:editRoster.self_encrypted,contentType:'rsvp',body:JSON.stringify(updated),attachments:[],editVersion:1,editMessageId:id,editClientId:nonce});
  const editPayload=enc.editPayload({messageId:id,expectedVersion:0,groupId:nest.id,clientId:nonce,rosterHash:editRoster.roster_hash,cipherHash:await enc.digest(editCipher),files:[],replyTo:null});
  const editRequest={ciphertext:editCipher,clientId:nonce,rosterHash:editRoster.roster_hash,files:[],reply_to:null,expectedVersion:0,signature:await enc.sign(owner.privateKey,'edit',editPayload)};
  await ok(`/messages/${id}/content`,owner,'PUT',editRequest);
  assert.equal((await ok(`/messages/${id}/rsvp`,owner)).responses.length,2);
  assert.equal((await req(`/messages/${id}/rsvp/respond`,member,'POST',await response(member,'going',0))).status,409);
  await ok(`/messages/${id}/rsvp/respond`,member,'POST',await response(member,'going',0,1));
  results=await ok(`/messages/${id}/rsvp`,owner);assert.equal(results.event_version,1);
  assert.equal(parseRsvp((await enc.open(owner.privateKey,results.message.signer_key,results.message.ciphertext)).body).title,'Picnic at the park');
  await ok(`/groups/${nest.id}/join`,member,'DELETE');await ok(`/groups/${nest.id}/join`,member,'POST');
  assert.equal((await req(`/messages/${id}/rsvp`,member)).status,404);
  assert.equal((await ok(`/messages/${id}/rsvp`,owner)).eligible.length,1);
  for(const m of runtime.db.prepare('SELECT * FROM messages').all()){assert.equal(m.body,'');assert.ok(!m.ciphertext.includes('picnic'));}
  await ok(`/messages/${id}`,owner,'DELETE');
  assert.equal((await req(`/messages/${id}/rsvp`,owner)).status,404);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM rsvp_responses').get().n,0);
  assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE message_kind='rsvp_response' AND ciphertext IS NOT NULL").get().n,0);
  assert.deepEqual(runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
