import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createBackup,verifyBackup,sha256} from './archive.js';
export function isBackupObject(key,prefix){return typeof key==='string'&&key.startsWith(prefix)&&/^\d{8}T\d{9}Z-[a-f0-9-]{36}\.churpbackup$/.test(key.slice(prefix.length));}
export async function runBackup({dataDir,config,storage,env=process.env,signal,progress=()=>{},now=Date.now}){
 const root=await mkdtemp(join(tmpdir(),'churp-backup-run-'));await chmod(root,0o700);
 try{
  const archive=join(root,'snapshot.churpbackup'),copy=join(root,'download.churpbackup');
  const local=await createBackup({dataDir,destination:archive,key:config.key,env,signal,progress});
  progress('validating');await verifyBackup({file:archive,key:config.key,signal});
  const object=config.prefix+new Date(now()).toISOString().replace(/[-:.]/g,'')+'-'+randomUUID()+'.churpbackup';
  progress('uploading');await storage.upload(object,archive,local.sha256,signal);const head=await storage.head(object,signal);if(head.bytes!==local.bytes||head.sha256!==local.sha256)throw new Error('The uploaded object did not match the backup.');
  progress('verifying_download');await storage.download(object,copy,signal);if(await sha256(copy)!==local.sha256)throw new Error('The downloaded backup failed its checksum.');await verifyBackup({file:copy,key:config.key,signal});
  const verifiedAt=now();await storage.markVerified(object,{format:'churp-backup-verification',version:1,sha256:local.sha256,bytes:local.bytes,verified_at:verifiedAt},signal);let retentionWarning=false;progress('retention');
  try{
   const listed=await storage.list(signal),receipts=new Set(listed.map(o=>o.key)),objects=listed.filter(o=>isBackupObject(o.key,config.prefix)).sort((a,b)=>b.key.localeCompare(a.key)),verified=objects.filter(o=>receipts.has(o.key+'.verified.json')),keep=new Set([object,...verified.slice(0,7).map(o=>o.key)]),cutoff=verifiedAt-config.retentionDays*86400000;
   if(verified.length>=7)for(const o of objects)if(!keep.has(o.key)&&o.modified>0&&o.modified<cutoff){await storage.remove(o.key,signal);if(receipts.has(o.key+'.verified.json'))await storage.remove(o.key+'.verified.json',signal);}
  }catch{signal?.throwIfAborted();retentionWarning=true;}
  return {object,created_at:local.created_at,verified_at:verifiedAt,bytes:local.bytes,sha256:local.sha256,files:local.files,retention_warning:retentionWarning};
 }finally{await rm(root,{recursive:true,force:true});}
}
