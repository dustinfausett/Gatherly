import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';

test('real accounts, scoped permissions, messaging, and durable storage', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gatherly-test-'));
  let runtime = createApp({ dataDir: dir, testing: true, googleClientId: '', pushEnabled: false });
  let server = createServer(runtime.app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, actor, method = 'GET', body) {
    const isForm = body instanceof FormData;
    const response = await fetch(`${base}/api${path}`, { method, headers: { ...(actor?.cookie ? { Cookie: actor.cookie } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const data = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
    return { status: response.status, data, response };
  }
  async function ok(path, actor, method, body) { const r = await request(path,actor,method,body); assert.ok(r.status < 300, `${method || 'GET'} ${path}: ${JSON.stringify(r.data)}`); return r.data; }
  async function register(username) { const r = await request('/auth/register',null,'POST',{ username, name: username, password: 'correct horse battery' }); assert.equal(r.status,201); return { ...r.data.user, cookie: r.response.headers.get('set-cookie').split(';')[0] }; }
  let owner, alice, bob, stranger, cid, sid, gid, privateId, secondSub, communityInvite, groupInvite, messageId, fileId;
  t.after(async () => { runtime.close(); await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); });

  await t.test('registration, sign-in, validation, and cookie sessions', async () => {
    owner = await register('owner'); alice = await register('alice'); bob = await register('bob'); stranger = await register('stranger');
    assert.equal((await request('/me')).status,401);
    assert.equal((await request('/auth/login',null,'POST',{ username: 'owner', password: 'wrong' })).status,401);
    assert.equal((await request('/auth/register',null,'POST',{ username: 'owner', name: 'duplicate', password: 'long enough' })).status,409);
    const login = await request('/auth/login',null,'POST',{ username: 'OWNER', password: 'correct horse battery' });
    assert.equal(login.status,200); assert.match(login.response.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await ok('/me',owner)).user.id,owner.id);
    assert.equal((await request('/auth/google',null,'POST',{credential:'fake'})).status,503);
  });
  await t.test('Tree creation, invitation membership, and moderated member creation', async () => {
    cid = (await ok('/communities',owner,'POST',{name:'The Neighborhood',description:'A place for us.'})).community.id;
    communityInvite = (await ok('/invitations',owner,'POST',{community_id:cid})).path.split('invite=')[1];
    assert.equal((await request(`/communities/${cid}`,alice)).status,403);
    await ok('/invitations/accept',alice,'POST',{token:communityInvite});
    await ok('/invitations/accept',bob,'POST',{token:communityInvite});
    assert.equal((await request(`/communities/${cid}/subcommunities`,alice,'POST',{name:'Nope'})).status,202);
    sid = (await ok(`/communities/${cid}/subcommunities`,owner,'POST',{name:'Community life'})).subcommunity.id;
    secondSub = (await ok(`/communities/${cid}/subcommunities`,owner,'POST',{name:'Other space'})).subcommunity.id;
    gid = (await ok(`/subcommunities/${sid}/groups`,owner,'POST',{name:'The daily catch-up'})).group.id;
    privateId = (await ok(`/subcommunities/${sid}/groups`,owner,'POST',{name:'Planning circle',private:true})).group.id;
    assert.equal((await ok('/me',owner)).user.last_community_id,cid);
  });
  await t.test('public Group preview versus joined membership; private Group visibility and invitations', async () => {
    const workspace = (await ok(`/communities/${cid}`,alice)).community;
    assert.equal(workspace.subcommunities.flatMap(s=>s.groups).length,1);
    assert.equal((await request(`/groups/${privateId}/messages`,alice)).status,404);
    assert.equal((await request(`/groups/${privateId}/join`,alice,'POST')).status,404);
    assert.deepEqual((await ok(`/groups/${gid}/messages`,alice)).messages,[]);
    assert.equal((await request(`/groups/${gid}/messages`,alice,'POST',{body:'Cannot post yet'})).status,403);
    assert.equal((await request('/invitations',alice,'POST',{community_id:cid,group_id:privateId})).status,403);
    groupInvite = (await ok('/invitations',owner,'POST',{community_id:cid,group_id:privateId})).path.split('invite=')[1];
    assert.equal((await request('/invitations/accept',stranger,'POST',{token:groupInvite})).status,403);
    await ok('/invitations/accept',alice,'POST',{token:groupInvite});
    assert.equal((await ok(`/communities/${cid}`,alice)).community.subcommunities.flatMap(s=>s.groups).length,2);
    await ok(`/groups/${gid}/join`,alice,'POST'); await ok(`/groups/${gid}/join`,bob,'POST');
  });
  await t.test('scoped admins inherit rights only within their assigned branch', async () => {
    await ok(`/admins/subcommunity/${sid}/${alice.id}`,owner,'PUT',{enabled:true});
    assert.equal((await request(`/subcommunities/${sid}/groups`,alice,'POST',{name:'Local announcements',admin_only:true})).status,201);
    assert.equal((await request(`/subcommunities/${secondSub}/groups`,alice,'POST',{name:'Out of scope'})).status,202);
    assert.equal((await request(`/communities/${cid}`,alice,'PATCH',{name:'Not allowed'})).status,403);
    await ok(`/admins/group/${gid}/${bob.id}`,alice,'PUT',{enabled:true});
    await ok(`/groups/${gid}`,bob,'PATCH',{description:'A friendly place to catch up.'});
    assert.equal((await request(`/groups/${privateId}`,bob,'PATCH',{name:'Not allowed'})).status,403);
    assert.equal((await request(`/communities/${cid}/members/${owner.id}`,alice,'DELETE')).status,403);
  });
  await t.test('messages, threaded replies, attachment permissions, and injection-safe rendering data', async () => {
    messageId = (await ok(`/groups/${gid}/messages`,owner,'POST',{body:'Hello, neighbors! <script>alert(1)</script>'})).id;
    const reply = (await ok(`/groups/${gid}/messages`,alice,'POST',{body:'Hi there!',reply_to:messageId})).id;
    await ok(`/groups/${gid}/messages`,bob,'POST',{body:'Welcome!',reply_to:reply});
    const thread = (await ok(`/groups/${gid}/threads/${messageId}`,owner)).messages;
    assert.equal(thread.length,3); assert.equal(thread[2].reply_to,messageId);
    const form = new FormData(); form.append('file',new Blob(['Meeting notes'],{type:'text/plain'}),'notes.txt');
    fileId = (await ok('/uploads',owner,'POST',form)).file.id;
    assert.equal((await request(`/files/${fileId}`,stranger)).status,404);
    assert.equal((await request(`/groups/${gid}/messages`,alice,'POST',{body:'Stolen',files:[fileId]})).status,400);
    await ok(`/groups/${gid}/messages`,owner,'POST',{body:'Here are the notes.',files:[fileId]});
    assert.equal((await request(`/files/${fileId}`,alice)).data,'Meeting notes');
    assert.match((await request(`/files/${fileId}`,alice)).response.headers.get('content-disposition'),/attachment/);
    assert.equal((await request(`/files/${fileId}`,stranger)).status,404);
    const wrongReply = (await ok(`/groups/${privateId}/messages`,owner,'POST',{body:'Private.'})).id;
    assert.equal((await request(`/groups/${gid}/messages`,alice,'POST',{body:'No',reply_to:wrongReply})).status,400);
  });
  await t.test('admin-only posting governs both messages and replies', async () => {
    await ok(`/admins/group/${gid}/${bob.id}`,alice,'PUT',{enabled:false});
    await ok(`/groups/${gid}`,owner,'PATCH',{admin_only:true});
    assert.equal((await request(`/groups/${gid}/messages`,bob,'POST',{body:'No post'})).status,403);
    assert.equal((await request(`/groups/${gid}/messages`,bob,'POST',{body:'No reply',reply_to:messageId})).status,403);
    assert.equal((await request(`/groups/${gid}/messages`,alice,'POST',{body:'Scoped admin reply',reply_to:messageId})).status,201);
    await ok(`/groups/${gid}`,owner,'PATCH',{admin_only:false});
    const before = (await ok(`/communities/${cid}`,owner)).community.subcommunities.flatMap(s=>s.groups).find(g=>g.id===gid);
    assert.equal((await request(`/groups/${gid}`,owner,'PATCH',{name:'Should not save',private:'bad'})).status,400);
    const after = (await ok(`/communities/${cid}`,owner)).community.subcommunities.flatMap(s=>s.groups).find(g=>g.id===gid);
    assert.equal(after.name,before.name);
  });
  await t.test('mute suppresses notifications without removing membership, and reads clear unread counts', async () => {
    await ok('/notifications',bob,'PATCH',{});
    const before = (await ok('/notifications',bob)).notifications.length;
    await ok(`/groups/${gid}/membership`,bob,'PATCH',{muted:true});
    await ok(`/groups/${gid}/messages`,owner,'POST',{body:'A quiet update'});
    assert.equal((await ok('/notifications',bob)).notifications.length,before);
    await ok(`/groups/${gid}/membership`,bob,'PATCH',{muted:false});
    const id = (await ok(`/groups/${gid}/messages`,owner,'POST',{body:'Notifications are back'})).id;
    assert.equal((await ok('/notifications',bob)).notifications.length,before+1);
    await ok(`/groups/${gid}/membership`,bob,'PATCH',{read_to:id});
    const g = (await ok(`/communities/${cid}`,bob)).community.subcommunities.flatMap(s=>s.groups).find(g=>g.id===gid);
    assert.equal(g.unread,0);
    assert.equal((await ok('/notifications',bob)).notifications.filter(n=>!n.seen).length,0);
    assert.equal((await request(`/groups/${gid}/membership`,bob,'PATCH',{read_to:'bad'})).status,400);
  });
  await t.test('live updates use an authenticated event stream', async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`,{headers:{Cookie:bob.cookie},signal:controller.signal});
    assert.equal(response.status,200);
    const reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value),/connected/);
    await ok(`/groups/${gid}/messages`,owner,'POST',{body:'Live update'});
    const event = await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('No live event')),2000).unref())]);
    assert.match(new TextDecoder().decode(event.value),/refresh/);
    controller.abort();
  });
  await t.test('profile changes persist and scripts cannot be used as avatar images', async () => {
    await ok('/me',alice,'PATCH',{name:'Alice Rivera',last_community_id:cid});
    assert.equal((await ok('/me',alice)).user.name,'Alice Rivera');
    const form = new FormData(); form.append('file',new Blob(['<svg onload="alert(1)"></svg>'],{type:'image/png'}),'not-really.png');
    const file = (await ok('/uploads',alice,'POST',form)).file;
    assert.equal(file.mime,'application/octet-stream');
    assert.equal((await request('/me',alice,'PATCH',{avatar_id:file.id})).status,400);
    assert.equal((await request('/me',alice,'PATCH',{avatar_id:fileId})).status,400);
    const image = new FormData(); image.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O2sAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'avatar.png');
    const picture = (await ok('/uploads',alice,'POST',image)).file;
    assert.equal(picture.mime,'image/png'); await ok('/me',alice,'PATCH',{avatar_id:picture.id});
    assert.equal((await request(`/files/${picture.id}`,bob)).status,200);
    await ok(`/groups/${gid}`,alice,'PATCH',{avatar_id:picture.id});
    await ok(`/groups/${gid}`,owner,'PATCH',{description:'An admin can preserve another admin’s photo.',avatar_id:picture.id});
  });
  await t.test('ownership transfer preserves one owner and former owner becomes admin', async () => {
    assert.equal((await request(`/communities/${cid}/transfer`,bob,'POST',{user_id:alice.id})).status,403);
    await ok(`/communities/${cid}/transfer`,owner,'POST',{user_id:alice.id});
    const c = (await ok(`/communities/${cid}`,alice)).community;
    assert.equal(c.owner_id,alice.id); assert.equal(c.role,'owner');
    assert.equal((await ok(`/communities/${cid}`,owner)).community.role,'admin');
    await ok(`/communities/${cid}/members/${bob.id}`,alice,'PATCH',{role:'admin'});
    assert.equal((await request(`/communities/${cid}/members/${owner.id}`,bob,'DELETE')).status,403);
    await ok(`/communities/${cid}/members/${bob.id}`,alice,'PATCH',{role:'member'});
  });
  await t.test('member removal revokes access to Groups, attachments, scoped roles, and notifications', async () => {
    await ok(`/communities/${cid}/members/${bob.id}`,alice,'DELETE');
    assert.equal((await request(`/communities/${cid}`,bob)).status,403);
    assert.equal((await request(`/groups/${gid}/messages`,bob)).status,403);
    assert.equal((await request(`/files/${fileId}`,bob)).status,404);
    assert.equal((await ok('/notifications',bob)).notifications.length,0);
    assert.equal((await ok('/me',bob)).user.last_community_id,null);
    assert.equal((await request(`/communities/${cid}/members/${alice.id}`,owner,'DELETE')).status,400);
  });
  await t.test('server restart retains sessions, messages, members, ownership, and files', async () => {
    runtime.close(); await new Promise(r=>server.close(r));
    runtime=createApp({dataDir:dir,testing:true,googleClientId:'',pushEnabled:false}); server=createServer(runtime.app);
    await new Promise(r=>server.listen(0,'127.0.0.1',r)); base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await ok('/me',alice)).user.name,'Alice Rivera');
    assert.equal((await ok(`/communities/${cid}`,alice)).community.owner_id,alice.id);
    assert.ok((await ok(`/groups/${gid}/messages`,owner)).messages.some(m=>m.id===messageId));
    assert.equal((await request(`/files/${fileId}`,alice)).data,'Meeting notes');
    await ok('/auth/logout',owner,'POST'); assert.equal((await request('/me',owner)).status,401);
  });
  await t.test('cross-site mutations and invalid invitations are rejected', async () => {
    const res=await fetch(`${base}/api/communities`,{method:'POST',headers:{Cookie:alice.cookie,'Content-Type':'application/json',Origin:'https://evil.example','Sec-Fetch-Site':'cross-site'},body:JSON.stringify({name:'CSRF'})});
    assert.equal(res.status,403);
    assert.equal((await request('/invitations/accept',alice,'POST',{token:'bad'})).status,410);
    assert.equal((await request('/push/subscribe',alice,'POST',{subscription:{endpoint:'http://127.0.0.1/'}})).status,503);
  });
});
