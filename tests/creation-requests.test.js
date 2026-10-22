import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';

test('moderated creation, scoped reviews, privacy, atomic decisions and durable settings',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'churp-approvals-'));
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
  async function register(username){const r=await req('/auth/register',null,'POST',{username,name:username,password:'approval test password'});assert.equal(r.status,201);return {...r.data.user,cookie:r.cookie};}
  const owner=await register('owner'),member=await register('member'),scoped=await register('scoped'),other=await register('other'),outsider=await register('outsider');
  const cid=(await ok('/communities',owner,'POST',{name:'Home'})).community.id;
  const otherCid=(await ok('/communities',outsider,'POST',{name:'Other'})).community.id;
  const invite=(await ok('/invitations',owner,'POST',{community_id:cid})).path.split('invite=')[1];
  for(const actor of [member,scoped,other])await ok('/invitations/accept',actor,'POST',{token:invite});
  const sid=(await ok(`/communities/${cid}/subcommunities`,owner,'POST',{name:'Local'})).subcommunity.id;
  const sid2=(await ok(`/communities/${cid}/subcommunities`,owner,'POST',{name:'Elsewhere'})).subcommunity.id;
  const foreignSid=(await ok(`/communities/${otherCid}/subcommunities`,outsider,'POST',{name:'Foreign'})).subcommunity.id;
  await ok(`/admins/subcommunity/${sid}/${scoped.id}`,owner,'PUT',{enabled:true});
  const snapshot=async actor=>(await ok(`/communities/${cid}`,actor)).community;
  const requests=async actor=>(await ok(`/communities/${cid}/creation-requests`,actor)).requests;
  const review=(id,actor,decision='approve')=>req(`/creation-requests/${id}/review`,actor,'POST',{decision});
  let rootRequest,branchRequest,privateRequest,pic;

  await t.test('members submit validated hidden drafts with images; drafts are visible only to requester or authorized reviewers',async()=>{
    const c=await snapshot(member);assert.equal(c.branch_approval_required,1);assert.equal(c.nest_approval_required,1);
    assert.equal((await req(`/communities/${cid}/circles`,outsider,'POST',{name:'Intrusion'})).status,403);
    assert.equal((await req(`/communities/${cid}/circles`,member,'POST',{name:'Bad parent',subcommunity_id:foreignSid})).status,400);
    assert.equal((await req(`/communities/${cid}/circles`,member,'POST',{name:'Bad flags',private:'true'})).status,400);
    assert.equal((await req(`/communities/${cid}/subcommunities`,member,'POST',{name:' '})).status,400);
    const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O2sAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'nest.png');
    pic=(await ok('/uploads',member,'POST',form)).file.id;
    const r=await req(`/communities/${cid}/circles`,member,'POST',{name:'Secret draft',description:'Keep the submitted details',subcommunity_id:sid,avatar_id:pic,private:true,admin_only:true});
    assert.equal(r.status,202);privateRequest=r.data.request;assert.equal(privateRequest.can_review,false);
    assert.equal((await snapshot(owner)).circles.length,0);
    assert.equal((await requests(other)).length,0);
    assert.equal((await req(`/communities/${cid}/creation-requests`,outsider)).status,403);
    assert.equal((await requests(scoped)).length,1);assert.equal((await requests(member)).length,1);
    assert.equal((await req(`/files/${pic}`,other)).status,404);assert.equal((await req(`/files/${pic}`,scoped)).status,200);
    const duplicate=await ok(`/communities/${cid}/circles`,member,'POST',{name:'Secret draft',description:'Keep the submitted details',subcommunity_id:sid,avatar_id:pic,private:true,admin_only:true});
    assert.equal(duplicate.request.id,privateRequest.id);
    rootRequest=(await ok(`/communities/${cid}/circles`,member,'POST',{name:'Root request'})).request;
    branchRequest=(await ok(`/communities/${cid}/subcommunities`,member,'POST',{name:'New Branch'})).request;
    assert.equal((await snapshot(owner)).pending_creation_count,3);assert.equal((await snapshot(scoped)).pending_creation_count,1);
  });
  await t.test('scope boundaries hold for review and bypass; approval creates exactly once and grants limited creator rights',async()=>{
    assert.equal((await review(rootRequest.id,scoped)).status,403);
    assert.equal((await review(branchRequest.id,scoped)).status,403);
    assert.equal((await review(privateRequest.id,member)).status,403);
    assert.equal((await review(privateRequest.id,outsider)).status,403);
    assert.equal((await review(privateRequest.id,scoped,'maybe')).status,400);
    const approved=await review(privateRequest.id,scoped);assert.equal(approved.status,200);
    const g=(await snapshot(member)).circles.find(g=>g.id===approved.data.request.result_id);
    assert.equal(g.name,'Secret draft');assert.equal(g.description,'Keep the submitted details');assert.equal(g.avatar_id,pic);assert.equal(g.private,1);assert.equal(g.admin_only,1);assert.equal(g.joined,true);assert.equal(g.is_admin,true);
    assert.equal((await snapshot(other)).circles.length,0,'Private approval does not expose Nest to other members');
    assert.equal((await snapshot(member)).is_admin,false);assert.equal((await snapshot(member)).subcommunities.find(s=>s.id===sid).is_admin,false);
    assert.equal((await req(`/communities/${cid}`,member,'PATCH',{nest_approval_required:false})).status,403);
    assert.equal((await review(privateRequest.id,owner)).status,409);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM groups WHERE name=?').get('Secret draft').n,1);
    assert.equal((await req(`/subcommunities/${sid}/groups`,scoped,'POST',{name:'Direct in own Branch'})).status,201);
    assert.equal((await req(`/subcommunities/${sid2}/groups`,scoped,'POST',{name:'Other Branch request'})).status,202);
    const decisions=await Promise.all([review(branchRequest.id,owner),review(branchRequest.id,owner)]);
    assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);
    const created=decisions.find(r=>r.status===200);
    const branch=(await snapshot(member)).subcommunities.find(s=>s.id===created.data.request.result_id);
    assert.equal(branch.is_admin,true);assert.equal(branch.joined,true);
    assert.equal((await req(`/communities/${cid}/subcommunities`,member,'POST',{name:'Still not Tree admin'})).status,202);
  });
  await t.test('declines never create spaces; revoked reviewers lose access; removed members cannot be approved later',async()=>{
    await ok(`/admins/subcommunity/${sid}/${scoped.id}`,owner,'PUT',{enabled:false});
    const pending=(await ok(`/subcommunities/${sid}/groups`,other,'POST',{name:'Pending removal'})).request;
    assert.equal((await review(pending.id,scoped)).status,403);
    assert.ok(!(await requests(scoped)).some(r=>r.id===pending.id));
    const rejected=await review(rootRequest.id,owner,'reject');assert.equal(rejected.status,200);assert.equal(rejected.data.request.status,'rejected');assert.equal(rejected.data.request.result_id,null);
    assert.equal((await review(rootRequest.id,owner)).status,409);
    assert.ok(!(await snapshot(owner)).circles.some(g=>g.name==='Root request'));
    await ok(`/communities/${cid}/members/${other.id}`,owner,'DELETE');
    assert.equal((await requests(owner)).find(r=>r.id===pending.id).status,'cancelled');
    assert.equal((await review(pending.id,owner)).status,409);
    assert.ok(!(await snapshot(owner)).circles.some(g=>g.name==='Pending removal'));
  });
  await t.test('independent settings allow immediate member creation, retain pending reviews, and survive restart',async()=>{
    assert.equal((await req(`/communities/${cid}`,scoped,'PATCH',{branch_approval_required:false})).status,403);
    assert.equal((await req(`/communities/${cid}`,owner,'PATCH',{name:'Must not save',nest_approval_required:'false'})).status,400);
    assert.equal((await req(`/communities/${cid}`,owner,'PATCH',{branch_approval_required:null})).status,400);
    assert.equal((await snapshot(owner)).name,'Home');
    await ok(`/communities/${cid}`,owner,'PATCH',{branch_approval_required:false});
    const branch=await req(`/communities/${cid}/subcommunities`,member,'POST',{name:'Immediate Branch'});assert.equal(branch.status,201);
    assert.equal((await req(`/communities/${cid}/circles`,member,'POST',{name:'Still reviewed'})).status,202);
    await ok(`/communities/${cid}`,owner,'PATCH',{nest_approval_required:false});
    const nest=await req(`/communities/${cid}/circles`,member,'POST',{name:'Immediate private Nest',private:true});assert.equal(nest.status,201);
    assert.equal((await snapshot(member)).circles.find(g=>g.id===nest.data.group.id).is_admin,true);
    assert.equal((await snapshot(member)).is_admin,false);
    assert.equal((await requests(member)).find(r=>r.payload.name==='Still reviewed').status,'pending');
    runtime.close();await new Promise(r=>server.close(r));runtime=createApp({dataDir:dir,testing:true,googleClientId:'',pushEnabled:false});server=createServer(runtime.app);await listen();
    const c=await snapshot(member);assert.equal(c.branch_approval_required,0);assert.equal(c.nest_approval_required,0);
    assert.equal((await requests(member)).find(r=>r.id===privateRequest.id).status,'approved');
    assert.equal((await requests(member)).find(r=>r.payload.name==='Still reviewed').status,'pending');
    assert.deepEqual(runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
});
