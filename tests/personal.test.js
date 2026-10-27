import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
import * as enc from '../shared/encryption.js';
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'churp-personal-'));let runtime,server,base;
 async function start(){runtime=createApp({dataDir:dir,testing:true,pushEnabled:false,googleClientId:'',appUrl:'http://localhost:3000'});server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api`;}
 async function stop(){runtime.close();await new Promise(r=>server.close(r));}await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 async function req(path,a,method='GET',body){const form=body instanceof FormData;const r=await fetch(base+path,{method,headers:{...(a?{cookie:a.cookie,...(a.device?{'x-churp-device':a.device}:{})}:{}),...(body&&!form?{'content-type':'application/json'}:{})},body:body?form?body:JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer()),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r.data));return r.data;}
 async function actor(name){const r=await req('/auth/register',null,'POST',{birth_date:'1990-01-01',username:name,name,password:'Personal messaging fixture!'});const a={...r.data.user,cookie:r.cookie,device:randomUUID()};const keys=await ok('/e2ee/managed-device',a,'POST',{deviceId:a.device,deviceName:name});a.privateKey=await enc.readPrivate(keys.privateKey);return a;}
 const owner=await actor('owner'),bob=await actor('bob'),carol=await actor('carol'),outsider=await actor('outsider');const tree=(await ok('/communities',owner,'POST',{name:'Personal Tree'})).community;const invite=await ok('/invitations',owner,'POST',{community_id:tree.id});for(const a of [bob,carol])await ok('/invitations/accept',a,'POST',{token:invite.code});
 async function prepare(a,cid,body,attachments=[],clientId=randomUUID()){const rs=await ok(`/private/conversations/${cid}/roster`,a);const files=attachments.map(f=>f.id),ciphertext=await enc.seal(a.privateKey,rs.readers.map(r=>r.public_key),{version:1,kind:'private-message',conversationId:cid,clientId,senderId:a.id,rosterHash:rs.roster_hash,selfEncrypted:rs.self_encrypted,body,attachments});const payload={conversationId:cid,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files,sourceNest:null};return {clientId,ciphertext,rosterHash:rs.roster_hash,files,sourceNest:null,signature:await enc.sign(a.privateKey,'private-send',payload)};}
 return {req,ok,actor,owner,bob,carol,outsider,tree,prepare,restart:async()=>{await stop();await start();},get db(){return runtime.db;}};
}
test('contacts and overlapping Birdhouses remain owner-only, normalize phones and persist without granting memberships',async t=>{
 const f=await fixture(t),{owner,bob,carol}=f;
 const contact=(await f.ok('/contacts',owner,'POST',{name:'Zelda',phone:'202-555-0123'})).contact;assert.equal(contact.phone,'+12025550123');assert.equal((await f.ok('/contacts',owner,'POST',{name:'Same phone',phone:'+1 (202) 555-0123'})).duplicate,true);
 assert.equal((await f.req('/contacts',owner,'POST',{name:'bad',phone:'garbage'})).status,400);assert.equal((await f.req('/contacts',owner,'POST',{name:'outsider',linked_user_id:f.outsider.id})).status,400);
 assert.equal((await f.req(`/contacts/${contact.id}`,bob,'PATCH',{name:'stolen'})).status,404);
 const first=(await f.ok('/birdhouses',owner,'POST',{name:'Family'})).birdhouse,second=(await f.ok('/birdhouses',owner,'POST',{name:'Friends'})).birdhouse;
 for(const b of [first,second])await f.ok(`/birdhouses/${b.id}/contacts`,owner,'PUT',{contact_ids:[contact.id]});
 assert.equal((await f.req(`/birdhouses/${first.id}/contacts`,bob,'PUT',{contact_ids:[contact.id]})).status,404);
 const foreign=(await f.ok('/contacts',bob,'POST',{name:'Private',phone:'+12025550124'})).contact;assert.equal((await f.req(`/birdhouses/${first.id}/contacts`,owner,'PUT',{contact_ids:[foreign.id]})).status,404);
 assert.equal((await f.ok('/contacts',owner)).memberships.length,2);await f.ok(`/birdhouses/${first.id}`,owner,'DELETE');assert.equal((await f.ok('/contacts',owner)).contacts.length,1);
 assert.equal((await f.req('/contacts/import',owner,'POST',{contacts:[{name:'Valid',phone:'+12025550125'},{name:'Invalid',phone:'bad'}]})).status,400);assert.equal((await f.ok('/contacts',owner)).contacts.length,1,'Import is atomic');
 const imported=await f.ok('/contacts/import',owner,'POST',{contacts:[{name:'Amy',phone:'+12025550125'},{name:'Same Amy',phone:'+12025550125'}]});assert.deepEqual(imported,{added:1,duplicates:1});
 const linked=(await f.ok('/contacts',owner,'POST',{name:'My Carol',linked_user_id:carol.id})).contact;
 await f.restart();assert.equal((await f.ok('/contacts',owner)).contacts.length,3);assert.equal((await f.ok('/contacts',bob)).contacts.length,1);
 await f.ok(`/contacts/${linked.id}`,owner,'DELETE');await f.ok('/contacts',owner,'DELETE',{confirm:true});assert.equal((await f.ok('/contacts',owner)).memberships.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM group_members').get().n,0);
});
test('private conversations encrypt only for two participants, protect files, enforce blocking and deduplicate retries',async t=>{
 const f=await fixture(t),{owner,bob,carol,outsider}=f;
 const cid=(await f.ok('/private/conversations',owner,'POST',{user_id:bob.id})).conversation.id;
 assert.equal((await f.ok('/private/conversations',bob,'POST',{user_id:owner.id})).conversation.id,cid);
 assert.equal((await f.req('/private/conversations',owner,'POST',{user_id:outsider.id})).status,403);
 assert.equal((await f.req(`/private/conversations/${cid}/roster`,carol)).status,404);assert.equal((await f.req(`/private/conversations/${cid}/messages`,carol)).status,404);
 const plain=enc.bytes('Private attachment content'),encrypted=await enc.encryptFile(plain),form=new FormData();form.append('file',new Blob([encrypted.encrypted]),'attachment.pgp');const file=(await f.ok('/e2ee/uploads',owner,'POST',form)).file;
 const attachment={id:file.id,name:'private.txt',size:plain.length,mime:'application/octet-stream',key:encrypted.key,sha256:encrypted.sha256};
 const prepared=await f.prepare(owner,cid,'Secret direct content',[attachment]);const sent=await f.ok(`/private/conversations/${cid}/messages`,owner,'POST',prepared);assert.equal((await f.ok(`/private/conversations/${cid}/messages`,owner,'POST',prepared)).id,sent.id);
 const rows=(await f.ok(`/private/conversations/${cid}/messages`,bob)).messages;assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes('Secret direct content'));assert.equal((await enc.open(bob.privateKey,owner.privateKey.toPublic().armor(),rows[0].ciphertext)).body,'Secret direct content');
 assert.deepEqual(await enc.decryptFile((await f.req(`/files/${file.id}`,bob)).data,attachment),plain);assert.equal((await f.req(`/files/${file.id}`,carol)).status,404);
 const list=(await f.ok('/private/conversations',bob)).conversations;assert.equal(list[0].id,cid);assert.equal(list[0].peer_id,owner.id);assert.equal(list[0].unread,1);assert.equal((await f.ok('/badges',bob)).private,1);await f.ok(`/private/conversations/${cid}/read`,bob,'POST',{through:sent.id});assert.equal((await f.ok('/private/conversations',bob)).conversations[0].unread,0);assert.equal((await f.ok('/badges',bob)).count,0);
 const another=(await f.ok('/private/conversations',owner,'POST',{user_id:carol.id})).conversation.id;assert.equal((await f.req(`/private/conversations/${another}/messages`,owner,'POST',prepared)).status,409);
 const nestSignature={...prepared,clientId:randomUUID()};assert.equal((await f.req(`/private/conversations/${cid}/messages`,owner,'POST',nestSignature)).status,400);
 const blockedDraft=await f.prepare(owner,cid,'No blocked sends');await f.ok(`/private/conversations/${cid}/block`,bob,'PATCH',{blocked:true});assert.equal((await f.req(`/private/conversations/${cid}/messages`,owner,'POST',blockedDraft)).status,403);await f.ok(`/private/conversations/${cid}/block`,owner,'PATCH',{blocked:false});assert.equal((await f.req(`/private/conversations/${cid}/messages`,owner,'POST',blockedDraft)).status,403);await f.ok(`/private/conversations/${cid}/block`,bob,'PATCH',{blocked:false});await f.ok(`/private/conversations/${cid}/messages`,owner,'POST',blockedDraft);
 await f.restart();assert.equal((await f.ok(`/private/conversations/${cid}/messages`,bob)).messages.length,2);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM groups').get().n,0,'Private conversations never create Nests');
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('member invitation links request approval; Branch admins approve Tree membership without granting private Nest access',async t=>{
 const f=await fixture(t),{owner,bob,carol,outsider,tree}=f;
 const branch=(await f.ok(`/communities/${tree.id}/subcommunities`,owner,'POST',{name:'Youth'})).subcommunity;await f.ok(`/admins/subcommunity/${branch.id}/${carol.id}`,owner,'PUT',{enabled:true});
 const privateNest=(await f.ok(`/communities/${tree.id}/circles`,owner,'POST',{name:'Hidden',private:true})).group;
 const direct=(await f.ok('/private/conversations',bob,'POST',{user_id:owner.id})).conversation.id;const draft=await f.prepare(bob,direct,'No Nest shortcut');assert.equal((await f.req(`/private/conversations/${direct}/messages`,bob,'POST',{...draft,sourceNest:privateNest.id})).status,403);
 assert.equal((await f.req(`/groups/${privateNest.id}/individual-recipients`,bob)).status,403);assert.equal((await f.ok(`/groups/${privateNest.id}/individual-recipients`,owner)).people.length,0);
 const share=await f.ok('/invitations',bob,'POST',{community_id:tree.id});assert.equal(share.requires_approval,true);const result=await f.ok('/invitations/accept',outsider,'POST',{token:share.code});assert.equal(result.pending,true);assert.equal((await f.ok('/communities',outsider)).communities.length,0);
 const pending=(await f.ok('/tree-join-requests',carol)).requests[0];assert.equal(pending.can_review,true);assert.equal((await f.req(`/tree-join-requests/${pending.id}/review`,bob,'POST',{decision:'approve'})).status,403);
 await f.restart();await f.ok(`/tree-join-requests/${pending.id}/review`,carol,'POST',{decision:'approve'});assert.equal((await f.ok('/communities',outsider)).communities[0].id,tree.id);assert.equal((await f.ok(`/communities/${tree.id}`,outsider)).community.circles.length,0);assert.equal((await f.req(`/tree-join-requests/${pending.id}/review`,owner,'POST',{decision:'approve'})).status,409);
 const branchInvite=await f.ok('/invitations',carol,'POST',{community_id:tree.id});assert.equal(branchInvite.requires_approval,false);
});

test('Tree member directory exposes only shared Trees; Nest recipient scopes require membership or administration',async t=>{
 const f=await fixture(t),{owner,bob,carol,outsider,tree}=f;
 const other=(await f.ok('/communities',bob,'POST',{name:'Bob private Tree'})).community;
 const directory=await f.ok('/private/people',owner);assert.deepEqual(directory.trees.map(t=>t.id),[tree.id]);assert.deepEqual(directory.people.find(p=>p.id===bob.id).tree_ids,[tree.id]);assert.ok(!JSON.stringify(directory).includes(other.id));assert.ok(!directory.people.some(p=>p.id===outsider.id));
 const nest=(await f.ok(`/communities/${tree.id}/circles`,owner,'POST',{name:'Hidden roster',private:true})).group;
 assert.equal((await f.req(`/contacts/recipient-scopes?tree_id=${tree.id}`,outsider)).status,403);
 assert.deepEqual((await f.ok(`/contacts/recipient-scopes?tree_id=${tree.id}`,bob)).nests,[]);
 const inv=await f.ok('/invitations',owner,'POST',{community_id:tree.id,group_id:nest.id});await f.ok('/invitations/accept',bob,'POST',{token:inv.code});
 const scopes=await f.ok(`/contacts/recipient-scopes?tree_id=${tree.id}`,bob);assert.equal(scopes.nests[0].id,nest.id);assert.ok(scopes.nests[0].member_ids.includes(owner.id));assert.ok(!scopes.nests[0].member_ids.includes(carol.id));
});
test('contact import atomically creates or uses an owned Birdhouse and includes existing duplicates',async t=>{
 const f=await fixture(t),{owner,bob}=f;
 const rows=[{name:'One',phone:'+12025550123'},{name:'Two',phone:'+12025550124'}];
 await f.ok('/contacts',owner,'POST',rows[0]);
 assert.deepEqual(await f.ok('/contacts/import',owner,'POST',{contacts:rows,new_birdhouse_name:'Party helpers'}),{added:1,duplicates:1});
 let data=await f.ok('/contacts',owner);assert.equal(data.birdhouses[0].name,'Party helpers');assert.equal(data.birdhouses[0].contact_count,2);const house=data.birdhouses[0].id;
 await f.ok('/contacts/import',owner,'POST',{contacts:rows,birdhouse_id:house});assert.equal((await f.ok('/contacts',owner)).memberships.length,2);
 const foreign=(await f.ok('/birdhouses',bob,'POST',{name:'Private house'})).birdhouse;
 assert.equal((await f.req('/contacts/import',owner,'POST',{contacts:[{name:'Three',phone:'+12025550125'}],birdhouse_id:foreign.id})).status,404);
 assert.equal((await f.req('/contacts/import',owner,'POST',{contacts:[{name:'Bad',phone:'invalid'}],new_birdhouse_name:'No orphan'})).status,400);
 assert.equal((await f.ok('/contacts',owner)).birdhouses.length,1);assert.equal((await f.ok('/contacts',owner)).contacts.length,2);
 const linked=await f.ok('/contacts',owner,'POST',{name:'Bob',linked_user_id:bob.id,new_birdhouse_name:'Friends'});assert.equal((await f.ok('/contacts',owner)).memberships.length,3);assert.ok(linked.contact.linked_user_id===bob.id);
});

test('bulk Tree contacts use account names without phone entry, deduplicate, and add to owned Birdhouses',async t=>{
 const f=await fixture(t),{owner,bob,carol}=f;
 const bobContact=(await f.ok('/contacts',owner,'POST',{name:'My Bob',phone:'+12025550123',linked_user_id:bob.id})).contact;
 const result=await f.ok('/contacts/from-tree',owner,'POST',{user_ids:[bob.id,carol.id],name:'Do not trust this name',phone:'+12025550124',new_birdhouse_name:'Tree friends'});assert.deepEqual(result,{added:1,duplicates:1,assigned:2});
 let data=await f.ok('/contacts',owner);assert.equal(data.contacts.length,2);assert.equal(data.contacts.find(c=>c.id===bobContact.id).name,'My Bob');assert.equal(data.contacts.find(c=>c.id===bobContact.id).phone,'+12025550123');const c=data.contacts.find(c=>c.linked_user_id===carol.id);assert.equal(c.name,carol.name);assert.equal(c.phone,null);assert.equal(data.birdhouses[0].contact_count,2);
 assert.deepEqual(await f.ok('/contacts/from-tree',owner,'POST',{user_ids:[bob.id,carol.id],birdhouse_id:data.birdhouses[0].id}),{added:0,duplicates:2,assigned:0});
 const second=(await f.ok('/birdhouses',owner,'POST',{name:'Another list'})).birdhouse;assert.equal((await f.ok('/contacts/from-tree',owner,'POST',{user_ids:[bob.id,carol.id],birdhouse_id:second.id})).assigned,2);assert.equal((await f.ok('/contacts',bob)).contacts.length,0);
 await f.restart();data=await f.ok('/contacts',owner);assert.equal(data.contacts.length,2);assert.equal(data.memberships.length,4);
});
test('bulk Tree contacts validate every member and destination before saving anything',async t=>{
 const f=await fixture(t),{owner,bob,carol,outsider}=f;
 for(const user_ids of [[],[bob.id,bob.id],[owner.id],[null]])assert.equal((await f.req('/contacts/from-tree',owner,'POST',{user_ids})).status,400);
 assert.equal((await f.req('/contacts/from-tree',owner,'POST',{user_ids:[bob.id,outsider.id],new_birdhouse_name:'No partial save'})).status,400);let data=await f.ok('/contacts',owner);assert.equal(data.contacts.length,0);assert.equal(data.birdhouses.length,0);
 const foreign=(await f.ok('/birdhouses',bob,'POST',{name:'Private'})).birdhouse;assert.equal((await f.req('/contacts/from-tree',owner,'POST',{user_ids:[bob.id,carol.id],birdhouse_id:foreign.id})).status,404);assert.equal((await f.ok('/contacts',owner)).contacts.length,0);
});
