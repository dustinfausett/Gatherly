import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { BIRDS } from '../shared/birds.js';

test('account bird selection, protected code unlocks and photo migration persist', async t => {
  const dir = mkdtempSync(join(tmpdir(),'churp-birds-'));
  let runtime, server, base;
  async function start() {
    runtime=createApp({ encryptionRequired:false,dataDir:dir,testing:true,googleClientId:'',pushEnabled:false});server=createServer(runtime.app);
    await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api`;
  }
  async function stop() {runtime.close();await new Promise(r=>server.close(r));}
  await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
  async function req(path,actor,method='GET',body) {
    const form=body instanceof FormData;
    const r=await fetch(base+path,{method,headers:{...(actor ? {cookie:actor.cookie}:{}),...(body && !form ? {'Content-Type':'application/json'}:{})},body:body ? form ? body : JSON.stringify(body) : undefined});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  async function ok(...args) {const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r.data));return r.data;}
  async function register(username) {const r=await req('/auth/register',null,'POST',{username,name:username,password:'bird collection password'});assert.equal(r.status,201);return {...r.data.user,cookie:r.cookie};}
  const owner=await register('bird_owner'),member=await register('bird_member'),legacy=await register('photo_user');
  const cid=(await ok('/communities',owner,'POST',{name:'Bird Tree'})).community.id;
  const invite=(await ok('/invitations',owner,'POST',{community_id:cid})).path.split('invite=')[1];
  await ok('/invitations/accept',member,'POST',{token:invite});
  const nest=(await ok(`/communities/${cid}/circles`,owner,'POST',{name:'Bird chat'})).group;
  await ok(`/groups/${nest.id}/join`,member,'POST');

  await t.test('only included birds are available until a valid account unlock',async()=>{
    assert.equal(BIRDS.length,12);assert.equal(new Set(BIRDS.map(b=>b.id)).size,12);
    assert.equal(owner.bird_id,'blue');assert.equal(owner.avatar_style,'bird');assert.deepEqual(owner.unlocked_birds,['blue','gold']);
    assert.equal((await req('/me',owner,'PATCH',{bird_id:'parrot',avatar_style:'bird',unlocked_birds:['parrot']})).status,403);
    assert.equal((await req('/me',owner,'PATCH',{bird_id:'not-a-bird'})).status,400);
    assert.equal((await req('/me',owner,'PATCH',{avatar_style:'anything'})).status,400);
    assert.equal((await req('/me/birds/unlock',null,'POST',{code:'Churp'})).status,401);
    for(const code of ['incorrect','',null,123]) assert.equal((await req('/me/birds/unlock',owner,'POST',{code})).status,400);
    assert.deepEqual((await ok('/me',owner)).user.unlocked_birds,['blue','gold']);
    const gold=(await ok('/me',owner,'PATCH',{bird_id:'gold',avatar_style:'bird'})).user;
    assert.equal(gold.bird_id,'gold');assert.equal(gold.avatar_style,'bird');
  });
  await t.test('code redemption is idempotent, account-specific and enforced on every selection',async()=>{
    for(let i=0;i<2;i++) assert.equal((await ok('/me/birds/unlock',owner,'POST',{code:'Churp'})).user.unlocked_birds.length,12);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM bird_unlocks WHERE user_id=?').get(owner.id).n,10);
    assert.equal((await req('/me',member,'PATCH',{bird_id:'parrot',avatar_style:'bird'})).status,403);
    for(const bird of BIRDS) assert.equal((await ok('/me',owner,'PATCH',{bird_id:bird.id,avatar_style:'bird'})).user.bird_id,bird.id);
    await ok('/me',owner,'PATCH',{bird_id:'parrot',avatar_style:'bird'});
    await ok(`/groups/${nest.id}/messages`,owner,'POST',{body:'Hello from Parrot'});
    const message=(await ok(`/groups/${nest.id}/messages`,member)).messages[0];
    assert.equal(message.bird_id,'parrot');assert.equal(message.avatar_style,'bird');assert.equal(message.unlocked_birds,undefined);
    const listed=(await ok(`/communities/${cid}/members`,member)).members.find(m=>m.id===owner.id);
    assert.equal(listed.bird_id,'parrot');assert.equal(listed.avatar_style,'bird');
  });
  let photoId;
  await t.test('profile photos remain independent of the selected banner companion',async()=>{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O2sAAAAASUVORK5CYII=','base64');
    const form=new FormData();form.append('file',new Blob([png],{type:'image/png'}),'photo.png');
    photoId=(await ok('/uploads',legacy,'POST',form)).file.id;
    assert.equal((await ok('/me',legacy,'PATCH',{avatar_id:photoId})).user.avatar_style,'photo');
    assert.equal((await req('/me',member,'PATCH',{avatar_id:photoId})).status,400,'Another user cannot take the uploaded photo');
    const photo=(await ok('/me',owner,'PATCH',{avatar_style:'photo'})).user;assert.equal(photo.bird_id,'parrot');
    await ok('/me',owner,'PATCH',{avatar_style:'bird'});
  });
  await t.test('migration keeps existing pictures, and paid/code entitlements survive restart',async()=>{
    await stop();
    const db=new DatabaseSync(join(dir,'gatherly.sqlite'));
    // Emulate the deployed users table before bird columns existed.
    db.exec('ALTER TABLE users DROP COLUMN avatar_style; ALTER TABLE users DROP COLUMN bird_id;');db.close();
    await start();
    const old=(await ok('/me',legacy)).user;
    assert.equal(old.avatar_id,photoId);assert.equal(old.avatar_style,'photo');assert.equal(old.bird_id,'blue');
    assert.equal((await ok('/me',owner)).user.unlocked_birds.length,12);
    await ok('/me',owner,'PATCH',{bird_id:'owl',avatar_style:'bird'});
    await stop();await start();
    const kept=(await ok('/me',owner)).user;assert.equal(kept.bird_id,'owl');assert.equal(kept.avatar_style,'bird');assert.equal(kept.unlocked_birds.length,12);
    assert.deepEqual((await ok('/me',member)).user.unlocked_birds,['blue','gold']);
    assert.deepEqual(runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
});
