import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import * as enc from '../shared/encryption.js';
import { assignmentProof, assignmentSetup, encodeAssignmentOperation, operationMetadata, parseAssignmentOperation, parseAssignments, projectAssignments, validateAssignments } from '../shared/assignments.js';
const task=(title,assigneeId=null)=>({id:randomUUID(),title,assigneeId,notes:'Bring it to the park.',dueDate:'2027-06-01'});
const list=()=>validateAssignments({title:'Birthday preparations',description:'Our family plan',dueDate:'2027-06-02',allowMemberAdds:false,items:[task('Bring cake')]});
test('assignment lists validate and project settings, additions, claims, completion and removal',()=>{
  const initial=list();assert.deepEqual(parseAssignments(JSON.stringify(initial)),initial);
  assert.throws(()=>validateAssignments({...initial,items:[]}));assert.throws(()=>validateAssignments({...initial,allowMemberAdds:'yes'}));assert.throws(()=>validateAssignments({...initial,items:[initial.items[0],initial.items[0]]}));
  assert.throws(()=>validateAssignments({...initial,dueDate:'2027-02-30'}));
  const member=randomUUID(),added=task('Bring plates');
  const ops=[{action:'settings',expectedVersion:0,...initial,allowMemberAdds:true},{action:'add',expectedVersion:1,itemId:added.id,assigneeId:null,item:added},{action:'claim',expectedVersion:2,itemId:added.id,assigneeId:member},{action:'complete',expectedVersion:3,itemId:added.id,completed:true},{action:'remove',expectedVersion:4,itemId:initial.items[0].id}];
  for(const op of ops){const body=encodeAssignmentOperation(7,op);assert.ok(parseAssignmentOperation(body,7,operationMetadata(op)));assert.equal(parseAssignmentOperation(body,8,operationMetadata(op)),null);assert.equal(parseAssignmentOperation(body,7,{...operationMetadata(op),expectedVersion:99}),null);}
  const projected=projectAssignments(initial,ops);assert.equal(projected.allowMemberAdds,true);assert.equal(projected.items[0].deleted,true);assert.equal(projected.items[1].completed,true);assert.equal(projected.items[1].assigneeId,member);
});
test('encrypted assignment updates enforce creator permissions, collaboration, atomic claims, original audience and quiet persistence',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'churp-assignments-'));
  let runtime=createApp({dataDir:dir,testing:true,googleClientId:'',pushEnabled:false});
  const server=createServer((req,res)=>runtime.app(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api`;
  t.after(async()=>{runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
  async function req(path,a,method='GET',body){const r=await fetch(base+path,{method,headers:{...(a?{cookie:a.cookie,'x-churp-device':a.deviceId}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
  async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r));return r.data;}
  async function actor(name){const r=await fetch(base+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({birth_date:'1990-01-01',username:name,name,password:'Assignments fixture password!'})});const a={...(await r.json()).user,cookie:r.headers.get('set-cookie').split(';')[0],deviceId:randomUUID()};const k=await ok('/e2ee/managed-device',a,'POST',{deviceId:a.deviceId,deviceName:'Assignments fixture'});a.privateKey=await enc.readPrivate(k.privateKey);return a;}
  const owner=await actor('assign_owner'),member=await actor('assign_member'),other=await actor('assign_other'),outsider=await actor('assign_outsider');
  const tree=(await ok('/communities',owner,'POST',{name:'Party Tree'})).community,invite=(await ok('/invitations',owner,'POST',{community_id:tree.id})).path.split('invite=')[1];
  for(const a of [member,other])await ok('/invitations/accept',a,'POST',{token:invite});
  const nest=(await ok(`/communities/${tree.id}/circles`,owner,'POST',{name:'Party Nest',admin_only:true})).group;for(const a of [member,other])await ok(`/groups/${nest.id}/join`,a,'POST');
  async function seal(a,body,kind,replyTo=null,rs=null){rs ||= await ok(`/groups/${nest.id}/e2ee/roster`,a);const clientId=randomUUID(),ciphertext=await enc.seal(a.privateKey,rs.readers.map(r=>r.public_key),{version:1,kind:'nest-message',groupId:nest.id,clientId,senderId:a.id,signerId:a.id,rosterHash:rs.roster_hash,replyTo,migrated:false,selfEncrypted:rs.self_encrypted,contentType:kind,body,attachments:[]});const payload=enc.sendPayload({groupId:nest.id,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files:[],replyTo});return {ciphertext,clientId,rosterHash:rs.roster_hash,files:[],reply_to:replyTo,signature:await enc.sign(a.privateKey,'send',payload)};}
  async function signed(a,request,listId,metadata,kind){return {...request,assignmentSignature:await enc.sign(a.privateKey,kind,assignmentProof({listId,metadata,clientId:request.clientId,cipherHash:await enc.digest(request.ciphertext)}))};}
  const initial=validateAssignments({...list(),items:[task('Cake',owner.id),task('Decorations'),task('Plates')]}),setup=assignmentSetup(initial);
  const created={...await signed(owner,await seal(owner,JSON.stringify(initial),'assignments'),null,setup,'assignment-setup'),message_kind:'assignments',assignment_setup:setup};
  assert.equal((await req(`/groups/${nest.id}/messages`,owner,'POST',{...created,assignment_setup:{...setup,allowMemberAdds:true}})).status,403);
  assert.equal((await req(`/groups/${nest.id}/messages`,member,'POST',created)).status,403);
  const id=(await ok(`/groups/${nest.id}/messages`,owner,'POST',created)).id;assert.equal((await ok(`/groups/${nest.id}/messages`,owner,'POST',created)).id,id);
  for(const a of [member,other])await ok(`/groups/${nest.id}/membership`,a,'PATCH',{read_to:id});
  const notifications=runtime.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
  async function prepare(a,operation,version){const state=await ok(`/messages/${id}/assignments`,a),op={...operation,expectedVersion:version??state.revision},metadata=operationMetadata(op),rs=await ok(`/messages/${id}/assignments/roster`,a),request=await seal(a,encodeAssignmentOperation(id,op),'assignment_op',id,rs);return {...await signed(a,request,id,metadata,'assignment-operation'),operation:metadata};}
  const apply=(a,op)=>prepare(a,op).then(p=>ok(`/messages/${id}/assignments/operations`,a,'POST',p));
  const newTask=task('Party favors'),add={action:'add',itemId:newTask.id,assigneeId:null,item:newTask};
  assert.equal((await req(`/messages/${id}/assignments/operations`,member,'POST',await prepare(member,add))).status,403);
  assert.equal((await req(`/messages/${id}/assignments/operations`,member,'POST',await prepare(member,{action:'settings',...initial,allowMemberAdds:true}))).status,403);
  const settings={title:initial.title,description:initial.description,dueDate:initial.dueDate,allowMemberAdds:true};await apply(owner,{action:'settings',...settings});
  const addition=await prepare(member,add),added=(await ok(`/messages/${id}/assignments/operations`,member,'POST',addition)).id;
  assert.equal((await ok(`/messages/${id}/assignments/operations`,member,'POST',addition)).id,added);
  assert.equal((await req(`/messages/${added}`,member,'DELETE')).status,400);assert.equal((await req(`/messages/${added}`,owner,'PATCH',{urgent:true})).status,400);
  assert.equal((await req(`/messages/${id}/assignments/operations`,member,'POST',await prepare(member,{action:'complete',itemId:initial.items[0].id,completed:true}))).status,403);
  assert.equal((await req(`/messages/${id}/assignments/operations`,member,'POST',await prepare(member,{action:'remove',itemId:newTask.id}))).status,403);
  const claim={action:'claim',itemId:newTask.id,assigneeId:member.id},rival={...claim,assigneeId:other.id},a=await prepare(member,claim),b=await prepare(other,rival);
  const results=await Promise.all([req(`/messages/${id}/assignments/operations`,member,'POST',a),req(`/messages/${id}/assignments/operations`,other,'POST',b)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const winner=results[0].status===201?member:other;await apply(winner,{action:'complete',itemId:newTask.id,completed:true});await apply(winner,{action:'complete',itemId:newTask.id,completed:false});await apply(winner,{action:'release',itemId:newTask.id});
  const tampered=await prepare(owner,{action:'complete',itemId:initial.items[0].id,completed:true});tampered.operation.completed=false;assert.equal((await req(`/messages/${id}/assignments/operations`,owner,'POST',tampered)).status,403);
  await apply(owner,{action:'edit',itemId:initial.items[1].id,assigneeId:member.id,item:{...initial.items[1],title:'Decorate the room',assigneeId:member.id}});
  await apply(owner,{action:'settings',...settings,allowMemberAdds:false});
  const extra=task('More balloons');assert.equal((await req(`/messages/${id}/assignments/operations`,member,'POST',await prepare(member,{action:'add',itemId:extra.id,assigneeId:null,item:extra}))).status,403);
  const late=await actor('assign_late');await ok('/invitations/accept',late,'POST',{token:invite});await ok(`/groups/${nest.id}/join`,late,'POST');
  assert.equal((await req(`/messages/${id}/assignments`,late)).status,404);assert.equal((await req(`/messages/${id}/assignments/operations?version=0`,late)).status,404);
  assert.equal((await ok(`/messages/${id}/assignments/roster`,owner)).readers.length,3);
  await apply(owner,{action:'complete',itemId:initial.items[0].id,completed:true});
  const state=await ok(`/messages/${id}/assignments`,owner),ops=await ok(`/messages/${id}/assignments/operations?version=${state.revision}`,owner);
  const decoded=[];for(const row of ops.operations){const value=await enc.open(owner.privateKey,row.message.signer_key,row.message.ciphertext);assert.equal(value.contentType,'assignment_op');const operation=parseAssignmentOperation(value.body,id,row.metadata);assert.ok(operation);decoded.push(operation);assert.equal(runtime.db.prepare('SELECT 1 FROM e2ee_recipients WHERE message_id=? AND user_id=?').get(row.message_id,late.id),undefined);}
  const projected=projectAssignments(initial,decoded);assert.equal(projected.items.length,4);assert.equal(projected.items[0].completed,true);assert.equal(projected.items[1].title,'Decorate the room');assert.equal(projected.allowMemberAdds,false);
  // A long-lived list replays multiple pages against a stable revision snapshot.
  for(let n=0;n<102;n++)await apply(owner,{action:'complete',itemId:initial.items[0].id,completed:n%2===0});
  const finalState=await ok(`/messages/${id}/assignments`,owner),page1=await ok(`/messages/${id}/assignments/operations?version=${finalState.revision}`,owner);
  assert.equal(page1.operations.length,100);assert.equal(page1.has_more,true);
  const page2=await ok(`/messages/${id}/assignments/operations?after=100&version=${finalState.revision}`,owner);
  assert.equal(page2.has_more,false);assert.equal(page1.operations.length+page2.operations.length,finalState.revision);
  assert.equal((await ok(`/messages/${id}/assignments/operations?version=${state.revision}`,owner)).operations.length,state.revision);
  assert.equal((await req(`/messages/${id}/assignments`,outsider)).status,403);
  assert.equal((await ok(`/groups/${nest.id}/messages`,owner)).messages.length,1);assert.equal((await ok(`/groups/${nest.id}/shared`,owner)).messages[0].id,id);assert.equal((await ok(`/groups/${nest.id}/threads/${id}`,owner)).messages.length,1);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n,notifications);assert.equal((await ok(`/communities/${tree.id}`,member)).community.circles[0].unread,0);
  for(const row of runtime.db.prepare('SELECT * FROM messages').all())assert.equal(row.body,'');
  runtime.close();runtime=createApp({dataDir:dir,testing:true,googleClientId:'',pushEnabled:false});assert.equal((await ok(`/messages/${id}/assignments`,owner)).revision,finalState.revision);
  await ok(`/groups/${nest.id}/join`,member,'DELETE');await ok(`/groups/${nest.id}/join`,member,'POST');assert.equal((await req(`/messages/${id}/assignments`,member)).status,404);
  await ok(`/messages/${id}`,owner,'DELETE');assert.equal((await req(`/messages/${id}/assignments`,owner)).status,404);assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM assignment_items').get().n,0);assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE message_kind='assignment_op' AND ciphertext IS NOT NULL").get().n,0);assert.deepEqual(runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
