import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createApp} from '../server/app.js';
import * as enc from '../shared/encryption.js';
const password='Delete account fixture password!';
async function fixture(t,options={}){
 const dir=mkdtempSync(join(tmpdir(),'churp-reports-'));let runtime,server,base;
 async function start(){runtime=createApp({dataDir:dir,testing:true,googleClientId:'fixture.apps.googleusercontent.com',googleVerifyToken:async value=>JSON.parse(value),pushEnabled:false,mailer:null,schedulingAutoProcess:false,...options});server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api`;}
 async function stop(){runtime.close();await new Promise(r=>server.close(r));}await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 async function req(path,a,method='GET',body,headers={}){const form=body instanceof FormData,r=await fetch(base+path,{method,headers:{...(a?{cookie:a.cookie,...(a.device?{'x-churp-device':a.device}:{})}:{}),...(body&&!form?{'content-type':'application/json'}:{}),...headers},body:body?form?body:JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer()),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r));return r.data;}
 async function actor(username,youth=false){const r=await req('/auth/register',null,'POST',{username,name:username,password,birth_date:youth?'2012-01-01':'1990-01-01'});assert.equal(r.status,201);const a={...r.data.user,cookie:r.cookie,device:randomUUID()},keys=await ok('/e2ee/managed-device',a,'POST',{deviceId:a.device,deviceName:username});a.privateKey=await enc.readPrivate(keys.privateKey);return a;}
 async function link(parent,child){const {code}=await ok('/family/codes',parent,'POST');await ok('/family/claim',child,'POST',{code});const l=(await ok('/family',parent)).links.find(l=>l.child_id===child.id);await ok(`/family/links/${l.id}/confirm`,parent,'POST',{confirm_parent:true});}
 async function chat(a,b){return (await ok('/private/conversations',a,'POST',a===b?{self:true}:{username:b.username})).conversation;}
 async function privateRequest(a,id,body,attachments=[]){const rs=await ok(`/private/conversations/${id}/roster`,a),clientId=randomUUID(),files=attachments.map(f=>f.id),ciphertext=await enc.seal(a.privateKey,rs.readers.map(r=>r.public_key),{version:1,kind:'private-message',conversationId:id,clientId,senderId:a.id,rosterHash:rs.roster_hash,selfEncrypted:rs.self_encrypted,body,attachments}),payload={conversationId:id,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files,sourceNest:null};return {...payload,ciphertext,signature:await enc.sign(a.privateKey,'private-send',payload)};}
 async function nestRequest(a,gid,body){const rs=await ok(`/groups/${gid}/e2ee/roster`,a),clientId=randomUUID(),ciphertext=await enc.seal(a.privateKey,rs.readers.map(r=>r.public_key),{version:1,kind:'nest-message',groupId:gid,clientId,senderId:a.id,signerId:a.id,rosterHash:rs.roster_hash,replyTo:null,migrated:false,selfEncrypted:rs.self_encrypted,contentType:'chat',body,attachments:[]}),proof=enc.sendPayload({groupId:gid,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files:[],replyTo:null});return {clientId,ciphertext,rosterHash:rs.roster_hash,files:[],reply_to:null,message_kind:'chat',signature:await enc.sign(a.privateKey,'send',proof)};}
 async function attachment(a){const raw=enc.bytes('Retained encrypted upload'),encrypted=await enc.encryptFile(raw),form=new FormData();form.append('file',new Blob([encrypted.encrypted]),'shared.pgp');const file=(await ok('/e2ee/uploads',a,'POST',form)).file;return {id:file.id,name:'shared.txt',mime:'text/plain',size:raw.length,key:encrypted.key,sha256:encrypted.sha256};}
 return {ok,req,actor,link,chat,privateRequest,nestRequest,attachment,dir,restart:async()=>{await stop();await start();},get db(){return runtime.db;}};
}
async function operator(f){const a=await f.actor('dustin');f.db.prepare('INSERT INTO report_reviewers VALUES (?)').run(a.id);return a;}
async function share(f,reader,channel,id,options={}){const q=options.child?`?child_id=${options.child}`:'',ctx=await f.ok(`/reports/context/${channel}/${id}${q}`,reader);const r=await f.ok(channel==='nest'?`/groups/${options.gid}/messages`:`/private/conversations/${options.cid}/messages${q}`,reader);const m=r.messages.find(m=>m.id===id);return {reason:'harassment',details:'Please review this selected message.',consent:true,community_id:null,ciphertext:await enc.rewrap([reader.privateKey],ctx.public_key,m.ciphertext),...options.body};}
test('reports require explicit consent and original verified content; all go to Churp and only opted-in Tree admins',async t=>{
 const f=await fixture(t),admin=await operator(f),owner=await f.actor('tree_owner'),sender=await f.actor('sender'),reader=await f.actor('reader'),outsider=await f.actor('outsider');
 const tree=(await f.ok('/communities',owner,'POST',{name:'Safety Tree'})).community,g=(await f.ok(`/communities/${tree.id}/circles`,owner,'POST',{name:'Safety Nest'})).group;
 for(const a of [sender,reader]){f.db.prepare("INSERT INTO community_members VALUES (?,?,'member')").run(tree.id,a.id);f.db.prepare('INSERT INTO group_members(group_id,user_id) VALUES (?,?)').run(g.id,a.id);}
 const id=(await f.ok(`/groups/${g.id}/messages`,sender,'POST',await f.nestRequest(sender,g.id,'Verified selected Nest content'))).id,body=await share(f,reader,'nest',id,{gid:g.id});
 assert.equal((await f.req(`/reports/nest/${id}`,reader,'POST',{...body,consent:false})).status,400);
 assert.equal((await f.req(`/reports/nest/${id}`,outsider,'POST',body)).status,403);
 assert.equal((await f.req(`/reports/nest/${id}`,reader,'POST',{...body,community_id:'other-tree'})).status,403);
 const context=await f.ok(`/reports/context/nest/${id}`,reader),forged=await enc.seal(sender.privateKey,[context.public_key],{body:'Fabricated text'});
 assert.equal((await f.req(`/reports/nest/${id}`,reader,'POST',{...body,ciphertext:forged})).status,400);
 const r=await f.ok(`/reports/nest/${id}`,reader,'POST',body);assert.equal((await f.ok('/reports',admin)).queue.length,1);assert.equal((await f.ok('/reports',owner)).queue.length,0);
 assert.equal((await f.req(`/reports/${r.id}`,owner)).status,404);assert.equal((await f.req(`/reports/${r.id}`,sender)).status,404);assert.equal((await f.req(`/reports/${r.id}`,reader)).status,404);
 const detail=(await f.ok(`/reports/${r.id}`,admin)).report;assert.equal(detail.body,'Verified selected Nest content');assert.equal(detail.sender,'sender');assert.equal(detail.location,'Safety Nest');assert.equal(detail.attachment_count,0);
 assert.equal(JSON.stringify((await f.ok('/reports',reader)).mine).includes('Verified selected'),false);
 const stored=f.db.prepare('SELECT contents FROM safety_reports WHERE id=?').get(r.id).contents;assert.ok(!stored.includes('Verified selected'));assert.ok(!stored.includes('Please review'));
 assert.equal((await f.req(`/reports/nest/${id}`,reader,'POST',body)).status,409);
 const id2=(await f.ok(`/groups/${g.id}/messages`,sender,'POST',await f.nestRequest(sender,g.id,'Shared only when selected'))).id,shared=await share(f,reader,'nest',id2,{gid:g.id,body:{community_id:tree.id}}),r2=await f.ok(`/reports/nest/${id2}`,reader,'POST',shared);
 assert.equal((await f.ok('/reports',owner)).queue.length,1);assert.equal((await f.ok(`/reports/${r2.id}`,owner)).report.body,'Shared only when selected');
 f.db.prepare("UPDATE community_members SET role='member' WHERE community_id=? AND user_id=?").run(tree.id,owner.id);assert.equal((await f.req(`/reports/${r2.id}`,owner)).status,404);assert.equal((await f.req(`/reports/${r2.id}`,owner,'PATCH',{expected_version:0,status:'resolved'})).status,404);
 assert.ok(f.db.prepare("SELECT COUNT(*) n FROM report_audit WHERE report_id=? AND event='viewed'").get(r.id).n>0);await f.restart();assert.equal((await f.ok(`/reports/${r.id}`,admin)).report.body,'Verified selected Nest content');
});
test('private reports share only a chosen message; scope, moderation and private blocking remain separate',async t=>{
 const f=await fixture(t),admin=await operator(f),treeAdmin=await f.actor('private_tree_admin'),a=await f.actor('private_sender'),b=await f.actor('private_reader'),outsider=await f.actor('private_outsider');
 const tree=(await f.ok('/communities',treeAdmin,'POST',{name:'Mutual Tree'})).community;for(const u of [a,b])f.db.prepare("INSERT INTO community_members VALUES (?,?,'member')").run(tree.id,u.id);
 const c=await f.chat(a,b),id=(await f.ok(`/private/conversations/${c.id}/messages`,a,'POST',await f.privateRequest(a,c.id,'Selected private message'))).id;
 const secret=(await f.ok(`/private/conversations/${c.id}/messages`,a,'POST',await f.privateRequest(a,c.id,'Unreported private history stays private'))).id;
 const body=await share(f,b,'private',id,{cid:c.id,body:{community_id:tree.id}}),report=await f.ok(`/reports/private/${id}`,b,'POST',body);
 assert.equal((await f.ok(`/reports/${report.id}`,treeAdmin)).report.body,'Selected private message');assert.equal((await f.req(`/private/conversations/${c.id}/messages`,treeAdmin)).status,404);
 const s=(await f.ok(`/reports/${report.id}`,admin)).report;assert.ok(!JSON.stringify(s).includes('Unreported'));assert.ok(!Object.hasOwn(s,'ciphertext'));assert.ok(!Object.hasOwn(s,'attachments'));
 assert.equal((await f.req(`/reports/context/private/${id}`,outsider)).status,404);assert.equal((await f.req(`/reports/block/private/${id}`,outsider,'POST')).status,404);
 await f.ok(`/reports/${report.id}`,treeAdmin,'PATCH',{expected_version:0,status:'in_review',note:'Reviewing safely'});assert.equal((await f.req(`/reports/${report.id}`,admin,'PATCH',{expected_version:0,status:'resolved'})).status,409);
 await f.ok(`/reports/${report.id}`,admin,'PATCH',{expected_version:1,status:'resolved',action:'remove_message',note:'Removed selected message'});
 const messages=(await f.ok(`/private/conversations/${c.id}/messages`,b)).messages;assert.equal(messages.find(m=>m.id===id).ciphertext,null);assert.ok(messages.find(m=>m.id===secret).ciphertext);assert.equal((await f.ok(`/reports/${report.id}`,admin)).report.body,'Selected private message');
 assert.ok(!JSON.stringify((await f.ok('/reports',b)).mine).includes('Removed selected'));
 await f.ok(`/reports/block/private/${secret}`,b,'POST');assert.equal((await f.req(`/private/conversations/${c.id}/messages`,a,'POST',{})).status,403);
});
test('parents can report pending first messages while youth cannot read them; removal preserves parent review',async t=>{
 const f=await fixture(t),admin=await operator(f),parent=await f.actor('report_parent'),child=await f.actor('report_child',true),adult=await f.actor('report_adult');await f.link(parent,child);
 const c=await f.chat(adult,child),id=(await f.ok(`/private/conversations/${c.id}/messages`,adult,'POST',await f.privateRequest(adult,c.id,'First message for parent review'))).id;
 assert.equal((await f.req(`/reports/context/private/${id}`,child)).status,404);
 const body=await share(f,parent,'private',id,{cid:c.id,child:child.id}),r=await f.ok(`/reports/private/${id}?child_id=${child.id}`,parent,'POST',body);
 assert.equal((await f.req(`/reports/block/private/${id}?child_id=${child.id}`,parent,'POST')).status,400);
 await f.ok(`/reports/${r.id}`,admin,'PATCH',{expected_version:0,status:'resolved',action:'remove_message'});
 const history=(await f.ok(`/private/conversations/${c.id}/messages?child_id=${child.id}`,parent)).messages;assert.ok(history.find(m=>m.id===id).ciphertext);assert.equal(history[0].deleted,1);assert.equal((await f.ok(`/reports/${r.id}`,admin)).report.body,'First message for parent review');
});
test('Nest blocking uses existing private blocks without granting approvals, and operator permissions survive username reuse',async t=>{
 const f=await fixture(t),admin=await f.actor('dustin');await f.restart();assert.equal((await f.ok('/reports',admin)).can_review,true);await f.ok('/me/username',admin,'PATCH',{username:'renamed_operator'});const fake=await f.actor('dustin');await f.restart();assert.equal((await f.ok('/reports',admin)).can_review,true);assert.equal((await f.ok('/reports',fake)).can_review,false);
 const a=await f.actor('nest_sender'),b=await f.actor('nest_reader'),tree=(await f.ok('/communities',a,'POST',{name:'Block Tree'})).community,g=(await f.ok(`/communities/${tree.id}/circles`,a,'POST',{name:'Block Nest'})).group;f.db.prepare("INSERT INTO community_members VALUES (?,?,'member')").run(tree.id,b.id);f.db.prepare('INSERT INTO group_members(group_id,user_id) VALUES (?,?)').run(g.id,b.id);
 const id=(await f.ok(`/groups/${g.id}/messages`,a,'POST',await f.nestRequest(a,g.id,'Block from Nest options'))).id;await f.ok(`/reports/block/nest/${id}`,b,'POST');const c=f.db.prepare('SELECT * FROM private_conversations WHERE user_low=? AND user_high=?').get(...[a.id,b.id].sort());assert.equal(c.user_low===b.id?c.blocked_low:c.blocked_high,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM private_approvals').get().n,0);assert.equal((await f.ok('/reports',admin)).queue.length,0);
});
test('reports retain only selected text after sender and Tree deletion, excluding shared attachment keys and contents',async t=>{
 const f=await fixture(t),admin=await operator(f),owner=await f.actor('retention_owner'),a=await f.actor('retention_sender'),b=await f.actor('retention_reader'),tree=(await f.ok('/communities',owner,'POST',{name:'Temporary Tree'})).community;
 for(const u of [a,b])f.db.prepare("INSERT INTO community_members VALUES (?,?,'member')").run(tree.id,u.id);
 const c=await f.chat(a,b),file=await f.attachment(a),id=(await f.ok(`/private/conversations/${c.id}/messages`,a,'POST',await f.privateRequest(a,c.id,'Text with private attachment',[file]))).id;
 const body=await share(f,b,'private',id,{cid:c.id,body:{community_id:tree.id}}),r=await f.ok(`/reports/private/${id}`,b,'POST',body);let detail=(await f.ok(`/reports/${r.id}`,admin)).report;
 assert.equal(detail.attachment_count,1);assert.ok(!JSON.stringify(detail).includes(file.key));assert.ok(!JSON.stringify(detail).includes(file.id));assert.equal((await f.req(`/reports/${r.id}/files/${file.id}`,admin)).status,404);
 await f.ok('/me/deletion',a,'DELETE',{confirmation:'DELETE',currentPassword:password});detail=(await f.ok(`/reports/${r.id}`,admin)).report;assert.equal(detail.body,'Text with private attachment');assert.equal(detail.sender,'Unknown');
 await f.ok(`/communities/${tree.id}`,owner,'DELETE',{confirm_name:tree.name});assert.equal(f.db.prepare('SELECT community_id FROM safety_reports WHERE id=?').get(r.id).community_id,null);assert.equal((await f.req(`/reports/${r.id}`,owner)).status,404);assert.equal((await f.ok(`/reports/${r.id}`,admin)).report.body,'Text with private attachment');assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
