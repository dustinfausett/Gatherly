import * as enc from '../shared/encryption.js';
import {loadKey,contactIdentity,trustIdentity} from './encryption/store.js';
import {previewText} from '../shared/notification-previews.js';
// Runs only in the service worker: keys stay in this browser's wrapped IndexedDB storage.
self.churpPushPreview=async payload=>{
 const generic={title:payload.title||'Churp',body:payload.body||'You have a new message.'};
 if(!payload.recipient_id||!payload.preview)return generic;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
 try{
  const local=payload.preview.ciphertext?await loadKey(`account:${payload.recipient_id}`):null;
  const query=new URLSearchParams({channel:payload.source?.channel||'',message_id:String(payload.source?.messageId||''),client_id:payload.preview.client_id||'',sender_id:payload.preview.sender_id||''});
  const response=await fetch(`/api/push/privacy?${query}`,{credentials:'include',cache:'no-store',signal:controller.signal,headers:local?{'x-churp-device':local.deviceId}:{}});
  if(!response.ok)return generic;const policy=await response.json();
  if(policy.user_id!==payload.recipient_id||!policy.show_previews||!policy.can_preview)return generic;
  const packet=payload.preview;let text;
  if(packet.ciphertext){
   if(!local||!policy.device_approved)return generic;
   const key=await enc.readPublic(packet.signer_key),fingerprint=key.getFingerprint();if(fingerprint!==packet.signer_fingerprint)return generic;
   const pinned=await contactIdentity(payload.recipient_id,packet.sender_id);
   if(pinned&&pinned.fingerprint!==fingerprint&&!pinned.historical?.includes(fingerprint))return generic;
   let value;for(const privateKey of [local.privateKey,...await Promise.all(local.previousKeys.map(enc.readPrivate))]){try{value=await enc.open(privateKey,packet.signer_key,packet.ciphertext);break;}catch{}}
   if(!value||value.version!==1||value.kind!=='notification-preview'||value.recipientId!==payload.recipient_id||value.senderId!==packet.sender_id||value.clientId!==packet.client_id||value.channel!==packet.channel||typeof value.text!=='string'||Array.from(value.text).length>121)return generic;
   if(!pinned)await trustIdentity(payload.recipient_id,packet.sender_id,fingerprint);text=value.text;
  }else if(packet.channel==='sms')text=previewText(packet.text);
  else return generic;
  return {title:previewText(packet.sender_name)+(packet.context_name?` · ${previewText(packet.context_name)}`:''),body:text||'New message'};
 }catch{return generic;}finally{clearTimeout(timer);}
};
