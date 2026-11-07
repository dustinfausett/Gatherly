import {DatabaseSync,backup} from 'node:sqlite';
import {createReadStream,createWriteStream,constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import {createHash,createCipheriv,createDecipheriv,createECDH,randomBytes,randomUUID} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {keyVault} from '../key-vault.js';

const MAGIC=Buffer.from('CHURPBK1'),HEADER_SIZE=20,MAX_MANIFEST=32*1024*1024;
const safeUpload=name=>typeof name==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)&&!name.includes('..');
const validPath=path=>['gatherly.sqlite','key-vault.key','push-keys.json'].includes(path)||path.startsWith('uploads/')&&safeUpload(path.slice(8));
export function encryptionKey(value){if(typeof value!=='string'||! /^[a-f0-9]{64}$/i.test(value))throw new Error('Supply a separate 64-character hexadecimal CHURP_BACKUP_ENCRYPTION_KEY.');return Buffer.from(value,'hex');}
export async function sha256(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function regularFile(path){const stat=await fs.lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Backup inputs must be regular files.');return stat;}
async function copyRegular(source,destination,signal){
 await regularFile(source);const handle=await fs.open(source,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{if(!(await handle.stat()).isFile())throw new Error('Invalid backup input.');await pipeline(handle.createReadStream({autoClose:false}),createWriteStream(destination,{flags:'wx',mode:0o600}),{signal});}finally{await handle.close();}
}
function openDb(file){return new DatabaseSync(file,{readOnly:true});}
function tables(db){return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));}
function checkDatabase(db){
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('The snapshot failed SQLite integrity checks.');
 const known=tables(db);for(const name of ['users','files','messages','e2ee_identities'])if(!known.has(name))throw new Error('This is not a complete Churp database.');return known;
}
export async function createBackup({dataDir,destination,key,env=process.env,signal,progress=()=>{}}){
 const secret=encryptionKey(key),root=await fs.mkdtemp(join(tmpdir(),'churp-backup-snapshot-'));await fs.chmod(root,0o700);
 let source,snapshot;
 try{
  progress('snapshot');await regularFile(join(dataDir,'gatherly.sqlite'));source=openDb(join(dataDir,'gatherly.sqlite'));await backup(source,join(root,'gatherly.sqlite'));source.close();source=null;
  snapshot=openDb(join(root,'gatherly.sqlite'));checkDatabase(snapshot);signal?.throwIfAborted();
  const master=env.CHURP_KEY_VAULT_SECRET||await fs.readFile(join(dataDir,'key-vault.key'),'utf8');
  if(!/^[a-f0-9]{64}$/i.test(master.trim()))throw new Error('The original vault key is required.');
  if(master.trim().toLowerCase()===secret.toString('hex'))throw new Error('Use a separate encryption key for backups, not the Churp vault key.');
  await fs.writeFile(join(root,'key-vault.key'),master.trim(),{mode:0o600,flag:'wx'});
  const paths=['gatherly.sqlite','key-vault.key'];
  if(env.VAPID_PUBLIC_KEY||env.VAPID_PRIVATE_KEY){if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY)throw new Error('Both current push keys must be supplied.');await fs.writeFile(join(root,'push-keys.json'),JSON.stringify({publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY}),{mode:0o600,flag:'wx'});paths.push('push-keys.json');}
  else{try{await copyRegular(join(dataDir,'push-keys.json'),join(root,'push-keys.json'),signal);paths.push('push-keys.json');}catch(error){if(error.code!=='ENOENT')throw error;}}
  progress('uploads');await fs.mkdir(join(root,'uploads'),{mode:0o700});
  const uploads=snapshot.prepare('SELECT disk_name,size FROM files ORDER BY disk_name').all(),seen=new Set();
  for(const file of uploads){signal?.throwIfAborted();if(!safeUpload(file.disk_name)||seen.has(file.disk_name))throw new Error('The upload index contains an invalid or duplicate filename.');seen.add(file.disk_name);const path=`uploads/${file.disk_name}`;await copyRegular(join(dataDir,path),join(root,path),signal);if((await fs.stat(join(root,path))).size!==file.size)throw new Error('An indexed upload is incomplete. Retry after checking storage.');paths.push(path);}
  snapshot.close();snapshot=null;
  const entries=[];for(const path of paths){signal?.throwIfAborted();entries.push({path,size:(await fs.stat(join(root,path))).size,sha256:await sha256(join(root,path))});}
  const manifest={format:'churp-backup',version:1,id:randomUUID(),created_at:new Date().toISOString(),entries},json=Buffer.from(JSON.stringify(manifest));if(json.length>MAX_MANIFEST)throw new Error('The backup manifest exceeds the supported limit.');
  const length=Buffer.alloc(4);length.writeUInt32BE(json.length);const iv=randomBytes(12),header=Buffer.concat([MAGIC,iv]),cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(header);
  async function* contents(){yield length;yield json;for(const entry of entries){for await(const chunk of createReadStream(join(root,entry.path))){signal?.throwIfAborted();yield chunk;}}}
  progress('encrypting');const outputFile=await fs.open(destination,'wx',0o600),output=outputFile.createWriteStream();output.write(header);
  try{await pipeline(Readable.from(contents()),createGzip(),cipher,output,{signal});await fs.appendFile(destination,cipher.getAuthTag());}catch(error){await outputFile.close().catch(()=>{});await fs.rm(destination,{force:true});throw error;}
  return {id:manifest.id,created_at:manifest.created_at,bytes:(await fs.stat(destination)).size,sha256:await sha256(destination),files:uploads.length};
 }finally{source?.close();snapshot?.close();await fs.rm(root,{recursive:true,force:true});}
}

