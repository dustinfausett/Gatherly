import * as enc from '../shared/encryption.js';
import {loadKey,loadDeviceInfo,saveKey,contactIdentity,trustIdentity} from './encryption/store.js';
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
 try{return await enc.open(local.privateKey,signer,ciphertext);}catch{}
 // Most notifications use the current identity. Parse archived keys only when
 // needed, and do not let one unusable archive prevent trying the other keys.
 for(const archived of local.previousKeys||[])try{return await enc.open(await enc.readPrivate(archived),signer,ciphertext);}catch{}
 throw new Error('This device could not decrypt the notification.');
}

async function restoreManagedIdentity(name,userId,device,expectedFingerprint,readJson){
 const deviceName=device.deviceName||'Notification device',account=await readJson('/api/e2ee/managed-device',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:device.deviceId,deviceName})});
 const identity=account.identity,privateKey=await enc.readPrivate(account.privateKey),publicKey=await enc.readPublic(identity.public_key);
 if(identity.custody!=='managed'||identity.fingerprint!==expectedFingerprint||privateKey.getFingerprint()!==identity.fingerprint||publicKey.getFingerprint()!==identity.fingerprint||privateKey.getUserIDs().length!==1||privateKey.getUserIDs()[0]!==`Churp account ${userId}`)throw new Error('The restored notification identity does not match.');
 let previousKeys=[];
 if(identity.history_backup){
  const history=await enc.open(privateKey,identity.public_key,identity.history_backup);
  if(history.kind!=='key-history'||history.userId!==userId||!Array.isArray(history.keys)||history.keys.length>20)throw new Error('Invalid notification key history.');
  for(const key of history.keys){const k=await enc.readPrivate(key);if(k.getUserIDs().length!==1||k.getUserIDs()[0]!==`Churp account ${userId}`)throw new Error('Invalid archived notification identity.');}
  previousKeys=history.keys;
 }
 const local={privateKey,previousKeys,deviceId:device.deviceId,deviceName,recoveryConfirmed:true};
 // A transient storage failure must not discard an identity already restored
 // and verified for this alert. Keep trying local storage on the next opening.
 try{await saveKey(name,privateKey,{deviceId:local.deviceId,deviceName:local.deviceName,recoveryConfirmed:true,previousKeys});}catch{}
 return local;
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
  const readJson=async(path,extra={})=>{
   const options={credentials:'include',cache:'no-store',signal:controller.signal,...extra,headers:{...(device?{'x-churp-device':device.deviceId}:{}),...extra.headers}};
   let response;try{response=await fetch(path,options);}catch(e){if(controller.signal.aborted)throw e;response=await fetch(path,options);}
   if(response.status>=500&&!controller.signal.aborted)response=await fetch(path,options);
   if(!response.ok)throw new Error('Notification access unavailable.');return response.json();
  };
  const query=new URLSearchParams({channel:payload.source.channel,message_id:String(payload.source.messageId||'')});
  const policy=await readJson(`/api/push/message?${query}`);
  if(policy.user_id!==payload.recipient_id||!policy.show_previews||!policy.can_preview||!policy.context)return generic;
  const c=policy.context;
  display={title:previewText(c.sender_name)+(c.context_name?` · ${previewText(c.context_name)}`:''),body:'New message'};
  if(!policy.device_approved||!policy.message)return display;
  let local=await Promise.race([localKey,budget]),restored=false;
  const canRestore=policy.recipient_identity?.custody==='managed'&&!!device?.deviceId;
  const recover=async()=>{if(!canRestore||restored||controller.signal.aborted)return false;restored=true;local=await restoreManagedIdentity(name,payload.recipient_id,device,policy.recipient_identity.fingerprint,readJson);return true;};
  if(!local&&!await recover())return display;
  const decrypt=async(signer,ciphertext)=>{try{return await openPacket(local,signer,ciphertext);}catch(e){if(local.privateKey.getFingerprint()===policy.recipient_identity?.fingerprint||!await recover())throw e;return openPacket(local,signer,ciphertext);}};
  const message=policy.message,key=await enc.readPublic(message.signer_key);
  if(key.getFingerprint()!==message.signer_fingerprint)return display;
  await trustSigner(payload.recipient_id,c.signer_id,key,readJson);
  const p=payload.preview;
  if(p?.ciphertext&&!c.edit_version&&p.client_id===c.client_id&&p.sender_id===c.sender_id&&p.channel===c.channel&&p.signer_fingerprint===message.signer_fingerprint){
   try{
    const value=await decrypt(message.signer_key,p.ciphertext);
    if(value.version===1&&value.kind==='notification-preview'&&value.recipientId===payload.recipient_id&&value.senderId===c.sender_id&&value.clientId===c.client_id&&value.channel===c.channel&&typeof value.text==='string'&&Array.from(value.text).length<=121)return {...display,body:value.text||'New message'};
   }catch{/* A full encrypted-message fallback handles missing/old preview packets. */}
  }
  const value=await decrypt(message.signer_key,message.ciphertext);
  if(value.version!==1||value.clientId!==c.client_id||value.senderId!==c.sender_id||value.rosterHash!==c.recipient_hash||typeof value.body!=='string'||value.body.length>10000||!Array.isArray(value.attachments)||value.attachments.length>5)return display;
  if(c.channel==='nest'?(value.kind!=='nest-message'||value.groupId!==c.group_id||value.signerId!==c.signer_id||value.replyTo!==c.reply_to||!!value.migrated!==c.client_id.startsWith('legacy-')||(value.editVersion||0)!==c.edit_version||(c.edit_version>0&&(value.editMessageId!==c.message_id||value.editClientId!==c.edit_client_id))):(value.kind!=='private-message'||value.conversationId!==c.conversation_id||value.selfEncrypted!==c.self_encrypted||(value.editVersion||0)!==c.edit_version||(c.edit_version>0&&(value.editMessageId!==c.message_id||value.editClientId!==c.edit_client_id))))return display;
  return {...display,body:previewText(value.body,value.attachments,value.contentType||c.content_type)||'New message'};
 }catch{return display;}finally{clearTimeout(timer);}
};
