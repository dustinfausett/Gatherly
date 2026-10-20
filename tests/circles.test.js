import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { openDatabase } from '../server/database.js';
import { createApp } from '../server/app.js';

test('legacy hierarchy migration retains conversations, invitations, files, sessions, and scoped roles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gatherly-migration-'));
  const path = join(dir, 'legacy.sqlite');
  let db = new DatabaseSync(path);
  try {
    db.exec(readFileSync(new URL('./fixtures/pre-circles.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO users(id,username,name,password) VALUES ('u','legacy','Legacy Member','password-hash');
      INSERT INTO communities VALUES ('c','Community','Description','avatar','u');
      INSERT INTO community_members VALUES ('c','u','owner');
      INSERT INTO subcommunities VALUES ('s','c','Existing collection','','picture');
      INSERT INTO groups VALUES ('g','s','Existing conversation','Chat description',NULL,1,1);
      INSERT INTO group_members VALUES ('g','u',1,3);
      INSERT INTO scoped_admins VALUES ('subcommunity','s','u');
      INSERT INTO sessions VALUES ('session-hash','u',9999999999999);
      INSERT INTO invitations VALUES ('invite-hash','c','g','u',9999999999999);
      INSERT INTO messages(id,group_id,user_id,body,reply_to) VALUES (3,'g','u','Keep this message',NULL),(4,'g','u','Keep this reply',3);
      INSERT INTO files VALUES ('file','u','notes.txt','disk-name','application/octet-stream',10,1);
      INSERT INTO message_files VALUES (3,'file');
      INSERT INTO notifications(user_id,message_id) VALUES ('u',4);`);
    db.close(); db = openDatabase(path);
    const backup = new DatabaseSync(`${path}.before-circles.bak`, { readOnly:true });
    try {
      assert.equal(backup.prepare('SELECT body FROM messages WHERE id=3').get().body,'Keep this message');
      assert.ok(!backup.prepare('PRAGMA table_info(groups)').all().some(c=>c.name==='community_id'));
    } finally { backup.close(); }
    assert.deepEqual({ ...db.prepare('SELECT * FROM groups').get() }, { id:'g', community_id:'c', subcommunity_id:'s', name:'Existing conversation', description:'Chat description', avatar_id:null, private:1, admin_only:1 });
    assert.deepEqual({ ...db.prepare('SELECT * FROM group_members').get() }, { group_id:'g', user_id:'u', muted:1, last_read:3, pin_position:null, marked_unread:0 });
    assert.equal(db.prepare('SELECT reply_to FROM messages WHERE id=4').get().reply_to,3);
    for (const table of ['sessions','invitations','scoped_admins','message_files','notifications','files']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,1);
    assert.equal(db.prepare('SELECT urgent FROM messages WHERE id=3').get().urgent,0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    db.prepare('INSERT INTO groups(id,community_id,name) VALUES (?,?,?)').run('direct','c','Standalone');
    assert.throws(() => db.prepare('INSERT INTO groups(id,community_id,subcommunity_id,name) VALUES (?,?,?,?)').run('invalid','c','missing','Bad parent'));
    db.close(); db = openDatabase(path);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,2);
    assert.equal(db.prepare('SELECT community_id FROM groups WHERE id=?').get('direct').community_id,'c');
  } finally { db.close(); rmSync(dir,{ recursive:true,force:true }); }
});

test('standalone Circles, personal preferences, urgency, and scoped administration', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gatherly-circles-'));
  let runtime = createApp({ dataDir:dir, testing:true, googleClientId:'', pushEnabled:false });
  let server = createServer(runtime.app);
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  let base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { runtime.close(); await new Promise(r => server.close(r)); rmSync(dir,{recursive:true,force:true}); });
  async function req(path, actor, method='GET', body) {
    const res = await fetch(`${base}/api${path}`, { method, headers:{ ...(actor ? { Cookie:actor.cookie } : {}), ...(body ? { 'Content-Type':'application/json' } : {}) }, body:body ? JSON.stringify(body) : undefined });
    return { status:res.status, data:await res.json(), cookie:res.headers.get('set-cookie')?.split(';')[0] };
  }
  async function ok(...args) { const r=await req(...args); assert.ok(r.status<300,JSON.stringify(r.data)); return r.data; }
  async function register(username) { const r=await req('/auth/register',null,'POST',{username,name:username,password:'a secure test password'}); assert.equal(r.status,201); return {...r.data.user,cookie:r.cookie}; }
  const owner=await register('owner'), member=await register('member'), scoped=await register('scoped');
  const cid=(await ok('/communities',owner,'POST',{name:'Home'})).community.id;
  const otherCid=(await ok('/communities',owner,'POST',{name:'Elsewhere'})).community.id;
  const sid=(await ok(`/communities/${cid}/subcommunities`,owner,'POST',{name:'Volunteers'})).subcommunity.id;
  const otherSid=(await ok(`/communities/${otherCid}/subcommunities`,owner,'POST',{name:'Other Community Group'})).subcommunity.id;
  const invitation=(await ok('/invitations',owner,'POST',{community_id:cid})).path.split('invite=')[1];
  for (const actor of [member,scoped]) await ok('/invitations/accept',actor,'POST',{token:invitation});
  const direct=(await ok(`/communities/${cid}/circles`,owner,'POST',{name:'Alpha'})).group.id;
  const zulu=(await ok(`/communities/${cid}/circles`,owner,'POST',{name:'Zulu'})).group.id;
  const nested=(await ok(`/communities/${cid}/circles`,owner,'POST',{name:'Nested',subcommunity_id:sid})).group.id;
  const snapshot=async actor => (await ok(`/communities/${cid}`,actor)).community;
  const circle=async (actor,id=direct) => (await snapshot(actor)).circles.find(g=>g.id===id);
  await t.test('Circles work with no Group; invalid and unauthorized parents are rejected',async () => {
    assert.equal((await circle(owner)).subcommunity_id,null);
    assert.equal((await snapshot(owner)).subcommunities[0].groups.length,1);
    assert.equal((await req(`/communities/${cid}/circles`,member,'POST',{name:'No'})).status,403);
    assert.equal((await req(`/communities/${cid}/circles`,owner,'POST',{name:'No',subcommunity_id:otherSid})).status,400);
    for(const id of [direct,zulu,nested]) await ok(`/groups/${id}/join`,member,'POST');
    await ok(`/groups/${direct}/messages`,member,'POST',{body:'Standalone conversation'});
    assert.ok((await ok(`/groups/${direct}/messages`,owner)).messages.some(m=>m.body==='Standalone conversation'));
    assert.ok((await ok('/notifications',owner)).notifications.some(n=>n.group_id===direct));
  });
  await t.test('Group admins inherit only their Circles; Community admins can move Circles',async () => {
    await ok(`/admins/subcommunity/${sid}/${scoped.id}`,owner,'PUT',{enabled:true});
    await ok(`/groups/${nested}`,scoped,'PATCH',{description:'Scoped admin can edit'});
    assert.equal((await req(`/groups/${direct}`,scoped,'PATCH',{description:'No'})).status,403);
    assert.equal((await req(`/groups/${nested}`,scoped,'PATCH',{subcommunity_id:null})).status,403);
    assert.equal((await req(`/groups/${direct}`,owner,'PATCH',{name:'Must not save',subcommunity_id:otherSid})).status,400);
    assert.equal((await circle(owner)).name,'Alpha');
    await ok(`/groups/${nested}`,owner,'PATCH',{subcommunity_id:null});
    assert.equal((await req(`/groups/${nested}`,scoped,'PATCH',{description:'No longer inherited'})).status,403);
    await ok(`/admins/group/${direct}/${scoped.id}`,owner,'PUT',{enabled:true});
    await ok(`/groups/${direct}`,scoped,'PATCH',{description:'Circle admin'});
    assert.equal((await req(`/admins/group/${zulu}/${member.id}`,scoped,'PUT',{enabled:true})).status,403);
  });
  await t.test('pins retain a personal order across updates and membership validation is atomic',async () => {
    await ok(`/groups/${direct}/membership`,member,'PATCH',{pinned:true});
    await ok(`/groups/${zulu}/membership`,member,'PATCH',{pinned:true});
    await ok(`/groups/${zulu}/membership`,member,'PATCH',{pin_position:0});
    assert.equal((await circle(member,zulu)).pin_position,0);
    assert.equal((await circle(member)).pin_position,1);
    assert.equal((await circle(owner)).pin_position,null);
    await ok(`/groups/${direct}/messages`,owner,'POST',{body:'Does not move pins'});
    assert.equal((await circle(member,zulu)).pin_position,0);
    assert.equal((await req(`/groups/${direct}/membership`,member,'PATCH',{muted:true,pin_position:-1})).status,400);
    assert.equal((await circle(member)).muted,false);
    await ok(`/groups/${zulu}/membership`,member,'PATCH',{pinned:false});
    assert.equal((await circle(member)).pin_position,0);
  });
  await t.test('manual unread works without messages and only opening clears the reminder',async () => {
    await ok(`/groups/${zulu}/membership`,member,'PATCH',{marked_unread:true});
    assert.equal((await circle(member,zulu)).marked_unread,true);
    assert.equal((await circle(owner,zulu)).marked_unread,false);
    await ok(`/groups/${zulu}/membership`,member,'PATCH',{muted:true});
    assert.equal((await circle(member,zulu)).marked_unread,true);
    await ok(`/groups/${zulu}/membership`,member,'PATCH',{read_to:0});
    assert.equal((await circle(member,zulu)).marked_unread,false);
  });
  let urgentId;
  await t.test('urgent unread includes replies, clears on read, and respects notification muting',async () => {
    await ok(`/groups/${direct}/membership`,member,'PATCH',{read_to:Number.MAX_SAFE_INTEGER,muted:true});
    const before=(await ok('/notifications',member)).notifications.length;
    urgentId=(await ok(`/groups/${direct}/messages`,owner,'POST',{body:'Urgent update',urgent:true})).id;
    await ok(`/groups/${direct}/messages`,owner,'POST',{body:'Urgent reply',reply_to:urgentId,urgent:true});
    assert.equal((await circle(member)).urgent_unread,2);
    assert.equal((await ok('/notifications',member)).notifications.length,before);
    assert.equal((await circle(member)).pin_position,0);
    const thread=(await ok(`/groups/${direct}/threads/${urgentId}`,member)).messages;
    assert.ok(thread.every(m=>m.urgent===1));
    await ok(`/groups/${direct}/membership`,member,'PATCH',{read_to:Number.MAX_SAFE_INTEGER});
    assert.equal((await circle(member)).urgent_unread,0);
    assert.equal((await circle(member)).unread,0);
  });
  await t.test('urgency changes require author/admin posting permissions and deletion removes urgency',async () => {
    assert.equal((await req(`/messages/${urgentId}`,member,'PATCH',{urgent:false})).status,403);
    await ok(`/messages/${urgentId}`,scoped,'PATCH',{urgent:false});
    await ok(`/groups/${direct}`,owner,'PATCH',{admin_only:true});
    const own=(await ok(`/groups/${zulu}/messages`,member,'POST',{body:'My message'})).id;
    await ok(`/groups/${zulu}`,owner,'PATCH',{admin_only:true});
    assert.equal((await req(`/messages/${own}`,member,'PATCH',{urgent:true})).status,403);
    assert.equal((await req(`/groups/${direct}/messages`,member,'POST',{body:'No urgency bypass',urgent:true})).status,403);
    assert.equal((await req(`/messages/${urgentId}`,owner,'PATCH',{urgent:'true'})).status,400);
    const fresh=(await ok(`/groups/${direct}/messages`,owner,'POST',{body:'Urgent to delete',urgent:true})).id;
    assert.equal((await circle(member)).urgent_unread,1);
    await ok(`/messages/${fresh}`,owner,'DELETE');
    assert.equal((await circle(member)).urgent_unread,0);
  });
  await t.test('restart retains pins, unread flags, muting, sessions, and the migrated hierarchy',async () => {
    await ok(`/groups/${direct}/membership`,member,'PATCH',{marked_unread:true});
    runtime.close(); await new Promise(r=>server.close(r));
    runtime=createApp({dataDir:dir,testing:true,googleClientId:'',pushEnabled:false});server=createServer(runtime.app);
    await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
    const g=await circle(member);
    assert.equal(g.pin_position,0);assert.equal(g.muted,true);assert.equal(g.marked_unread,true);assert.equal(g.subcommunity_id,null);
  });
  await t.test('Community removal revokes direct Circle membership, pins, and scoped rights',async () => {
    await ok(`/communities/${cid}/members/${scoped.id}`,owner,'DELETE');
    assert.equal((await req(`/groups/${direct}/messages`,scoped)).status,403);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE user_id=?').get(scoped.id).n,0);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM scoped_admins WHERE user_id=?').get(scoped.id).n,0);
    assert.deepEqual(runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
});