async function extract(compressed,root,{signal,maxBytes}){
 const input=createReadStream(compressed),stream=input.pipe(createGunzip()),iterator=stream[Symbol.asyncIterator]();let buffered=Buffer.alloc(0),total=0;
 async function take(n,consume){while(n){signal?.throwIfAborted();if(!buffered.length){const r=await iterator.next();if(r.done)throw new Error('The backup is truncated.');buffered=r.value;}const part=buffered.subarray(0,Math.min(n,buffered.length));buffered=buffered.subarray(part.length);n-=part.length;total+=part.length;if(total>maxBytes+MAX_MANIFEST+4)throw new Error('Backup exceeds the restore size limit.');await consume(part);}}
 async function bytes(n){const chunks=[];await take(n,c=>chunks.push(c));return Buffer.concat(chunks);}
 try{
  const length=(await bytes(4)).readUInt32BE();if(length<2||length>MAX_MANIFEST)throw new Error('Invalid backup manifest size.');const manifest=JSON.parse((await bytes(length)).toString());
  if(manifest.format!=='churp-backup'||manifest.version!==1||!Array.isArray(manifest.entries)||manifest.entries.length>200000||!Number.isFinite(Date.parse(manifest.created_at)))throw new Error('Invalid backup manifest.');
  const seen=new Set();let expected=0;
  for(const e of manifest.entries){if(typeof e.path!=='string'||!validPath(e.path)||seen.has(e.path)||!Number.isSafeInteger(e.size)||e.size<0||! /^[a-f0-9]{64}$/.test(e.sha256))throw new Error('Unsafe backup entry.');seen.add(e.path);expected+=e.size;if(expected>maxBytes)throw new Error('Backup exceeds the restore size limit.');}
  for(const required of ['gatherly.sqlite','key-vault.key'])if(!seen.has(required))throw new Error('Required recovery data is missing.');await fs.mkdir(join(root,'uploads'),{mode:0o700});
  for(const e of manifest.entries){const hash=createHash('sha256'),file=await fs.open(join(root,e.path),'wx',0o600);try{await take(e.size,async chunk=>{hash.update(chunk);let offset=0;while(offset<chunk.length){const written=await file.write(chunk,offset,chunk.length-offset);offset+=written.bytesWritten;}});}finally{await file.close();}if(hash.digest('hex')!==e.sha256)throw new Error('A backup entry failed its checksum.');}
  if(buffered.length||!(await iterator.next()).done)throw new Error('Unexpected data after the backup entries.');return manifest;
 }finally{stream.destroy();input.destroy();}
}
export async function validateRestoredData(root,manifest){
 const db=openDb(join(root,'gatherly.sqlite'));
 try{
  const known=checkDatabase(db),expected=new Map(manifest.entries.filter(e=>e.path.startsWith('uploads/')).map(e=>[e.path.slice(8),e]));
  for(const f of db.prepare('SELECT disk_name,size FROM files').all()){const entry=expected.get(f.disk_name);if(!entry||entry.size!==f.size)throw new Error('Database and upload snapshot do not match.');expected.delete(f.disk_name);}if(expected.size)throw new Error('The backup contains unindexed uploads.');
  const master=(await fs.readFile(join(root,'key-vault.key'),'utf8')).trim();if(!/^[a-f0-9]{64}$/i.test(master))throw new Error('Invalid restored vault key.');const vault=keyVault(root,true,master);
  if(known.has('e2ee_managed_keys'))for(const row of db.prepare('SELECT * FROM e2ee_managed_keys').all())vault.open(row.user_id,row.fingerprint,row.encrypted_key);
  for(const [table,owner,column] of [['scheduled_sends','scheduled','packet_cipher'],['phone_drafts','phone-draft','payload_cipher'],['safety_reports','safety-report','contents']])if(known.has(table))for(const row of db.prepare(`SELECT id,${column} AS value FROM ${table}`).all())vault.open(owner,row.id,row.value);
  if(manifest.entries.some(e=>e.path==='push-keys.json')){const keys=JSON.parse(await fs.readFile(join(root,'push-keys.json'),'utf8')),curve=createECDH('prime256v1');if(typeof keys.privateKey!=='string'||typeof keys.publicKey!=='string')throw new Error('Invalid push recovery keys.');curve.setPrivateKey(Buffer.from(keys.privateKey,'base64url'));if(curve.getPublicKey().toString('base64url')!==keys.publicKey)throw new Error('The push recovery key pair does not match.');}
  if(known.has('report_identity')){const row=db.prepare('SELECT * FROM report_identity LIMIT 1').get();if(row)vault.open('safety-reports',row.fingerprint,row.encrypted_private);}
  return {files:manifest.entries.filter(e=>e.path.startsWith('uploads/')).length,users:db.prepare('SELECT COUNT(*) n FROM users').get().n};
 }finally{db.close();}
}
export async function verifyBackup({file,key,workDir=tmpdir(),signal,maxBytes=100*1024**3,keep=false}){
 const secret=encryptionKey(key),root=await fs.mkdtemp(join(workDir,'churp-backup-verify-'));await fs.chmod(root,0o700);const compressed=join(root,'payload.gz'),data=join(root,'data');
 try{
  const stat=await regularFile(file);if(stat.size<HEADER_SIZE+17)throw new Error('Invalid encrypted backup.');const handle=await fs.open(file,'r'),header=Buffer.alloc(HEADER_SIZE),tag=Buffer.alloc(16);try{await handle.read(header,0,HEADER_SIZE,0);await handle.read(tag,0,16,stat.size-16);}finally{await handle.close();}
  if(!header.subarray(0,8).equals(MAGIC))throw new Error('Unsupported backup format.');const decipher=createDecipheriv('aes-256-gcm',secret,header.subarray(8));decipher.setAAD(header);decipher.setAuthTag(tag);
  // Authenticate the entire encrypted archive before trusting any manifest paths.
  await pipeline(createReadStream(file,{start:HEADER_SIZE,end:stat.size-17}),decipher,createWriteStream(compressed,{flags:'wx',mode:0o600}),{signal});
  await fs.mkdir(data,{mode:0o700});const manifest=await extract(compressed,data,{signal,maxBytes}),checked=await validateRestoredData(data,manifest);await fs.rm(compressed);
  if(keep)return {root,data,manifest,...checked};return {manifest,...checked};
 }catch(error){await fs.rm(root,{recursive:true,force:true});throw error;}finally{if(!keep)await fs.rm(root,{recursive:true,force:true});}
}
export async function restoreBackup({file,key,target,...options}){
 const destination=resolve(target);try{await fs.lstat(destination);throw new Error('Restore only into a new, nonexistent directory; the live data folder is never overwritten.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.mkdir(dirname(destination),{recursive:true});const verified=await verifyBackup({file,key,workDir:dirname(destination),...options,keep:true});
 try{
  await fs.writeFile(join(verified.data,'restore-review-required.json'),JSON.stringify({backup_id:verified.manifest.id,backup_created_at:verified.manifest.created_at,restored_at:new Date().toISOString()},null,2),{mode:0o600,flag:'wx'});
  const db=new DatabaseSync(join(verified.data,'gatherly.sqlite'));
  try{db.exec('PRAGMA foreign_keys=ON; BEGIN; DELETE FROM sessions; DELETE FROM push_subscriptions; DELETE FROM pending_push_alerts; DELETE FROM push_alert_windows;');const known=tables(db);if(known.has('scheduled_parts'))db.exec("UPDATE scheduled_parts SET state='held',error='Restored from backup: review before resuming.' WHERE state IN ('pending','sending'); UPDATE scheduled_sends SET next_at=0 WHERE next_at>0;");if(known.has('phone_draft_series'))db.exec('UPDATE phone_draft_series SET active=0;');if(known.has('sms_messages'))db.exec("UPDATE sms_messages SET state='canceled' WHERE state IN ('queued','dispatching') AND direction='outbound';");if(known.has('account_tokens'))db.exec('DELETE FROM account_tokens;');if(known.has('google_auth_challenges'))db.exec('DELETE FROM google_auth_challenges;');if(known.has('e2ee_transfers'))db.exec('DELETE FROM e2ee_transfers;');db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE);');}finally{db.close();}
  await fs.rename(verified.data,destination);return {target:destination,backup_id:verified.manifest.id,files:verified.files,users:verified.users};
 }finally{await fs.rm(verified.root,{recursive:true,force:true});}
}
