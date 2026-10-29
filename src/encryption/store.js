import { readPrivate } from '../../shared/encryption.js';
let database;
function db(){return database ||= new Promise((resolve,reject)=>{
  const r=indexedDB.open('churp-encryption',1);
  r.onupgradeneeded=()=>{r.result.createObjectStore('keys');r.result.createObjectStore('contacts');};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('This browser could not open encrypted messaging storage.'));
});}
async function request(store,mode,fn){const d=await db();return new Promise((resolve,reject)=>{
  const t=d.transaction(store,mode),r=fn(t.objectStore(store));let value;
  r.onsuccess=()=>{value=r.result;};t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error || r.error);t.onabort=()=>reject(t.error || new Error('Encrypted storage was not saved.'));
});}
export async function saveKey(name,privateKey,metadata){
  const {previousKeys=[],...publicMetadata}=metadata;
  const wrappingKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(name)},wrappingKey,new TextEncoder().encode(JSON.stringify({privateKey:privateKey.armor(),previousKeys})));
  await request('keys','readwrite',s=>s.put({...publicMetadata,wrappingKey,iv,ciphertext},name));
}
export async function loadKey(name){
  const r=await request('keys','readonly',s=>s.get(name));if(!r)return null;
  const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:r.iv,additionalData:new TextEncoder().encode(name)},r.wrappingKey,r.ciphertext);
  const text=new TextDecoder().decode(data),payload=text.startsWith('{') ? JSON.parse(text) : {privateKey:text,previousKeys:[]};
  return {...r,privateKey:await readPrivate(payload.privateKey),previousKeys:payload.previousKeys || []};
}
export async function loadDeviceInfo(name){
  const r=await request('keys','readonly',s=>s.get(name));return r?{deviceId:r.deviceId,deviceName:r.deviceName}:null;
}
export async function removeKey(name){await request('keys','readwrite',s=>s.delete(name));}
export async function confirmRecovery(name){const r=await loadKey(name);await saveKey(name,r.privateKey,{deviceId:r.deviceId,deviceName:r.deviceName,recoveryConfirmed:true,previousKeys:r.previousKeys});}
export const contactIdentity=(selfId,userId)=>request('contacts','readonly',s=>s.get(`${selfId}:${userId}`));
export async function trustIdentity(selfId,userId,fingerprint,transition=null){
  const d=await db(),key=`${selfId}:${userId}`;
  return new Promise((resolve,reject)=>{
    const t=d.transaction('contacts','readwrite'),s=t.objectStore('contacts'),r=s.get(key);let value,changed=false;
    r.onsuccess=()=>{value=r.result;
      if(value && value.fingerprint!==fingerprint && !value.historical?.includes(fingerprint)){
        if(transition?.fromFingerprint===value.fingerprint){
          if(transition.historical)value={...value,historical:[...new Set([...(value.historical || []),fingerprint])]};
          else value={userId,fingerprint,verified:false,historical:[...new Set([...(value.historical || []),value.fingerprint])]};
          s.put(value,key);
        }else{changed=true;t.abort();}
      }else if(!value){value={userId,fingerprint,verified:false};s.put(value,key);}};
    t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error);t.onabort=()=>reject(new Error(changed ? 'An encryption identity changed. Stop and compare security codes with that person.' : 'The encryption identity could not be saved.'));
  });
}
export async function verifyContact(selfId,userId,fingerprint){
  await trustIdentity(selfId,userId,fingerprint);
  const previous=await contactIdentity(selfId,userId);
  await request('contacts','readwrite',s=>s.put({...previous,userId,fingerprint,verified:true},`${selfId}:${userId}`));
}
