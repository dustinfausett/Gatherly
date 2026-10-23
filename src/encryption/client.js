import { api,post } from '../api';
import * as enc from '../../shared/encryption.js';
import { saveKey,loadKey,removeKey,confirmRecovery,trustIdentity,verifyContact } from './store';
import { setEncryptionDevice } from '../api';
let current=null;
const localName=id=>`account:${id}`;
const pendingName=id=>`transfer:${id}`;
export const getCurrent=()=>{if(!current)throw new Error('Unlock encrypted messaging first.');return current;};
export const formatCode=code=>code.toUpperCase().match(/.{1,8}/g).join('-');
const compact=code=>code.replace(/[\s-]/g,'').toLowerCase();
export function browserName(){return /Android/.test(navigator.userAgent) ? 'Android browser' : /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone / iPad browser' : 'Computer browser';}
export async function activate(userId,local,account){
  if(local.privateKey.getFingerprint()!==account.identity.fingerprint)throw new Error('This account’s encryption identity changed. Do not share messages until the identity is verified.');
  if(!account.devices.some(d=>d.id===local.deviceId))await registerDevice(userId,local);
  current={...local,userId,publicKey:account.identity.public_key,fingerprint:account.identity.fingerprint};setEncryptionDevice(local.deviceId);
}
export async function inspect(userId){
  const [account,local,pending]=await Promise.all([api('/e2ee/account'),loadKey(localName(userId)),loadKey(pendingName(userId))]);
  if(account.identity && local)await activate(userId,local,account);
  return {account,local,pending};
}
async function registerDevice(userId,local){
  const payload={userId,deviceId:local.deviceId,deviceName:local.deviceName};
  await post('/e2ee/devices',{...payload,signature:await enc.sign(local.privateKey,'device',payload)});
}
export async function setup(userId,deviceName){
  const account=await api('/e2ee/account');let local=await loadKey(localName(userId));
  if(!local){if(account.identity)throw new Error('Use your recovery key or another approved device.');const generated=await enc.generateIdentity(userId);local={privateKey:generated.privateKey,deviceId:crypto.randomUUID(),deviceName,recoveryConfirmed:false};}
  const secret=enc.randomSecret(),backup=await enc.protectPrivate(local.privateKey,secret),publicKey=local.privateKey.toPublic().armor();
  await saveKey(localName(userId),local.privateKey,{deviceId:local.deviceId,deviceName:local.deviceName,recoveryConfirmed:false});
  if(!account.identity){
    const payload=enc.enrollmentPayload({userId,publicKey,backupHash:await enc.digest(backup),deviceId:local.deviceId,deviceName:local.deviceName});
    await post('/e2ee/identity',{publicKey,backup,deviceId:local.deviceId,deviceName:local.deviceName,signature:await enc.sign(local.privateKey,'enroll',payload)});
  }else{
    await activate(userId,local,account);
    const payload={userId,backupHash:await enc.digest(backup)};
    await api('/e2ee/backup',{method:'PUT',body:{backup,signature:await enc.sign(local.privateKey,'backup',payload)}});
  }
  await activate(userId,local,await api('/e2ee/account'));
  return `CHURP1-${formatCode(secret)}`;
}
export async function finishSetup(userId){await confirmRecovery(localName(userId));current.recoveryConfirmed=true;}
function recoverySecret(code){const value=compact(code.trim().replace(/^CHURP1-/i,''));if(!/^[0-9a-f]{64}$/.test(value))throw new Error('Enter the full CHURP1 recovery key.');return value;}
export async function recover(userId,code,deviceName){
  const account=await api('/e2ee/account');if(!account.identity)throw new Error('No encryption identity exists yet.');
  let privateKey;try{privateKey=await enc.recoverPrivate(account.identity.backup,recoverySecret(code));}catch{throw new Error('That recovery key could not unlock this account. Check the account and key.');}
  const local={privateKey,deviceId:crypto.randomUUID(),deviceName,recoveryConfirmed:true};
  if(privateKey.getFingerprint()!==account.identity.fingerprint)throw new Error('The recovered identity does not match this account.');
  await saveKey(localName(userId),privateKey,{deviceId:local.deviceId,deviceName,recoveryConfirmed:true});await activate(userId,local,account);
}
export async function forget(userId){await removeKey(localName(userId));await removeKey(pendingName(userId));clearMemory();}
async function pairingCode(userId,request,rootFingerprint){const key=await enc.readPublic(request.public_key);return (await enc.digest(enc.canonical([userId,key.getFingerprint(),rootFingerprint,request.nonce]))).slice(0,24);}
export async function startTransfer(userId,deviceName){
  const generated=await enc.generateIdentity(userId),deviceId=crypto.randomUUID(),nonce=enc.randomSecret();
  const result=await post('/e2ee/transfers',{deviceId,deviceName,nonce,publicKey:generated.publicKey});
  const pending={deviceId,deviceName,nonce,transferId:result.id,privateKey:generated.privateKey};
  await saveKey(pendingName(userId),generated.privateKey,{deviceId,deviceName,nonce,transferId:result.id});return pending;
}
export async function transferCode(userId,pending,account){return formatCode(await pairingCode(userId,{public_key:pending.privateKey.toPublic().armor(),nonce:pending.nonce},account.identity.fingerprint));}
export async function approveTransfer(code){
  const self=getCurrent(),result=await api('/e2ee/transfers');let request;
  for(const t of result.transfers)if(await pairingCode(self.userId,t,self.fingerprint)===compact(code)){request=t;break;}
  if(!request)throw new Error('No pending device matches that code. Compare the code on the new device and try again.');
  const finishSecret=enc.randomSecret(16);
  const payload={version:enc.VERSION,kind:'device-transfer',userId:self.userId,transferId:request.id,nonce:request.nonce,
    identityFingerprint:self.fingerprint,privateKey:self.privateKey.armor(),finishSecret};
  const ciphertext=await enc.seal(self.privateKey,[request.public_key],payload);
  await post(`/e2ee/transfers/${request.id}/approve`,{ciphertext,signature:await enc.sign(self.privateKey,'approve-transfer',{userId:self.userId,transferId:request.id,cipherHash:await enc.digest(ciphertext)})});
  return {code:formatCode(finishSecret),name:request.device_name};
}
export async function pollTransfer(pending){return api(`/e2ee/transfers/${pending.transferId}`);}
export async function finishTransfer(userId,pending,ciphertext,finishCode){
  const account=await api('/e2ee/account');let payload;
  try{payload=await enc.open(pending.privateKey,account.identity.public_key,ciphertext);}catch{throw new Error('The device approval could not be verified. Start again.');}
  if(payload.version!==enc.VERSION || payload.kind!=='device-transfer' || payload.userId!==userId || payload.transferId!==pending.transferId || payload.nonce!==pending.nonce || payload.identityFingerprint!==account.identity.fingerprint || payload.finishSecret!==compact(finishCode))throw new Error('The finish code or device approval does not match.');
  const privateKey=await enc.readPrivate(payload.privateKey);
  const local={privateKey,deviceId:pending.deviceId,deviceName:pending.deviceName,recoveryConfirmed:true};
  if(privateKey.getFingerprint()!==account.identity.fingerprint)throw new Error('The approved identity does not match.');
  await saveKey(localName(userId),privateKey,{deviceId:local.deviceId,deviceName:local.deviceName,recoveryConfirmed:true});
  await activate(userId,local,account);await api(`/e2ee/transfers/${pending.transferId}`,{method:'DELETE'});await removeKey(pendingName(userId));
}
export async function trustedReader(reader){
  const self=getCurrent(),key=await enc.readPublic(reader.public_key);
  if(key.getUserIDs().length!==1 || key.getUserIDs()[0]!==`Churp account ${reader.id}` || key.getFingerprint()!==reader.fingerprint)throw new Error('An encryption identity does not match its account.');
  if(reader.id===self.userId){if(key.getFingerprint()!==self.fingerprint)throw new Error('Your encryption identity changed.');return {...reader,verified:true};}
  const pinned=await trustIdentity(self.userId,reader.id,key.getFingerprint());return {...reader,verified:pinned.verified};
}
export async function getRoster(groupId){const rs=await api(`/groups/${groupId}/e2ee/roster`);if(rs.missing.length)throw new Error(`Waiting for ${rs.missing.map(m=>m.name).join(', ')} to set up encrypted messaging.`);return {...rs,readers:await Promise.all(rs.readers.map(trustedReader))};}
export async function confirmContact(reader){await verifyContact(getCurrent().userId,reader.id,reader.fingerprint);}
function validateContents(value){
  if(typeof value.body!=='string' || value.body.length>10000 || !Array.isArray(value.attachments) || value.attachments.length>5 || (!value.body.trim() && !value.attachments.length))throw new Error('Invalid message contents.');
  for(const f of value.attachments)if(typeof f.id!=='string' || typeof f.name!=='string' || f.name.length>200 || !Number.isSafeInteger(f.size) || f.size<0 || f.size>enc.FILE_LIMIT || !/^[0-9a-f]{64}$/.test(f.key) || !/^[0-9a-f]{64}$/.test(f.sha256) || typeof f.mime!=='string' || f.mime.length>100)throw new Error('Invalid encrypted attachment.');
}
export async function sealMessage(groupId,body,attachments,replyTo,legacy=null){
  const self=getCurrent(),rs=legacy ? {...legacy.roster,readers:await Promise.all(legacy.roster.readers.map(trustedReader))} : await getRoster(groupId);
  if(rs.missing?.length)throw new Error(`Waiting for ${rs.missing.map(u=>u.name).join(', ')} to set up encrypted messaging.`);
  const clientId=legacy ? `legacy-${legacy.id}` : crypto.randomUUID();
  const payload={version:enc.VERSION,kind:'nest-message',groupId,clientId,senderId:legacy?.user_id ?? self.userId,signerId:self.userId,
    rosterHash:rs.roster_hash,replyTo:replyTo ?? null,migrated:!!legacy,body,attachments};
  validateContents(payload);
  const ciphertext=await enc.seal(self.privateKey,rs.readers.map(u=>u.public_key),payload),files=attachments.map(f=>f.id);
  const signed=enc.sendPayload({groupId,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files,replyTo});
  return {ciphertext,clientId,rosterHash:rs.roster_hash,files,reply_to:replyTo ?? null,signature:await enc.sign(self.privateKey,legacy ? 'migrate' : 'send',legacy ? {...signed,legacyId:legacy.id} : signed)};
}
const decryptedCache=new Map();
export async function decryptMessages(groupId,messages){
  const self=getCurrent();return Promise.all(messages.map(async m=>{
    if(m.deleted)return {...m,body:'',files:[]};
    try{
      if(m.e2ee_version!==enc.VERSION || !m.ciphertext || m.body)throw new Error('Encrypted contents are required.');
      const signer=await trustedReader({id:m.encrypted_by,public_key:m.signer_key,fingerprint:m.signer_fingerprint});
      const cacheKey=`${self.userId}:${groupId}:${m.id}:${m.ciphertext}:${signer.fingerprint}`;
      let value=decryptedCache.get(cacheKey);
      if(!value){value=await enc.open(self.privateKey,signer.public_key,m.ciphertext);decryptedCache.set(cacheKey,value);if(decryptedCache.size>500)decryptedCache.delete(decryptedCache.keys().next().value);}
      if(value.version!==enc.VERSION || value.kind!=='nest-message' || value.groupId!==groupId || value.clientId!==m.client_id || value.senderId!==m.user_id || value.signerId!==m.encrypted_by || value.rosterHash!==m.recipient_hash || value.replyTo!==(m.reply_to ?? null) || !!value.migrated!==m.client_id.startsWith('legacy-'))throw new Error('The message context does not match.');
      validateContents(value);
      if(enc.canonical(value.attachments.map(f=>f.id).sort())!==enc.canonical(m.files.map(f=>f.id).sort()))throw new Error('The attachment list was changed.');
      return {...m,body:value.body,files:value.attachments,identityVerified:signer.verified,migrated:value.migrated};
    }catch{return {...m,body:'This message could not be decrypted or verified.',files:[],decryptionError:true};}
  }));
}
function safeImageMime(data){if(data[0]===137 && data[1]===80 && data[2]===78 && data[3]===71)return 'image/png';if(data[0]===255 && data[1]===216 && data[2]===255)return 'image/jpeg';const t=new TextDecoder().decode(data.subarray(0,12));if(t.startsWith('GIF87a')||t.startsWith('GIF89a'))return 'image/gif';if(t.startsWith('RIFF')&&t.slice(8)==='WEBP')return 'image/webp';return 'application/octet-stream';}
export async function uploadEncrypted(file){
  const original=new Uint8Array(await file.arrayBuffer()),result=await enc.encryptFile(original),form=new FormData();
  form.append('file',new Blob([result.encrypted],{type:'application/octet-stream'}),'attachment.pgp');
  const {id}=(await post('/e2ee/uploads',form)).file;
  return {id,name:file.name.slice(0,200),size:original.length,mime:safeImageMime(original),key:result.key,sha256:result.sha256};
}
export async function attachmentUrl(file){
  const response=await fetch(`/api/files/${file.id}`,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('The attachment is no longer available.');
  const data=await enc.decryptFile(new Uint8Array(await response.arrayBuffer()),file),mime=safeImageMime(data);
  return URL.createObjectURL(new Blob([data],{type:mime}));
}
async function legacyProof(kind,id){const self=getCurrent(),payload={kind,id,deviceId:self.deviceId,time:Date.now(),nonce:enc.randomSecret(16)};return {'x-churp-encryption-proof':JSON.stringify({time:payload.time,nonce:payload.nonce,signature:await enc.sign(self.privateKey,'legacy-read',payload)})};}
const migrations=new Map();
export function convertHistory(groupId){
  const userId=getCurrent().userId,key=`${userId}:${groupId}`;if(migrations.has(key))return migrations.get(key);
  const work=(async()=>{
    let converted=0;
    for(let batch=0;batch<100;batch++){
      if(getCurrent().userId!==userId)throw new Error('Account changed while converting history.');
      const data=await api(`/groups/${groupId}/e2ee/legacy`,{headers:await legacyProof('group',groupId)});
      if(!data.messages.length)return {converted,pending:data.cleanup_pending ? 1 : 0};
      let pending=0;
      for(const m of data.messages){
        if(m.roster.missing.length){pending+=m.roster.missing.length;continue;}
        const files=[];
        for(const f of m.files){
          const response=await fetch(`/api/e2ee/legacy-files/${f.id}`,{credentials:'same-origin',cache:'no-store',headers:{'x-churp-device':getCurrent().deviceId,...await legacyProof('file',f.id)}});
          if(!response.ok)throw new Error('An earlier attachment could not be converted.');
          files.push(await uploadEncrypted(new File([await response.arrayBuffer()],f.name,{type:f.mime})));
        }
        const body=await sealMessage(groupId,m.body,files,m.reply_to,m);
        try{await api(`/e2ee/legacy/${m.id}`,{method:'PUT',body});converted++;}catch(e){if(e.status!==409)throw e;return {converted,pending:1};}
      }
      if(pending)return {converted,pending};
    }
    return {converted,pending:1};
  })().finally(()=>migrations.delete(key));migrations.set(key,work);return work;
}
export function clearMemory(){current=null;decryptedCache.clear();setEncryptionDevice(null);}
export async function stageRecovery(){const self=getCurrent(),secret=enc.randomSecret(),backup=await enc.protectPrivate(self.privateKey,secret);return {code:`CHURP1-${formatCode(secret)}`,backup,signature:await enc.sign(self.privateKey,'backup',{userId:self.userId,backupHash:await enc.digest(backup)})};}
export async function replaceRecovery(candidate){await api('/e2ee/backup',{method:'PUT',body:{backup:candidate.backup,signature:candidate.signature}});}
