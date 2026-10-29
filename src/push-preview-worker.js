import * as enc from '../shared/encryption.js';
import {loadKey,loadDeviceInfo,contactIdentity,trustIdentity} from './encryption/store.js';
import {previewText} from '../shared/notification-previews.js';

// Validate the same signed identity transitions as an open chat. A legitimate
// key rotation need not wait until this phone opens that person's conversation.
async function trustSigner(selfId,userId,key,readJson){
 const fingerprint=key.getFingerprint();
 if(key.getUserIDs().length!==1||key.getUserIDs()[0]!==`Churp account ${userId}`)throw new Error('Unexpected signing identity.');
 const known=await contactIdentity(selfId,userId);
 if(!known){await trustIdentity(selfId,userId,fingerprint);return;}
 if(known.fingerprint===fingerprint||known.historical?.includes(fingerprint))return;
 const info=await readJson(`/api/e2ee/identities/${encodeURIComponent(userId)}`);
 if(!Array.isArray(info.history)||info.history.length>100)throw new Error('Invalid key history.');
 const path=(from,to,seen=new Set())=>{
  if(from===to)return [];if(seen.has(from))return null;seen.add(from);
  for(const edge of info.history.filter(h=>h.fingerprint===from)){const rest=path(edge.next_fingerprint,to,new Set(seen));if(rest)return [edge,...rest];}return null;
 };
 const forward=path(known.fingerprint,fingerprint),backward=forward?null:path(fingerprint,known.fingerprint),anchor=path(known.fingerprint,info.fingerprint);
 if((!forward&&!backward)||!anchor||(await enc.readPublic(info.public_key)).getFingerprint()!==info.fingerprint)throw new Error('Untrusted signing identity.');
 for(const h of [...(forward||backward),...anchor]){
  const oldKey=await enc.readPublic(h.public_key),newKey=await enc.readPublic(h.payload.publicKey);
  if(h.payload.userId!==userId||h.payload.fromFingerprint!==h.fingerprint||h.payload.toFingerprint!==h.next_fingerprint||oldKey.getFingerprint()!==h.fingerprint||newKey.getFingerprint()!==h.next_fingerprint||oldKey.getUserIDs()[0]!==`Churp account ${userId}`||newKey.getUserIDs()[0]!==`Churp account ${userId}`)throw new Error('Invalid signed key transition.');
  await enc.verify(h.public_key,'self-managed-transition',h.payload,h.transition_signature);
 }
 await trustIdentity(selfId,userId,fingerprint,{fromFingerprint:known.fingerprint,historical:!!backward});
}
async function openPacket(local,signer,ciphertext){
 for(const privateKey of [local.privateKey,...await Promise.all((local.previousKeys||[]).map(enc.readPrivate))])try{return await enc.open(privateKey,signer,ciphertext);}catch{}
 throw new Error('This device could not decrypt the notification.');
}

// Keys and message decryption stay on the phone, including self-managed users.
self.churpPushPreview=async payload=>{
 const generic={title:payload.title||'Churp',body:payload.body||'You have a new message.'};
 if(!payload.recipient_id||!['nest','private'].includes(payload.source?.channel))return generic;
 const controller=new AbortController();let endBudget;
 const budget=new Promise(resolve=>{endBudget=resolve;}),timer=setTimeout(()=>{controller.abort();endBudget(null);},8000);
 let display=generic;
 try{
  const name=`account:${payload.recipient_id}`,localKey=loadKey(name).catch(()=>null);
  // Fetch access/contents while the private identity is being decoded; cold
  // phone workers should not spend their network budget waiting on crypto.
  const device=await Promise.race([loadDeviceInfo(name).catch(()=>null),budget]);
  const readJson=async path=>{
   const options={credentials:'include',cache:'no-store',signal:controller.signal,headers:device?{'x-churp-device':device.deviceId}:{}};
   let response;try{response=await fetch(path,options);}catch(e){if(controller.signal.aborted)throw e;response=await fetch(path,options);}
   if(response.status>=500&&!controller.signal.aborted)response=await fetch(path,options);
   if(!response.ok)throw new Error('Notification access unavailable.');return response.json();
  };
  const query=new URLSearchParams({channel:payload.source.channel,message_id:String(payload.source.messageId||'')});
  const policy=await readJson(`/api/push/message?${query}`);
  if(policy.user_id!==payload.recipient_id||!policy.show_previews||!policy.can_preview||!policy.context)return generic;
  const c=policy.context;
  display={title:previewText(c.sender_name)+(c.context_name?` · ${previewText(c.context_name)}`:''),body:'New message'};
  const local=await Promise.race([localKey,budget]);
  if(!local||!policy.device_approved||!policy.message)return display;
  const message=policy.message,key=await enc.readPublic(message.signer_key);
  if(key.getFingerprint()!==message.signer_fingerprint)return display;
  await trustSigner(payload.recipient_id,c.signer_id,key,readJson);
  const p=payload.preview;
  if(p?.ciphertext&&!c.edit_version&&p.client_id===c.client_id&&p.sender_id===c.sender_id&&p.channel===c.channel&&p.signer_fingerprint===message.signer_fingerprint){
   try{
    const value=await openPacket(local,message.signer_key,p.ciphertext);
    if(value.version===1&&value.kind==='notification-preview'&&value.recipientId===payload.recipient_id&&value.senderId===c.sender_id&&value.clientId===c.client_id&&value.channel===c.channel&&typeof value.text==='string'&&Array.from(value.text).length<=121)return {...display,body:value.text||'New message'};
   }catch{/* A full encrypted-message fallback handles missing/old preview packets. */}
  }
  const value=await openPacket(local,message.signer_key,message.ciphertext);
  if(value.version!==1||value.clientId!==c.client_id||value.senderId!==c.sender_id||value.rosterHash!==c.recipient_hash||typeof value.body!=='string'||value.body.length>10000||!Array.isArray(value.attachments)||value.attachments.length>5)return display;
  if(c.channel==='nest'?(value.kind!=='nest-message'||value.groupId!==c.group_id||value.signerId!==c.signer_id||value.replyTo!==c.reply_to||!!value.migrated!==c.client_id.startsWith('legacy-')||(value.editVersion||0)!==c.edit_version||(c.edit_version>0&&(value.editMessageId!==c.message_id||value.editClientId!==c.edit_client_id))):(value.kind!=='private-message'||value.conversationId!==c.conversation_id||value.selfEncrypted!==c.self_encrypted))return display;
  return {...display,body:previewText(value.body,value.attachments,value.contentType||c.content_type)||'New message'};
 }catch{return display;}finally{clearTimeout(timer);}
};
