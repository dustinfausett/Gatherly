import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
import {createPushNotifications} from '../server/push-notifications.js';
import {sealNotificationPreviews,previewProof,previewText} from '../shared/notification-previews.js';
import * as enc from '../shared/encryption.js';

test('previews show text beginnings, safe Unicode, activity titles and attachment labels',async()=>{
 assert.equal(await sealNotificationPreviews(null,Array.from({length:501},()=>({})),{kind:'chat'}),undefined);
 assert.equal(previewText('Hello\n  friends'),'Hello friends');assert.equal(previewText('😀'.repeat(130)),'😀'.repeat(120)+'…');assert.equal(previewText('',[{mime:'image/png'}]),'Photo');assert.equal(previewText('',[{mime:'application/pdf'}]),'Attachment');assert.equal(previewText(JSON.stringify({title:'Our picnic'}),[],'poll'),'Poll: Our picnic');
});
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'churp-push-'));let runtime,server,base,time=1000000;const deliveries=[];
 const sender=async(subscription,body)=>{deliveries.push({subscription,payload:JSON.parse(body)});};
 async function start(){runtime=createApp({dataDir:dir,testing:true,googleClientId:'',pushEnabled:true,pushSender:sender,pushNow:()=>time,pushAutoProcess:false});server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api`;}
 async function stop(){runtime.close();await new Promise(r=>server.close(r));}await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 async function req(path,a,method='GET',body){const r=await fetch(base+path,{method,headers:{...(a?{cookie:a.cookie,'x-churp-device':a.deviceId}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r));return r.data;}
 async function actor(username,self=false){const r=await req('/auth/register',null,'POST',{birth_date:'1990-01-01',username,name:username,password:'Push notification fixture!'}),a={...r.data.user,cookie:r.cookie,deviceId:randomUUID()};
  if(self){const keys=await enc.generateIdentity(a.id),backup=await enc.protectPrivate(keys.privateKey,enc.randomSecret()),payload=enc.enrollmentPayload({userId:a.id,publicKey:keys.publicKey,backupHash:await enc.digest(backup),deviceId:a.deviceId,deviceName:username});await ok('/e2ee/identity',a,'POST',{...payload,backup,signature:await enc.sign(keys.privateKey,'enroll',payload)});a.privateKey=keys.privateKey;}
  else{const keys=await ok('/e2ee/managed-device',a,'POST',{deviceId:a.deviceId,deviceName:username});a.privateKey=await enc.readPrivate(keys.privateKey);}return a;
 }
 const owner=await actor('push_owner'),member=await actor('push_member',true),tree=(await ok('/communities',owner,'POST',{name:'Notification Tree'})).community,invite=await ok('/invitations',owner,'POST',{community_id:tree.id});await ok('/invitations/accept',member,'POST',{token:invite.code});
 const nest=(await ok(`/communities/${tree.id}/circles`,owner,'POST',{name:'First Nest'})).group;await ok(`/groups/${nest.id}/join`,member,'POST');
 async function prepare(body,channel='nest',target=nest.id,withPreview=true){const rs=await ok(channel==='nest'?`/groups/${target}/e2ee/roster`:`/private/conversations/${target}/roster`,owner),clientId=randomUUID(),notificationPreviews=withPreview?await sealNotificationPreviews(owner.privateKey,rs.readers,{senderId:owner.id,clientId,channel,body}):undefined;
  const contents=channel==='nest'?{version:1,kind:'nest-message',groupId:target,clientId,senderId:owner.id,signerId:owner.id,rosterHash:rs.roster_hash,replyTo:null,migrated:false,selfEncrypted:rs.self_encrypted,contentType:'chat',body,attachments:[]}:{version:1,kind:'private-message',conversationId:target,clientId,senderId:owner.id,rosterHash:rs.roster_hash,selfEncrypted:rs.self_encrypted,body,attachments:[]};
  const ciphertext=await enc.seal(owner.privateKey,rs.readers.map(r=>r.public_key),contents),hash=await previewProof(notificationPreviews),proof=channel==='nest'?enc.sendPayload({groupId:target,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files:[],replyTo:null,...hash}):{conversationId:target,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files:[],sourceNest:null,...hash};
  return {notificationPreviews,clientId,ciphertext,rosterHash:rs.roster_hash,files:[],signature:await enc.sign(owner.privateKey,channel==='nest'?'send':'private-send',proof)};
 }
 for(const device of ['phone','tablet'])await ok('/push/subscribe',member,'POST',{subscription:{endpoint:`https://fcm.googleapis.com/${device}`,keys:{p256dh:'fixture',auth:'fixture'}}});
 return {req,ok,actor,owner,member,nest,tree,prepare,deliveries,restart:async()=>{await stop();await start();},setTime:value=>time=value,get time(){return time;},get runtime(){return runtime;},get db(){return runtime.db;}};
}
test('default encrypted previews, account privacy, durable 30-second coalescing and current message access',async t=>{
 const f=await fixture(t),{owner,member,nest}=f;
 assert.equal((await f.ok('/me',member)).user.notification_previews,true);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM e2ee_managed_keys WHERE user_id=?').get(member.id).n,0,'Self-managed preview keys never go to Churp');
 const send=async(body,channel='nest',id=nest.id)=>f.ok(channel==='nest'?`/groups/${id}/messages`:`/private/conversations/${id}/messages`,owner,'POST',await f.prepare(body,channel,id));
 const first=await send('First secret message for the lock screen');assert.equal(f.deliveries.length,2);const packet=f.deliveries[0].payload;assert.equal(packet.unread_count,1);assert.equal(packet.title,'New message on Churp');assert.equal(JSON.stringify(packet).includes('First secret'),false);assert.equal(packet.preview.sender_name,owner.name);
 assert.equal((await enc.open(member.privateKey,packet.preview.signer_key,packet.preview.ciphertext)).text,'First secret message for the lock screen');
 const q=`?channel=nest&message_id=${first.id}&client_id=${packet.preview.client_id}&sender_id=${owner.id}`;assert.equal((await f.ok('/push/privacy'+q,member)).can_preview,true);
 f.setTime(f.time+1000);await send('Second secret');await send('Third secret');assert.equal(f.deliveries.length,2);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pending_push_alerts').get().n,1);assert.equal(f.db.prepare('SELECT payload FROM pending_push_alerts').get().payload.includes('Third secret'),false);
 await f.restart();f.setTime(1029999);await f.runtime.push.processDue();assert.equal(f.deliveries.length,2);f.setTime(1030000);await f.runtime.push.processDue();assert.equal(f.deliveries.length,4);assert.equal(f.deliveries[2].payload.unread_count,3);assert.equal((await enc.open(member.privateKey,f.deliveries[2].payload.preview.signer_key,f.deliveries[2].payload.preview.ciphertext)).text,'Third secret');
 assert.equal((await f.req('/me/notification-privacy',member,'PATCH',{show_previews:'false'})).status,400);
 await f.ok('/me/notification-privacy',member,'PATCH',{show_previews:false});assert.equal((await f.ok('/push/privacy'+q,member)).show_previews,false);
 const cid=(await f.ok('/private/conversations',owner,'POST',{user_id:member.id})).conversation.id;await send('Private secret in another channel','private',cid);assert.equal(f.deliveries.length,4,'Cooldown is shared across Nests and private chats');f.setTime(1060000);await f.runtime.push.processDue();assert.equal(f.deliveries.length,6);assert.equal(f.deliveries[4].payload.preview,undefined);assert.equal(f.deliveries[4].payload.body,'You have a private message.');
 await f.ok('/me/notification-privacy',member,'PATCH',{show_previews:true});const read=await send('Read this before the queued alert');await f.ok(`/groups/${nest.id}/membership`,member,'PATCH',{read_to:read.id});f.setTime(1090000);await f.runtime.push.processDue();assert.equal(f.deliveries.length,6,'Read pending messages do not alert');
 const muted=await send('Before muting');assert.equal(f.deliveries.length,8);await send('Do not alert after muting');await f.ok(`/groups/${nest.id}/membership`,member,'PATCH',{muted:true});f.setTime(1120000);await f.runtime.push.processDue();assert.equal(f.deliveries.length,8);assert.equal((await f.ok('/push/privacy'+q,member)).can_preview,true,'Muting stops new dispatches without revoking access to an already delivered message');
 await f.ok(`/messages/${muted.id}`,owner,'DELETE');assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('preview packets reject foreign recipients and tampering before any notification is sent',async t=>{
 const f=await fixture(t),draft=await f.prepare('A signed secret');
 assert.equal((await f.req(`/groups/${f.nest.id}/messages`,f.owner,'POST',{...draft,notificationPreviews:[]})).status,403);
 const foreign=await enc.generateIdentity('outsider');const bad=structuredClone(draft);bad.notificationPreviews[0].ciphertext=await enc.seal(f.owner.privateKey,[foreign.publicKey],{text:'wrong audience'});
 assert.equal((await f.req(`/groups/${f.nest.id}/messages`,f.owner,'POST',bad)).status,400);assert.equal(f.deliveries.length,0);
});
test('failed or expired subscriptions do not consume cooldown; simultaneous sends coalesce',async t=>{
 const f=await fixture(t),{member}=f;let time=2000000,count=0;
 const push=createPushNotifications({db:f.db,dataDir:join(tmpdir(),'unused'),enabled:false,send:async()=>{}});await push.notify(member.id,{});assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM push_alert_windows').get().n,0);
 // Exercise failed delivery through the same live dispatcher, without contacting a provider.
 const dir=mkdtempSync(join(tmpdir(),'churp-push-fail-'));const dispatcher=createPushNotifications({db:f.db,dataDir:dir,enabled:true,badge:()=>1,now:()=>time,autoProcess:false,send:async()=>{count++;throw Object.assign(new Error('Gone'),{statusCode:410});}});t.after(()=>{dispatcher.close();rmSync(dir,{recursive:true,force:true});});
 await Promise.all([dispatcher.notify(member.id,{title:'First'}),dispatcher.notify(member.id,{title:'Second'})]);assert.equal(count,2);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM push_alert_windows').get().n,0);
});

test('phone preview recovery handles old senders and read races without exposing plaintext, revoked access or private alerts',async t=>{
 const f=await fixture(t),{owner,member,nest}=f;
 const sent=await f.ok(`/groups/${nest.id}/messages`,owner,'POST',await f.prepare('A message without its own compact preview','nest',nest.id,false));
 assert.equal(f.deliveries[0].payload.preview,undefined);
 const query=`/push/message?channel=nest&message_id=${sent.id}`;
 let details=await f.ok(query,member);assert.equal(details.can_preview,true);assert.equal(details.context.sender_name,owner.name);assert.equal(details.context.context_name,nest.name);assert.equal(details.device_approved,true);assert.ok(!JSON.stringify(details).includes('A message without'));
 assert.equal((await enc.open(member.privateKey,details.message.signer_key,details.message.ciphertext)).body,'A message without its own compact preview');
 await f.ok(`/groups/${nest.id}/membership`,member,'PATCH',{read_to:sent.id});details=await f.ok(query,member);assert.equal(details.can_preview,true,'Reading is not an authorization failure');
 const noDevice=await f.ok(query,{...member,deviceId:randomUUID()});assert.equal(noDevice.device_approved,false);assert.equal(noDevice.message,undefined);assert.equal(noDevice.context.sender_name,owner.name);
 const outsider=await f.actor('preview_outsider');assert.equal((await f.ok(query,outsider)).can_preview,false);
 const cid=(await f.ok('/private/conversations',owner,'POST',{user_id:member.id})).conversation.id;
 const privateMessage=await f.ok(`/private/conversations/${cid}/messages`,owner,'POST',await f.prepare('Private fallback content','private',cid,false));
 const privateQuery=`/push/message?channel=private&message_id=${privateMessage.id}`;
 await f.ok(`/private/conversations/${cid}/read`,member,'POST',{through:privateMessage.id});const privateDetails=await f.ok(privateQuery,member);assert.equal(privateDetails.can_preview,true);assert.equal(privateDetails.context.context_name,null);assert.equal((await enc.open(member.privateKey,privateDetails.message.signer_key,privateDetails.message.ciphertext)).body,'Private fallback content');
 await f.ok('/me/notification-privacy',member,'PATCH',{show_previews:false});details=await f.ok(query,member);assert.equal(details.show_previews,false);assert.equal(details.context,undefined);assert.equal(details.message,undefined);
 await f.ok('/me/notification-privacy',member,'PATCH',{show_previews:true});
 await f.ok(`/private/conversations/${cid}/block`,member,'PATCH',{blocked:true});assert.equal((await f.ok(privateQuery,member)).can_preview,false);
 await f.ok(`/groups/${nest.id}/join`,member,'DELETE');assert.equal((await f.ok(query,member)).can_preview,false);
});
