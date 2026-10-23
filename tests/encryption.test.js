import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import * as enc from '../shared/encryption.js';

async function fixture(t,legacy=false){
  const dir=mkdtempSync(join(tmpdir(),'churp-encryption-'));let runtime,server,base;
  async function start(legacyMode=false){runtime=createApp({dataDir:dir,testing:true,googleClientId:'',pushEnabled:false,...(legacyMode ? {encryptionRequired:false} : {})});server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api`;}
  async function stop(){runtime.close();await new Promise(r=>server.close(r));}
  await start(legacy);t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
  async function req(path,actor,method='GET',body,headers={}){const form=body instanceof FormData;const r=await fetch(base+path,{method,headers:{...(actor ? {cookie:actor.cookie,...(actor.deviceId ? {'x-churp-device':actor.deviceId} : {})} : {}),...(body && !form ? {'Content-Type':'application/json'} : {}),...headers},body:body ? form ? body : JSON.stringify(body) : undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json') ? await r.json() : new Uint8Array(await r.arrayBuffer())};}
  async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r.data));return r.data;}
  async function register(username){const r=await fetch(base+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,name:username,password:'encryption fixture password'})});assert.equal(r.status,201);return {...(await r.json()).user,cookie:r.headers.get('set-cookie').split(';')[0]};}
  async function enroll(a){const keys=await enc.generateIdentity(a.id);a.privateKey=keys.privateKey;a.publicKey=keys.publicKey;a.recovery=enc.randomSecret();a.deviceId=randomUUID();a.deviceName='Fixture device';const backup=await enc.protectPrivate(a.privateKey,a.recovery);
    const payload=enc.enrollmentPayload({userId:a.id,publicKey:a.publicKey,backupHash:await enc.digest(backup),deviceId:a.deviceId,deviceName:a.deviceName});await ok('/e2ee/identity',a,'POST',{...payload,backup,signature:await enc.sign(a.privateKey,'enroll',payload)});return a;}
  async function managed(a){a.deviceId=randomUUID();a.deviceName='Managed fixture';const account=await ok('/e2ee/managed-device',a,'POST',{deviceId:a.deviceId,deviceName:a.deviceName});a.privateKey=await enc.readPrivate(account.privateKey);a.publicKey=account.identity.public_key;return a;}
  async function selfManaged(a){
    const previous=a.privateKey,keys=await enc.generateIdentity(a.id),recovery=enc.randomSecret(),backup=await enc.protectPrivate(keys.privateKey,recovery);
    const historyBackup=await enc.seal(keys.privateKey,[keys.publicKey],{kind:'key-history',userId:a.id,keys:[previous.armor()]});
    const payload={userId:a.id,fromFingerprint:previous.getFingerprint(),toFingerprint:keys.fingerprint,publicKey:keys.publicKey,backupHash:await enc.digest(backup),historyHash:await enc.digest(historyBackup)};
    const body={publicKey:keys.publicKey,backup,historyBackup,signature:await enc.sign(previous,'self-managed-transition',payload),newSignature:await enc.sign(keys.privateKey,'accept-self-managed',payload)};
    await ok('/e2ee/self-managed',a,'POST',body);a.privateKey=keys.privateKey;a.publicKey=keys.publicKey;a.recovery=recovery;return {previous,body,payload};
  }
  async function prepare(a,gid,body,attachments=[],replyTo=null,legacyMessage=null,contentType='chat'){
    const rs=legacyMessage?.roster || await ok(`/groups/${gid}/e2ee/roster`,a),clientId=legacyMessage ? `legacy-${legacyMessage.id}` : randomUUID();
    const contents={version:1,kind:'nest-message',groupId:gid,clientId,senderId:legacyMessage?.user_id || a.id,signerId:a.id,rosterHash:rs.roster_hash,replyTo,migrated:!!legacyMessage,selfEncrypted:!legacyMessage && rs.self_encrypted,contentType,body,attachments};
    const ciphertext=await enc.seal(a.privateKey,rs.readers.filter(r=>r.public_key).map(r=>r.public_key),contents),files=attachments.map(f=>f.id);
    const payload=enc.sendPayload({groupId:gid,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files,replyTo});
    return {ciphertext,clientId,rosterHash:rs.roster_hash,files,reply_to:replyTo,signature:await enc.sign(a.privateKey,legacyMessage ? 'migrate' : 'send',legacyMessage ? {...payload,legacyId:legacyMessage.id} : payload)};
  }
  async function send(a,gid,body,attachments=[],replyTo=null){const prepared=await prepare(a,gid,body,attachments,replyTo);return {...await ok(`/groups/${gid}/messages`,a,'POST',prepared),prepared};}
  async function upload(a,plain,name='private-notes.txt'){const encrypted=await enc.encryptFile(plain),form=new FormData();form.append('file',new Blob([encrypted.encrypted]),'attachment.pgp');const file=(await ok('/e2ee/uploads',a,'POST',form)).file;return {id:file.id,name,size:plain.length,mime:'application/octet-stream',key:encrypted.key,sha256:encrypted.sha256};}
  async function readProof(a,kind,id){const payload={kind,id,deviceId:a.deviceId,time:Date.now(),nonce:enc.randomSecret(16)};return {'x-churp-encryption-proof':JSON.stringify({time:payload.time,nonce:payload.nonce,signature:await enc.sign(a.privateKey,'legacy-read',payload)})};}
  return {dir,get runtime(){return runtime;},req,ok,register,enroll,managed,selfManaged,prepare,send,upload,readProof,restart:async()=>{await stop();await start();}};
}

test('production-default E2EE protects contents, recipients, history boundaries and recovery',async t=>{
  const f=await fixture(t);const alice=await f.enroll(await f.register('alice')),bob=await f.enroll(await f.register('bob')),carol=await f.register('carol'),outsider=await f.enroll(await f.register('outsider'));
  const tree=(await f.ok('/communities',alice,'POST',{name:'Encrypted Tree'})).community;
  const invite=(await f.ok('/invitations',alice,'POST',{community_id:tree.id})).path.split('invite=')[1];
  for(const actor of [bob,carol])await f.ok('/invitations/accept',actor,'POST',{token:invite});
  const nest=(await f.ok(`/communities/${tree.id}/circles`,alice,'POST',{name:'Encrypted Nest'})).group;
  await f.ok(`/groups/${nest.id}/join`,bob,'POST');
  let first,file,secret,plainFile;
  await t.test('plaintext writes, unapproved devices and unencrypted backups are rejected',async()=>{
    assert.equal((await f.ok('/config')).encryptionRequired,true);
    assert.equal((await f.req(`/groups/${nest.id}/messages`,alice,'POST',{body:'DO NOT STORE THIS PLAINTEXT'})).status,400);
    assert.equal((await f.req(`/groups/${nest.id}/messages`,{...alice,deviceId:null},'POST',await f.prepare(alice,nest.id,'Approved device required'))).status,403);
    const payload={userId:carol.id,publicKey:alice.publicKey,backupHash:await enc.digest(alice.privateKey.armor()),deviceId:randomUUID(),deviceName:'Bad backup'};
    assert.equal((await f.req('/e2ee/identity',carol,'POST',{...payload,backup:alice.privateKey.armor(),signature:await enc.sign(alice.privateKey,'enroll',payload)})).status,400);
    assert.equal((await f.req('/e2ee/devices',bob,'POST',{deviceId:randomUUID(),deviceName:'Not approved',signature:'invalid'})).status,403);
    assert.equal(f.runtime.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,0);
  });
  await t.test('server storage, HTTP message responses, attachment names and notifications contain no plaintext contents',async()=>{
    secret=`Secret message ${randomUUID()}`;plainFile=enc.bytes(`Private attachment ${randomUUID()}`);file=await f.upload(alice,plainFile,'secret-filename.txt');
    first=await f.send(alice,nest.id,secret,[file]);
    const row=f.runtime.db.prepare('SELECT * FROM messages WHERE id=?').get(first.id);assert.equal(row.body,'');assert.ok(!row.ciphertext.includes(secret));
    const storedFile=f.runtime.db.prepare('SELECT * FROM files WHERE id=?').get(file.id);assert.equal(storedFile.name,'encrypted-attachment.pgp');assert.equal(storedFile.encrypted,1);
    assert.ok(!readFileSync(join(f.dir,'uploads',storedFile.disk_name)).includes(Buffer.from(plainFile)));
    const response=await f.ok(`/groups/${nest.id}/messages`,bob);assert.equal(response.messages.length,1);assert.equal(response.messages[0].body,'');assert.ok(!JSON.stringify(response).includes(secret));assert.ok(!JSON.stringify(response).includes('secret-filename'));
    const decrypted=await enc.open(bob.privateKey,alice.publicKey,response.messages[0].ciphertext);assert.equal(decrypted.body,secret);assert.equal(decrypted.attachments[0].name,'secret-filename.txt');
    assert.deepEqual(await enc.decryptFile((await f.req(`/files/${file.id}`,bob)).data,file),plainFile);
    const changed=(await f.req(`/files/${file.id}`,bob)).data;changed[changed.length-2]^=1;await assert.rejects(enc.decryptFile(changed,file));
    assert.ok(!(await f.ok('/notifications',bob)).notifications.some(n=>n.body));
    const retry=await f.ok(`/groups/${nest.id}/messages`,alice,'POST',first.prepared);assert.equal(retry.id,first.id);assert.equal(f.runtime.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,1);
  });
  await t.test('a new member gets no earlier messages, thread contents or attachment keys, including across restart',async()=>{
    const stale=await f.prepare(alice,nest.id,'Stale membership must fail');await f.ok(`/groups/${nest.id}/join`,carol,'POST');
    assert.equal((await f.req(`/groups/${nest.id}/messages`,alice,'POST',stale)).status,409);
    assert.deepEqual((await f.ok(`/groups/${nest.id}/messages`,carol)).messages,[]);
    assert.deepEqual((await f.ok(`/groups/${nest.id}/threads/${first.id}`,carol)).messages,[]);
    assert.equal((await f.req(`/files/${file.id}`,carol)).status,404);
    await f.enroll(carol);await assert.rejects(enc.open(carol.privateKey,alice.publicKey,first.prepared.ciphertext));
    await f.send(alice,nest.id,'Everyone present can read this');
    const visible=await f.ok(`/groups/${nest.id}/messages`,carol);assert.equal(visible.messages.length,1);assert.equal((await enc.open(carol.privateKey,alice.publicKey,visible.messages[0].ciphertext)).body,'Everyone present can read this');
    await f.restart();assert.equal((await f.ok(`/groups/${nest.id}/messages`,carol)).messages.length,1);
    assert.equal(f.runtime.db.prepare('SELECT COUNT(*) AS n FROM e2ee_recipients WHERE message_id=? AND user_id=?').get(first.id,carol.id).n,0);
  });
  await t.test('leaving and rejoining resets the history floor; removed users cannot decrypt future messages',async()=>{
    const prepared=await f.prepare(alice,nest.id,'Before removal');await f.ok(`/groups/${nest.id}/join`,bob,'DELETE');assert.equal((await f.req(`/groups/${nest.id}/messages`,alice,'POST',prepared)).status,409);
    const absent=await f.send(alice,nest.id,'Bob is absent');await assert.rejects(enc.open(bob.privateKey,alice.publicKey,absent.prepared.ciphertext));
    await f.ok(`/groups/${nest.id}/join`,bob,'POST');assert.equal((await f.ok(`/groups/${nest.id}/messages`,bob)).messages.length,0);
    await f.ok(`/communities/${tree.id}/members/${bob.id}`,alice,'DELETE');const later=await f.send(alice,nest.id,'Only remaining members');await assert.rejects(enc.open(bob.privateKey,alice.publicKey,later.prepared.ciphertext));
    assert.equal((await f.req(`/groups/${nest.id}/messages`,bob)).status,403);assert.equal((await f.req(`/files/${file.id}`,bob)).status,404);
  });
  await t.test('admin rights do not reveal old chat contents; recipient sets and signatures cannot be forged',async()=>{
    const privateNest=(await f.ok(`/communities/${tree.id}/circles`,alice,'POST',{name:'Private',private:true})).group;
    await f.send(alice,privateNest.id,'Only Alice');await f.ok(`/communities/${tree.id}/members/${carol.id}`,alice,'PATCH',{role:'admin'});
    assert.equal((await f.req(`/groups/${privateNest.id}/messages`,carol)).status,403);
    await f.ok(`/groups/${privateNest.id}/join`,carol,'POST');assert.deepEqual((await f.ok(`/groups/${privateNest.id}/messages`,carol)).messages,[]);
    const bad=await f.prepare(alice,nest.id,'Bad signature');bad.signature=await enc.sign(outsider.privateKey,'send',{});assert.equal((await f.req(`/groups/${nest.id}/messages`,alice,'POST',bad)).status,403);
    const wrong=await f.prepare(alice,nest.id,'Wrong recipients');wrong.ciphertext=await enc.seal(alice.privateKey,[alice.publicKey],{body:'No Carol'});assert.equal((await f.req(`/groups/${nest.id}/messages`,alice,'POST',wrong)).status,400);
    await assert.rejects(enc.open(outsider.privateKey,alice.publicKey,first.prepared.ciphertext));
  });
  await t.test('a password login alone cannot restore keys; a recovery key or signed device grant can',async()=>{
    const account=await f.ok('/e2ee/account',alice);await assert.rejects(enc.recoverPrivate(account.identity.backup,'wrong key'));
    const restored=await enc.recoverPrivate(account.identity.backup,alice.recovery);assert.equal(restored.getFingerprint(),alice.privateKey.getFingerprint());
    assert.equal((await enc.open(restored,alice.publicKey,first.prepared.ciphertext)).body,secret);
    const newDevice=randomUUID(),payload={userId:alice.id,deviceId:newDevice,deviceName:'Recovered browser'};
    await f.ok('/e2ee/devices',{...alice,deviceId:null},'POST',{...payload,signature:await enc.sign(restored,'device',payload)});
    assert.equal((await f.req(`/groups/${nest.id}/e2ee/roster`,{...alice,deviceId:newDevice})).status,200);
    const temp=await enc.generateIdentity(alice.id),nonce=enc.randomSecret();
    const transfer=(await f.ok('/e2ee/transfers',{...alice,deviceId:null},'POST',{deviceId:randomUUID(),deviceName:'New phone',publicKey:temp.publicKey,nonce})).id;
    assert.equal((await f.req(`/e2ee/transfers/${transfer}`,outsider)).status,410);
    const grant=await enc.seal(alice.privateKey,[temp.publicKey],{kind:'device-transfer',privateKey:alice.privateKey.armor(),finishSecret:enc.randomSecret(16)});
    assert.equal((await f.req(`/e2ee/transfers/${transfer}/approve`,alice,'POST',{ciphertext:grant,signature:'fake'})).status,403);
    await f.ok(`/e2ee/transfers/${transfer}/approve`,alice,'POST',{ciphertext:grant,signature:await enc.sign(alice.privateKey,'approve-transfer',{userId:alice.id,transferId:transfer,cipherHash:await enc.digest(grant)})});
    const delivered=(await f.ok(`/e2ee/transfers/${transfer}`,alice)).ciphertext;assert.equal((await enc.open(temp.privateKey,alice.publicKey,delivered)).privateKey,alice.privateKey.armor());
    assert.ok(!f.runtime.db.prepare('SELECT grant_ciphertext FROM e2ee_transfers WHERE id=?').get(transfer).grant_ciphertext.includes(alice.privateKey.armor()));
    assert.equal((await f.req('/e2ee/identity',alice,'POST',{})).status,409);
  });
  assert.deepEqual(f.runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('existing history migrates on authorized browsers without granting later joiners old keys',async t=>{
  const f=await fixture(t,true),alice=await f.register('legacy_alice'),bob=await f.register('legacy_bob'),late=await f.register('late_member');
  const tree=(await f.ok('/communities',alice,'POST',{name:'Old Tree'})).community;
  const invitation=(await f.ok('/invitations',alice,'POST',{community_id:tree.id})).path.split('invite=')[1];
  for(const a of [bob,late])await f.ok('/invitations/accept',a,'POST',{token:invitation});
  const nest=(await f.ok(`/communities/${tree.id}/circles`,alice,'POST',{name:'Old history'})).group;await f.ok(`/groups/${nest.id}/join`,bob,'POST');
  const plain=`LEGACY-SECRET-${randomUUID()}`,filePlain=enc.bytes(`OLD-FILE-${randomUUID()}`),form=new FormData();form.append('file',new Blob([filePlain]),'old-secret-name.txt');
  const oldFile=(await f.ok('/uploads',alice,'POST',form)).file,oldDisk=f.runtime.db.prepare('SELECT disk_name FROM files WHERE id=?').get(oldFile.id).disk_name;
  const id=(await f.ok(`/groups/${nest.id}/messages`,alice,'POST',{body:plain,files:[oldFile.id]})).id;
  await f.restart();await f.enroll(alice);await f.enroll(late);await f.ok(`/groups/${nest.id}/join`,late,'POST');
  assert.deepEqual((await f.ok(`/groups/${nest.id}/messages`,alice)).messages,[]);
  assert.equal((await f.req(`/groups/${nest.id}/e2ee/legacy`,alice)).status,403);
  let legacy=(await f.ok(`/groups/${nest.id}/e2ee/legacy`,alice,'GET',null,await f.readProof(alice,'group',nest.id))).messages[0];
  assert.equal(legacy.body,plain);assert.deepEqual(legacy.roster.missing,[]);assert.equal(legacy.roster.readers.find(r=>r.id===bob.id).custody,'managed');assert.ok(!legacy.roster.readers.some(r=>r.id===late.id));
  await f.managed(bob);
  legacy=(await f.ok(`/groups/${nest.id}/e2ee/legacy`,alice,'GET',null,await f.readProof(alice,'group',nest.id))).messages[0];
  const oldBytes=await f.ok(`/e2ee/legacy-files/${oldFile.id}`,alice,'GET',null,await f.readProof(alice,'file',oldFile.id));assert.deepEqual(oldBytes,filePlain);
  const attachment=await f.upload(alice,filePlain,'old-secret-name.txt'),prepared=await f.prepare(alice,nest.id,legacy.body,[attachment],null,legacy);
  await f.ok(`/e2ee/legacy/${id}`,alice,'PUT',prepared);
  assert.equal(f.runtime.db.prepare('SELECT body FROM messages WHERE id=?').get(id).body,'');assert.equal(existsSync(join(f.dir,'uploads',oldDisk)),false);
  assert.equal((await f.req(`/files/${oldFile.id}`,bob)).status,404);
  const restored=(await f.ok(`/groups/${nest.id}/messages`,bob)).messages[0];assert.equal((await enc.open(bob.privateKey,alice.publicKey,restored.ciphertext)).body,plain);
  assert.deepEqual((await f.ok(`/groups/${nest.id}/messages`,late)).messages,[]);await assert.rejects(enc.open(late.privateKey,alice.publicKey,prepared.ciphertext));
  assert.ok(!readFileSync(join(f.dir,'gatherly.sqlite')).includes(Buffer.from(plain)));
  const wal=join(f.dir,'gatherly.sqlite-wal');if(existsSync(wal))assert.ok(!readFileSync(wal).includes(Buffer.from(plain)));
  await f.restart();assert.deepEqual((await f.ok(`/groups/${nest.id}/messages`,late)).messages,[]);
  assert.equal(f.runtime.db.prepare('SELECT COUNT(*) AS n FROM e2ee_legacy_readers WHERE user_id=? AND message_id=?').get(late.id,id).n,0);
});

test('production cannot opt out of encryption through the legacy fixture option',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'churp-encryption-default-'));
  const runtime=createApp({dataDir:dir,database:':memory:',production:true,encryptionRequired:false,googleClientId:'',pushEnabled:false});
  const server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/config`);assert.equal((await response.json()).encryptionRequired,true);}
  finally{runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('hybrid custody restores standard accounts and derives shields from all joined members',async t=>{
  const f=await fixture(t),alice=await f.managed(await f.register('managed_alice')),bob=await f.register('managed_bob');
  const tree=(await f.ok('/communities',alice,'POST',{name:'Hybrid Tree'})).community;
  const invite=(await f.ok('/invitations',alice,'POST',{community_id:tree.id})).path.split('invite=')[1];await f.ok('/invitations/accept',bob,'POST',{token:invite});
  const nest=(await f.ok(`/communities/${tree.id}/circles`,alice,'POST',{name:'Hybrid Nest'})).group;await f.ok(`/groups/${nest.id}/join`,bob,'POST');
  const status=async()=> (await f.ok(`/communities/${tree.id}`,alice)).community.circles.find(n=>n.id===nest.id).self_encrypted;
  assert.equal(await status(),false);
  const old=await f.send(alice,nest.id,'Before private keys');
  await f.managed(bob);assert.equal((await enc.open(bob.privateKey,alice.publicKey,old.prepared.ciphertext)).body,'Before private keys');
  const managedKey=alice.privateKey,managedPublic=alice.publicKey,firstFingerprint=managedKey.getFingerprint();
  const stored=f.runtime.db.prepare('SELECT * FROM e2ee_managed_keys WHERE user_id=?').get(alice.id);
  assert.ok(!stored.encrypted_key.includes('PRIVATE KEY'));assert.ok(!readFileSync(join(f.dir,'gatherly.sqlite')).includes(Buffer.from(managedKey.armor())));
  assert.equal((await f.ok('/e2ee/account',alice)).identity.custody,'managed');
  assert.equal((await f.req('/e2ee/backup',alice,'PUT',{backup:'Cannot replace managed storage with a personal backup'})).status,409);
  assert.ok(!JSON.stringify(await f.ok(`/e2ee/identities/${alice.id}`,bob)).includes('PRIVATE KEY'));
  await f.restart();const other={...alice,deviceId:randomUUID()};
  const restored=await f.ok('/e2ee/managed-device',other,'POST',{deviceId:other.deviceId,deviceName:'Replacement phone'});
  assert.equal((await enc.readPrivate(restored.privateKey)).getFingerprint(),firstFingerprint);
  const stale=await f.prepare(alice,nest.id,'Stale managed recipient');
  const changed=await f.selfManaged(alice);
  assert.notEqual(alice.privateKey.getFingerprint(),firstFingerprint);
  assert.equal(f.runtime.db.prepare('SELECT COUNT(*) AS n FROM e2ee_managed_keys WHERE user_id=?').get(alice.id).n,0);
  assert.equal((await f.req('/e2ee/managed-device',alice,'POST',{deviceId:randomUUID(),deviceName:'Cannot bypass recovery'})).status,409);
  assert.equal((await f.req(`/groups/${nest.id}/messages`,bob,'POST',stale)).status,409);
  assert.equal(await status(),false);
  await f.ok(`/groups/${nest.id}/membership`,bob,'PATCH',{muted:true});assert.equal(await status(),false);
  const selfAccount=await f.ok('/e2ee/account',alice),recovered=await enc.recoverPrivate(selfAccount.identity.backup,alice.recovery);
  const history=await enc.open(recovered,alice.publicKey,selfAccount.identity.history_backup);
  assert.equal((await enc.readPrivate(history.keys[0])).getFingerprint(),firstFingerprint);
  const earlier=(await f.ok(`/groups/${nest.id}/messages`,alice)).messages.find(m=>m.id===old.id);
  assert.equal(earlier.signer_key,managedPublic);assert.equal(earlier.self_encrypted,0);
  assert.equal((await enc.open(await enc.readPrivate(history.keys[0]),earlier.signer_key,earlier.ciphertext)).body,'Before private keys');
  const replacementSecret=enc.randomSecret(),replacementBackup=await enc.protectPrivate(alice.privateKey,replacementSecret);
  await f.ok('/e2ee/backup',alice,'PUT',{backup:replacementBackup,signature:await enc.sign(alice.privateKey,'backup',{userId:alice.id,backupHash:await enc.digest(replacementBackup)})});
  const replacementAccount=await f.ok('/e2ee/account',alice);
  await assert.rejects(enc.recoverPrivate(replacementAccount.identity.backup,alice.recovery));
  assert.equal((await enc.recoverPrivate(replacementAccount.identity.backup,replacementSecret)).getFingerprint(),alice.privateKey.getFingerprint());
  assert.equal(replacementAccount.identity.history_backup,selfAccount.identity.history_backup);alice.recovery=replacementSecret;
  await enc.verify(managedPublic,'self-managed-transition',changed.payload,changed.body.signature);
  const exposedKeys=[managedKey,bob.privateKey];await f.selfManaged(bob);assert.equal(await status(),true);
  const secureFile=await f.upload(alice,enc.bytes('Future private attachment'));
  const secure=await f.send(alice,nest.id,'After every member opted in',[secureFile]);
  for(const key of exposedKeys)await assert.rejects(enc.open(key,alice.publicKey,secure.prepared.ciphertext));
  const secureMessage=(await f.ok(`/groups/${nest.id}/messages`,bob)).messages.find(m=>m.id===secure.id);
  assert.equal(secureMessage.self_encrypted,1);assert.equal((await enc.open(bob.privateKey,alice.publicKey,secureMessage.ciphertext)).body,'After every member opted in');
  const late=await f.register('late_managed');await f.ok('/invitations/accept',late,'POST',{token:invite});await f.ok(`/groups/${nest.id}/join`,late,'POST');
  assert.equal(await status(),false);await f.managed(late);assert.deepEqual((await f.ok(`/groups/${nest.id}/messages`,late)).messages,[]);
  const mixed=await f.send(alice,nest.id,'Managed participant joined');assert.equal((await f.ok(`/groups/${nest.id}/messages`,bob)).messages.find(m=>m.id===mixed.id).self_encrypted,0);
  await f.ok(`/groups/${nest.id}/join`,late,'DELETE');assert.equal(await status(),true);
  const latePrivate=(await f.ok(`/communities/${tree.id}/circles`,alice,'POST',{name:'Empty Nest'})).group;
  await f.ok(`/groups/${latePrivate.id}/join`,alice,'DELETE');assert.equal((await f.ok(`/communities/${tree.id}`,alice)).community.circles.find(n=>n.id===latePrivate.id).self_encrypted,false);
  await f.restart();assert.equal(await status(),true);assert.equal(f.runtime.db.prepare('SELECT COUNT(*) AS n FROM e2ee_managed_keys WHERE user_id IN (?,?)').get(alice.id,bob.id).n,0);
});

test('shared library finds encrypted older attachments and polls with pagination and membership history boundaries',async t=>{
  const f=await fixture(t),owner=await f.enroll(await f.register('library_owner')),member=await f.managed(await f.register('library_member')),outsider=await f.managed(await f.register('library_outsider'));
  const tree=(await f.ok('/communities',owner,'POST',{name:'Library Tree'})).community;
  const nest=(await f.ok(`/communities/${tree.id}/circles`,owner,'POST',{name:'Shared plans'})).group;
  const invite=(await f.ok('/invitations',owner,'POST',{community_id:tree.id})).path.split('invite=')[1];
  await f.ok('/invitations/accept',member,'POST',{token:invite});await f.ok(`/groups/${nest.id}/join`,member,'POST');
  const older=await f.send(owner,nest.id,'Earlier document',[await f.upload(owner,enc.bytes('Private older PDF contents'),'older.pdf')]);
  const definition=JSON.stringify({churp:'poll',version:1,title:'Library planning poll',questions:[{text:'Which day?',type:'single',options:['Saturday','Sunday']}]});
  async function poll(){return f.ok(`/groups/${nest.id}/messages`,owner,'POST',{...await f.prepare(owner,nest.id,definition,[],null,null,'poll'),message_kind:'poll'});}
  const oldPoll=await poll();
  for(let n=0;n<101;n++)await f.send(owner,nest.id,`Ordinary message ${n}`);
  const picture=await f.send(owner,nest.id,'Latest picture',[await f.upload(owner,new Uint8Array([137,80,78,71,13,10,26,10]),'latest.png')]);
  assert.equal((await f.ok(`/groups/${nest.id}/messages`,member)).messages.some(m=>m.id===older.id),false);
  const lastRead=f.runtime.db.prepare('SELECT last_read FROM group_members WHERE group_id=? AND user_id=?').get(nest.id,member.id).last_read;
  const shared=await f.ok(`/groups/${nest.id}/shared`,member);
  assert.deepEqual(shared.messages.map(m=>m.id),[older.id,oldPoll.id,picture.id]);
  assert.equal(shared.has_more,false);assert.equal(shared.messages[0].body,'');assert.equal(shared.messages[0].files[0].name,'encrypted-attachment.pgp');
  assert.ok(!JSON.stringify(shared).includes('older.pdf'));assert.ok(!JSON.stringify(shared).includes('Which day?'));
  assert.equal(f.runtime.db.prepare('SELECT last_read FROM group_members WHERE group_id=? AND user_id=?').get(nest.id,member.id).last_read,lastRead);
  assert.deepEqual((await f.ok(`/groups/${nest.id}/shared?before=${picture.id}`,member)).messages.map(m=>m.id),[older.id,oldPoll.id]);
  assert.equal((await f.req(`/groups/${nest.id}/shared?before=invalid`,member)).status,400);
  for(let n=0;n<100;n++)await poll();
  const first=await f.ok(`/groups/${nest.id}/shared`,member);assert.equal(first.messages.length,100);assert.equal(first.has_more,true);
  const second=await f.ok(`/groups/${nest.id}/shared?before=${first.messages[0].id}`,member);assert.deepEqual(second.messages.map(m=>m.id),[older.id,oldPoll.id,picture.id]);assert.equal(second.has_more,false);
  const late=await f.managed(await f.register('library_late'));await f.ok('/invitations/accept',late,'POST',{token:invite});
  assert.equal((await f.req(`/groups/${nest.id}/shared`,late)).status,403);await f.ok(`/groups/${nest.id}/join`,late,'POST');
  assert.deepEqual((await f.ok(`/groups/${nest.id}/shared`,late)).messages,[]);
  assert.equal((await f.req(`/groups/${nest.id}/shared`,outsider)).status,403);
  await f.ok(`/messages/${older.id}`,owner,'DELETE');
  assert.deepEqual((await f.ok(`/groups/${nest.id}/shared?before=${oldPoll.id}`,member)).messages,[]);
  await f.ok(`/communities/${tree.id}/members/${member.id}`,owner,'DELETE');assert.equal((await f.req(`/groups/${nest.id}/shared`,member)).status,403);
});
