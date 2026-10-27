import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
import * as enc from '../shared/encryption.js';
import {REACTION_EMOJIS,normalizeReaction,validateReactions,toggleReaction,reactionProof} from '../shared/reactions.js';

test('reactions are unique, removable, ordered and replace only the oldest when a sixth is added',()=>{
 assert.equal(REACTION_EMOJIS.length,80);assert.equal(normalizeReaction('❤'),'❤️');
 let values=[];for(const emoji of ['👍','❤️','😂','🎉','🐦','🥚'])values=toggleReaction(values,emoji);
 assert.deepEqual(values,['❤️','😂','🎉','🐦','🥚']);assert.deepEqual(toggleReaction(values,'❤'),['😂','🎉','🐦','🥚']);
 assert.deepEqual(toggleReaction(toggleReaction(['👍','😂'],'👍'),'👍'),['😂','👍']);
 for(const invalid of [null,'👍',['❤️','❤'],['👍','👍'],['👍','❤️','😂','🎉','🐦','🥚'],['not an emoji']])assert.throws(()=>validateReactions(invalid));
});
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'churp-reactions-'));let runtime,server,base;
 async function start(){runtime=createApp({dataDir:dir,testing:true,pushEnabled:false,googleClientId:''});server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api`;}
 async function stop(){runtime.close();await new Promise(r=>server.close(r));}await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 async function req(path,a,method='GET',body){const response=await fetch(base+path,{method,headers:{...(a?{cookie:a.cookie,'x-churp-device':a.deviceId}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r));return r.data;}
 async function actor(username,birth_date='1990-01-01'){
  const registered=await req('/auth/register',null,'POST',{username,name:username,birth_date,password:'Churp reaction fixture password!'}),a={...registered.data.user,cookie:registered.cookie,deviceId:randomUUID()};
  const identity=await ok('/e2ee/managed-device',a,'POST',{deviceId:a.deviceId,deviceName:username});a.privateKey=await enc.readPrivate(identity.privateKey);return a;
 }
 const owner=await actor('reaction_owner'),member=await actor('reaction_member'),outsider=await actor('reaction_outsider');
 const tree=(await ok('/communities',owner,'POST',{name:'Reaction Tree'})).community,invitation=await ok('/invitations',owner,'POST',{community_id:tree.id});
 const joinTree=async a=>ok('/invitations/accept',a,'POST',{token:invitation.code});await joinTree(member);
 const nest=(await ok(`/communities/${tree.id}/circles`,owner,'POST',{name:'Announcements',admin_only:true})).group;await ok(`/groups/${nest.id}/join`,member,'POST');
 async function message(a,channel,target,body='An encrypted message',replyTo=null){
  const rs=await ok(channel==='nest'?`/groups/${target}/e2ee/roster`:`/private/conversations/${target}/roster`,a),clientId=randomUUID();
  const contents=channel==='nest'?{version:1,kind:'nest-message',groupId:target,clientId,senderId:a.id,signerId:a.id,rosterHash:rs.roster_hash,replyTo,migrated:false,selfEncrypted:rs.self_encrypted,contentType:'chat',body,attachments:[]}:{version:1,kind:'private-message',conversationId:target,clientId,senderId:a.id,rosterHash:rs.roster_hash,selfEncrypted:rs.self_encrypted,body,attachments:[]};
  const ciphertext=await enc.seal(a.privateKey,rs.readers.map(r=>r.public_key),contents),proof=channel==='nest'?enc.sendPayload({groupId:target,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files:[],replyTo}):{conversationId:target,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files:[],sourceNest:null};
  return (await ok(channel==='nest'?`/groups/${target}/messages`:`/private/conversations/${target}/messages`,a,'POST',{clientId,ciphertext,rosterHash:rs.roster_hash,files:[],reply_to:replyTo,signature:await enc.sign(a.privateKey,channel==='nest'?'send':'private-send',proof)})).id;
 }
 async function prepare(a,channel,id,emojis,{latest,clientId=randomUUID()}={}){
  latest ||= await ok(`/reactions/${channel}/${id}`,a);const mine=latest.states.find(r=>r.user_id===a.id),expectedVersion=mine?.version||0,rs=latest.roster;
  const ciphertext=await enc.seal(a.privateKey,rs.readers.map(r=>r.public_key),{protocol:1,kind:'message-reactions',channel,messageId:id,userId:a.id,revision:expectedVersion+1,clientId,rosterHash:rs.roster_hash,emojis});
  const proof=reactionProof({channel,messageId:id,userId:a.id,expectedVersion,clientId,rosterHash:rs.roster_hash,reactionCount:emojis.length,cipherHash:await enc.digest(ciphertext)});
  return {expectedVersion,clientId,rosterHash:rs.roster_hash,reactionCount:emojis.length,ciphertext,signature:await enc.sign(a.privateKey,'message-reactions',proof)};
 }
 return {req,ok,actor,owner,member,outsider,tree,nest,joinTree,message,prepare,restart:async()=>{await stop();await start();},get db(){return runtime.db;}};
}
test('encrypted Nest and thread reactions persist, stay quiet, reject stale writes and preserve history boundaries',async t=>{
 const f=await fixture(t),{owner,member,outsider,nest}=f;
 const root=await f.message(owner,'nest',nest.id),reply=await f.message(owner,'nest',nest.id,'A thread reply',root);
 const before={messages:f.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,notifications:f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n};
 const first=await f.prepare(member,'nest',root,['👍','❤️']);let result=await f.ok(`/reactions/nest/${root}`,member,'PUT',first);assert.equal(result.states.length,1);
 assert.equal((await f.ok(`/reactions/nest/${root}`,member,'PUT',first)).states[0].version,1);
 assert.equal((await f.req(`/reactions/nest/${root}`,member,'PUT',{...first,reactionCount:6})).status,400);
 assert.equal((await f.req(`/reactions/nest/${reply}`,member,'PUT',first)).status,400,'Signature binds the target message');
 assert.equal((await f.req(`/reactions/nest/${root}`,outsider)).status,403);
 assert.deepEqual((await f.ok(`/reactions?channel=nest&ids=${root}`,member)).states.map(r=>r.user_id),[member.id]);
 const second=await f.prepare(member,'nest',root,['❤️','😂','🎉','🐦','🥚']),stale=await f.prepare(member,'nest',root,['🎉']);
 result=await f.ok(`/reactions/nest/${root}`,member,'PUT',second);assert.equal(result.states[0].version,2);
 assert.equal((await f.req(`/reactions/nest/${root}`,member,'PUT',stale)).status,409);
 assert.equal((await f.req(`/reactions/nest/${root}`,member,'PUT',{...await f.prepare(member,'nest',root,['👍']),body:'["👍"]'})).status,400);
 assert.equal((await f.req(`/reactions/nest/${root}`,member,'PUT',{...await f.prepare(member,'nest',root,['👍']),signature:'forged'})).status,400);
 const row=(await f.ok(`/reactions/nest/${root}`,owner)).states[0],opened=await enc.open(owner.privateKey,row.signer_key,row.ciphertext);assert.deepEqual(opened.emojis,['❤️','😂','🎉','🐦','🥚']);assert.equal(row.body,null);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,before.messages);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n,before.notifications);
 await f.ok(`/reactions/nest/${reply}`,member,'PUT',await f.prepare(member,'nest',reply,['👍']));
 await f.restart();assert.equal((await f.ok(`/reactions/nest/${root}`,member)).states[0].version,2);
 const late=await f.actor('reaction_late');await f.joinTree(late);await f.ok(`/groups/${nest.id}/join`,late,'POST');
 assert.equal((await f.req(`/reactions/nest/${root}`,late)).status,404);assert.equal((await f.req(`/reactions/nest/${root}`,late,'PUT',first)).status,404);
 assert.deepEqual((await f.ok(`/reactions?channel=nest&ids=${root}`,late)).states,[]);
 const oldAudience=await f.prepare(owner,'nest',root,['🎉']);await f.ok(`/groups/${nest.id}/join`,member,'DELETE');
 assert.equal((await f.req(`/reactions/nest/${root}`,member)).status,404);assert.equal((await f.req(`/reactions/nest/${root}`,owner,'PUT',oldAudience)).status,409);
 await f.ok(`/reactions/nest/${root}`,owner,'PUT',await f.prepare(owner,'nest',root,['🎉']));
 await f.ok(`/messages/${root}`,owner,'DELETE');assert.equal((await f.req(`/reactions/nest/${root}`,owner)).status,404);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM message_reactions WHERE nest_message_id=?').get(root).n,0);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('private reactions respect blocking, parental approval and read-only guardian access',async t=>{
 const f=await fixture(t),{owner,member,outsider}=f;
 const cid=(await f.ok('/private/conversations',owner,'POST',{user_id:member.id})).conversation.id,id=await f.message(owner,'private',cid);
 await f.ok(`/reactions/private/${id}`,member,'PUT',await f.prepare(member,'private',id,['❤️']));
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM private_messages').get().n,1);
 assert.equal((await f.req(`/reactions/private/${id}`,outsider)).status,404);
 await f.ok(`/private/conversations/${cid}/block`,owner,'PATCH',{blocked:true});assert.equal((await f.ok(`/reactions/private/${id}`,member)).can_react,false);
 assert.equal((await f.req(`/reactions/private/${id}`,member,'PUT',{})).status,403);
 const kid=await f.actor('reaction_child','2012-01-01'),parent=await f.actor('reaction_parent');
 const {code}=await f.ok('/family/codes',parent,'POST');await f.ok('/family/claim',kid,'POST',{code});const link=(await f.ok('/family',parent)).links.find(l=>l.child_id===kid.id);await f.ok(`/family/links/${link.id}/confirm`,parent,'POST',{confirm_parent:true});await f.joinTree(kid);
 const supervised=(await f.ok('/private/conversations',owner,'POST',{user_id:kid.id})).conversation.id;
 await f.ok('/family/approvals',parent,'POST',{child_id:kid.id,adult_id:owner.id,decision:'approved'});
 const mid=await f.message(owner,'private',supervised);await f.ok(`/reactions/private/${mid}`,kid,'PUT',await f.prepare(kid,'private',mid,['😊']));
 const path=`/reactions/private/${mid}?child_id=${kid.id}`,view=await f.ok(path,parent);assert.equal(view.can_react,false);assert.equal(view.states.length,1);assert.deepEqual((await enc.open(parent.privateKey,view.states[0].signer_key,view.states[0].ciphertext)).emojis,['😊']);assert.equal((await f.req(path,parent,'PUT',{})).status,403);
 assert.equal((await f.req(`/reactions/private/${mid}`,parent)).status,404);
 await f.ok('/family/approvals',parent,'POST',{child_id:kid.id,adult_id:owner.id,decision:'declined'});assert.equal((await f.req(`/reactions/private/${mid}`,owner,'PUT',{})).status,403);
 await f.ok(`/family/links/${link.id}`,parent,'DELETE');assert.equal((await f.req(path,parent)).status,404);
});
