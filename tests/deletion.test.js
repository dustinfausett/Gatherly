import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';

test('admin deletion respects scope, preserves Branch chats, and removes deleted Nest access',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'churp-deletion-'));
  let runtime=createApp({dataDir:dir,testing:true,googleClientId:'',pushEnabled:false}),server=createServer(runtime.app),base;
  async function listen(){await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api`;}
  await listen();
  t.after(async()=>{runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
  async function req(path,actor,method='GET',body){
    const form=body instanceof FormData;
    const r=await fetch(base+path,{method,headers:{...(actor ? {cookie:actor.cookie}:{}),...(body&&!form ? {'Content-Type':'application/json'}:{})},body:body ? form?body:JSON.stringify(body):undefined});
    const data=r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer();
    return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r.data));return r.data;}
  async function register(username){const r=await req('/auth/register',null,'POST',{username,name:username,password:'deletion test password'});assert.equal(r.status,201);return {...r.data.user,cookie:r.cookie};}
  const owner=await register('owner'),branchAdmin=await register('branchadmin'),nestAdmin=await register('nestadmin'),member=await register('member'),outsider=await register('outsider');
  const cid=(await ok('/communities',owner,'POST',{name:'Home'})).community.id;
  const invite=(await ok('/invitations',owner,'POST',{community_id:cid})).path.split('invite=')[1];
  for(const actor of [branchAdmin,nestAdmin,member])await ok('/invitations/accept',actor,'POST',{token:invite});
  const branch=(await ok(`/communities/${cid}/subcommunities`,owner,'POST',{name:'Family'})).subcommunity;
  const other=(await ok(`/communities/${cid}/subcommunities`,owner,'POST',{name:'Other Branch'})).subcommunity;
  await ok(`/admins/subcommunity/${branch.id}/${branchAdmin.id}`,owner,'PUT',{enabled:true});
  async function nest(name,parent=null,extra={}){return (await ok(`/communities/${cid}/circles`,owner,'POST',{name,subcommunity_id:parent,...extra})).group;}
  const doomed=await nest('Remove me',branch.id),survivor=await nest('Keep me'),foreignScope=await nest('Other scope',other.id);
  await ok(`/admins/group/${doomed.id}/${nestAdmin.id}`,owner,'PUT',{enabled:true});
  const snapshot=async actor=>(await ok(`/communities/${cid}`,actor)).community;
  const remove=(type,entity,actor,name=entity.name)=>req(`/${type}/${entity.id}`,actor,'DELETE',{confirm_name:name});

  await t.test('members and out-of-scope admins cannot delete; an exact current name is required',async()=>{
    for(const actor of [member,outsider])assert.equal((await remove('groups',doomed,actor)).status,403);
    assert.equal((await remove('subcommunities',branch,nestAdmin)).status,403);
    assert.equal((await remove('groups',foreignScope,branchAdmin)).status,403);
    assert.equal((await remove('groups',survivor,nestAdmin)).status,403);
    assert.equal((await remove('subcommunities',other,branchAdmin)).status,403);
    assert.equal((await remove('groups',doomed,nestAdmin,'wrong name')).status,409);
    assert.equal((await req(`/subcommunities/${branch.id}`,branchAdmin,'DELETE')).status,409);
    await ok(`/groups/${doomed.id}`,owner,'PATCH',{name:'Changed name'});
    assert.equal((await remove('groups',doomed,nestAdmin)).status,409);
    await ok(`/groups/${doomed.id}`,owner,'PATCH',{name:doomed.name});
    assert.ok((await snapshot(owner)).circles.some(g=>g.id===doomed.id));
  });
  await t.test('Nest deletion clears messages, threads, invitations, attachments, notifications, scoped roles and preferences',async()=>{
    for(const g of [doomed,survivor])await ok(`/groups/${g.id}/join`,member,'POST');
    await ok(`/groups/${doomed.id}/membership`,member,'PATCH',{pinned:true,muted:true,marked_unread:true});
    await ok(`/groups/${survivor.id}/membership`,member,'PATCH',{pinned:true});
    const form=new FormData();form.append('file',new Blob(['private attachment']), 'notes.txt');
    const file=(await ok('/uploads',owner,'POST',form)).file;
    const root=(await ok(`/groups/${doomed.id}/messages`,owner,'POST',{body:'Will be deleted',files:[file.id],urgent:true})).id;
    await ok(`/groups/${doomed.id}/messages`,member,'POST',{body:'Reply',reply_to:root});
    const invitation=(await ok('/invitations',owner,'POST',{community_id:cid,group_id:doomed.id})).path.split('invite=')[1];
    assert.equal((await req(`/files/${file.id}`,member)).status,200);
    assert.equal((await remove('groups',doomed,nestAdmin)).status,200);
    assert.equal((await remove('groups',doomed,nestAdmin)).status,404);
    assert.equal((await req(`/groups/${doomed.id}/messages`,member)).status,404);
    assert.equal((await req(`/files/${file.id}`,member)).status,404,'Deleted conversation no longer grants shared attachment access');
    assert.equal((await req('/invitations/accept',member,'POST',{token:invitation})).status,410);
    for(const [table,column] of [['messages','group_id'],['group_members','group_id'],['invitations','group_id']])assert.equal(runtime.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`).get(doomed.id).n,0);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM message_files WHERE file_id=?').get(file.id).n,0);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE message_id=?').get(root).n,0);
    assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM scoped_admins WHERE scope_type='group' AND scope_id=?").get(doomed.id).n,0);
    const remaining=(await snapshot(member)).circles.find(g=>g.id===survivor.id);assert.equal(remaining.pin_position,0);
    await ok(`/groups/${survivor.id}/messages`,member,'POST',{body:'Other conversations still work'});
    const inherited=await nest('Inherited deletion',branch.id);
    assert.equal((await remove('groups',inherited,branchAdmin)).status,200);
    assert.deepEqual(runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
  let pendingId,publicNest,privateNest,approvedRequestId;
  await t.test('Branch deletion moves Nests to Tree level with privacy, messages and personal preferences intact',async()=>{
    publicNest=await nest('Public preserved',branch.id);
    privateNest=await nest('Private preserved',branch.id,{private:true,admin_only:true});
    await ok(`/groups/${publicNest.id}/join`,member,'POST');
    const invitation=(await ok('/invitations',owner,'POST',{community_id:cid,group_id:privateNest.id})).path.split('invite=')[1];
    await ok('/invitations/accept',member,'POST',{token:invitation});
    await ok(`/admins/group/${privateNest.id}/${nestAdmin.id}`,owner,'PUT',{enabled:true});
    for(const g of [publicNest,privateNest]){
      await ok(`/groups/${g.id}/messages`,owner,'POST',{body:'Keep this history',urgent:true});
      await ok(`/groups/${g.id}/membership`,member,'PATCH',{pinned:true,muted:true,marked_unread:true});
    }
    pendingId=(await ok(`/subcommunities/${branch.id}/groups`,member,'POST',{name:'Pending child'})).request.id;
    const approved=(await ok(`/subcommunities/${branch.id}/groups`,member,'POST',{name:'Approved child'})).request;
    approvedRequestId=approved.id;
    const approvedNest=(await ok(`/creation-requests/${approved.id}/review`,branchAdmin,'POST',{decision:'approve'})).request.result_id;
    const before=(await snapshot(member)).circles.filter(g=>[publicNest.id,privateNest.id].includes(g.id));
    assert.ok((await snapshot(branchAdmin)).circles.some(g=>g.id===privateNest.id),'Inherited private access exists before deleting Branch');
    const result=await remove('subcommunities',branch,branchAdmin);assert.equal(result.status,200);assert.equal(result.data.preserved_nests,3);
    const after=await snapshot(member);
    assert.ok(!after.subcommunities.some(s=>s.id===branch.id));
    for(const old of before){
      const kept=after.circles.find(g=>g.id===old.id);assert.deepEqual({...kept,subcommunity_id:old.subcommunity_id},old);
      assert.equal(kept.subcommunity_id,null);
      assert.equal((await ok(`/groups/${old.id}/messages`,member)).messages[0].body,'Keep this history');
    }
    assert.equal(after.circles.find(g=>g.id===approvedNest).is_admin,true,'Explicit creator rights remain');
    assert.equal((await snapshot(nestAdmin)).circles.find(g=>g.id===privateNest.id).is_admin,true);
    assert.ok(!(await snapshot(branchAdmin)).circles.some(g=>g.id===privateNest.id),'Removed Branch roles do not leave inherited private access');
    assert.equal((await req(`/groups/${publicNest.id}`,branchAdmin,'PATCH',{name:'No lingering rights'})).status,403);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM collection_members WHERE subcommunity_id=?').get(branch.id).n,0);
    assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM scoped_admins WHERE scope_type='subcommunity' AND scope_id=?").get(branch.id).n,0);
    const requests=(await ok(`/communities/${cid}/creation-requests`,member)).requests;
    const pending=requests.find(r=>r.id===pendingId);assert.equal(pending.status,'cancelled');assert.equal(pending.parent_name,'Family (deleted)');
    assert.equal((await req(`/creation-requests/${pendingId}/review`,owner,'POST',{decision:'approve'})).status,409);
    assert.equal(requests.find(r=>r.id===approvedRequestId).status,'approved');
    assert.equal(requests.find(r=>r.id===approvedRequestId).result_deleted,0);
    assert.deepEqual(runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
  await t.test('deleting approved spaces updates request history; deletion and preserved chats survive restart',async()=>{
    const request=(await ok(`/communities/${cid}/subcommunities`,member,'POST',{name:'Approved Branch'})).request;
    const approved=(await ok(`/creation-requests/${request.id}/review`,owner,'POST',{decision:'approve'})).request;
    assert.equal((await remove('subcommunities',{id:approved.result_id,name:'Approved Branch'},member)).status,200);
    const nestRequest=(await ok(`/communities/${cid}/circles`,member,'POST',{name:'Approved Nest'})).request;
    const approvedNest=(await ok(`/creation-requests/${nestRequest.id}/review`,owner,'POST',{decision:'approve'})).request;
    assert.equal((await remove('groups',{id:approvedNest.result_id,name:'Approved Nest'},member)).status,200);
    runtime.close();await new Promise(r=>server.close(r));runtime=createApp({dataDir:dir,testing:true,googleClientId:'',pushEnabled:false});server=createServer(runtime.app);await listen();
    const c=await snapshot(member);assert.ok(!c.subcommunities.some(s=>s.id===branch.id));assert.ok(!c.circles.some(g=>g.id===doomed.id));
    assert.equal(c.circles.find(g=>g.id===privateNest.id).private,1);assert.equal(c.circles.find(g=>g.id===publicNest.id).subcommunity_id,null);
    const requests=(await ok(`/communities/${cid}/creation-requests`,member)).requests;
    for(const id of [approved.id,approvedNest.id])assert.equal(requests.find(r=>r.id===id).result_deleted,1);
    assert.equal(requests.find(r=>r.id===pendingId).status,'cancelled');
    assert.equal((await ok(`/groups/${privateNest.id}/messages`,member)).messages[0].body,'Keep this history');
    assert.deepEqual(runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
  await t.test('only the current owner can delete an entire Tree; all descendants and access disappear',async()=>{
    const otherTree=(await ok('/communities',owner,'POST',{name:'Keep this Tree'})).community;
    const otherNest=(await ok(`/communities/${otherTree.id}/circles`,owner,'POST',{name:'Keep this chat'})).group;
    await ok(`/groups/${otherNest.id}/messages`,owner,'POST',{body:'Still here'});
    await ok('/me',member,'PATCH',{last_community_id:cid});
    await ok(`/communities/${cid}/members/${branchAdmin.id}`,owner,'PATCH',{role:'admin'});
    const invitation=(await ok('/invitations',owner,'POST',{community_id:cid,group_id:publicNest.id})).path.split('invite=')[1];
    const form=new FormData();form.append('file',new Blob(['Tree attachment']), 'tree-notes.txt');
    const file=(await ok('/uploads',owner,'POST',form)).file;
    const root=(await ok(`/groups/${publicNest.id}/messages`,owner,'POST',{body:'Tree history',files:[file.id]})).id;
    await ok(`/groups/${publicNest.id}/messages`,owner,'POST',{body:'A reply',reply_to:root});
    await ok(`/communities/${cid}/circles`,member,'POST',{name:'Pending before Tree removal'});
    for(const actor of [branchAdmin,nestAdmin,member,outsider])assert.equal((await req(`/communities/${cid}`,actor,'DELETE',{confirm_name:'Home'})).status,403);
    assert.equal((await req(`/communities/${cid}`,owner,'DELETE',{confirm_name:'wrong'})).status,409);
    assert.equal((await req(`/communities/${cid}`,owner,'DELETE')).status,409);
    assert.ok((await snapshot(member)).circles.length);
    // Ownership transfer immediately revokes the previous owner's deletion right.
    await ok(`/communities/${cid}/transfer`,owner,'POST',{user_id:branchAdmin.id});
    assert.equal((await req(`/communities/${cid}`,owner,'DELETE',{confirm_name:'Home'})).status,403);
    const controller=new AbortController();
    const stream=await fetch(`${base}/events`,{headers:{cookie:member.cookie},signal:controller.signal});
    const reader=stream.body.getReader();await reader.read();
    try {
      assert.equal((await req(`/communities/${cid}`,branchAdmin,'DELETE',{confirm_name:'Home'})).status,200);
      const event=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('No deletion refresh')),2000).unref())]);
      assert.match(new TextDecoder().decode(event.value),/event: refresh/);
    }finally{controller.abort();}
    for(const table of ['communities','subcommunities','groups','community_members','invitations','creation_requests']){
      const column=table==='communities' ? 'id' : 'community_id';
      assert.equal(runtime.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`).get(cid).n,0,table);
    }
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE id=?').get(root).n,0);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM message_files WHERE file_id=?').get(file.id).n,0);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM scoped_admins WHERE user_id=?').get(nestAdmin.id).n,0);
    assert.equal((await req(`/groups/${publicNest.id}/messages`,member)).status,404);
    assert.equal((await req(`/files/${file.id}`,member)).status,404);
    assert.equal((await req('/invitations/accept',outsider,'POST',{token:invitation})).status,410);
    assert.equal((await ok('/me',member)).user.last_community_id,null);
    assert.equal((await ok('/me',owner)).user.last_community_id,otherTree.id);
    assert.deepEqual(runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
    runtime.close();await new Promise(r=>server.close(r));runtime=createApp({dataDir:dir,testing:true,googleClientId:'',pushEnabled:false});server=createServer(runtime.app);await listen();
    assert.equal((await req(`/communities/${cid}`,owner)).status,404);
    assert.equal((await ok(`/groups/${otherNest.id}/messages`,owner)).messages[0].body,'Still here');
    assert.equal((await ok('/communities',member)).communities.length,0);
  });

});
