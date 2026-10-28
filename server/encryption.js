import {validateNotificationPreviews} from './notification-previews.js';
import {previewProof} from '../shared/notification-previews.js';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { canonical, digest, enrollmentPayload, sendPayload, editPayload, readPublic, readPrivate, generateIdentity, validateBackup, validateCiphertext, validateEncryptedFile, verify, FILE_LIMIT } from '../shared/encryption.js';
import { keyVault } from './key-vault.js';

export function installEncryption({app,db,uploadDir,enabled,transaction,refresh,refreshUser,group,membership,visibleCircle,testing}) {
  const one=(sql,...args)=>db.prepare(sql).get(...args), all=(sql,...args)=>db.prepare(sql).all(...args), run=(sql,...args)=>db.prepare(sql).run(...args);
  const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
  const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
  const identity=id=>one('SELECT * FROM e2ee_identities WHERE user_id=?',id);
  const vault=enabled ? keyVault(dirname(uploadDir),!!one('SELECT 1 FROM e2ee_managed_keys LIMIT 1')) : null;
  if(enabled){const saved=one('SELECT * FROM e2ee_managed_keys LIMIT 1');
    if(saved)try{vault.open(saved.user_id,saved.fingerprint,saved.encrypted_key);}catch{throw new Error('Cannot unlock the managed key vault. Restore the original key-vault.key or CHURP_KEY_VAULT_SECRET; do not replace the master key.');}
  }
  const provisioning=new Map();
  const history=userId=>all('SELECT * FROM e2ee_key_history WHERE user_id=?',userId).map(h=>({...h,payload:JSON.parse(h.transition_payload)}));
  const protection=gid=>{
    const rs=one(`SELECT COUNT(*) AS members,COALESCE(SUM(CASE WHEN i.custody='self' AND i.public_key IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM e2ee_managed_keys mk WHERE mk.user_id=gm.user_id) THEN 1 ELSE 0 END),0) AS self_members
      FROM group_members gm JOIN groups g ON g.id=gm.group_id JOIN community_members cm ON cm.community_id=g.community_id AND cm.user_id=gm.user_id
      LEFT JOIN e2ee_identities i ON i.user_id=gm.user_id WHERE gm.group_id=?`,gid);
    return {self_encrypted:rs.members>0 && rs.members===rs.self_members,member_count:rs.members,self_managed_count:rs.self_members};
  };
  async function ensureManaged(userId){
    if(identity(userId))return identity(userId);
    if(!enabled)fail(409,'Encrypted messaging is unavailable in this fixture.');
    if(provisioning.has(userId))return provisioning.get(userId);
    const task=(async()=>{
      const keys=await generateIdentity(userId);
      transaction(()=>{if(identity(userId))return;
        run("INSERT INTO e2ee_identities(user_id,public_key,fingerprint,backup,created_at,custody) VALUES (?,?,?,'',?,'managed')",userId,keys.publicKey,keys.fingerprint,Date.now());
        run('INSERT INTO e2ee_managed_keys VALUES (?,?,?)',userId,keys.fingerprint,vault.seal(userId,keys.fingerprint,keys.privateKey.armor()));
      });return identity(userId);
    })().finally(()=>provisioning.delete(userId));provisioning.set(userId,task);return task;
  }
  async function prepareMembers(gid,messageId=null){for(const r of members(gid,messageId).missing)await ensureManaged(r.id);}
  const device=req=>{
    const id=req.get('x-churp-device');
    if(!id || !one('SELECT 1 FROM e2ee_devices WHERE id=? AND user_id=?',id,req.user.id))fail(403,'Unlock encrypted messaging on this device first.');
    return id;
  };
  const publicAccount=userId=>{
    const record=identity(userId);
    return {identity:record ? {public_key:record.public_key,fingerprint:record.fingerprint,backup:record.backup,custody:record.custody,history_backup:record.history_backup}:null,
      devices:all('SELECT id,name,created_at FROM e2ee_devices WHERE user_id=? ORDER BY created_at',userId)};
  };
  function members(gid,messageId=null) {
    const values=all(`SELECT u.id,u.name,gm.join_token,gm.joined_after,i.public_key,i.fingerprint,i.custody
      FROM group_members gm JOIN users u ON u.id=gm.user_id JOIN groups g ON g.id=gm.group_id
      JOIN community_members cm ON cm.community_id=g.community_id AND cm.user_id=gm.user_id
      LEFT JOIN e2ee_identities i ON i.user_id=u.id
      WHERE gm.group_id=? ${messageId===null ? '' : 'AND gm.joined_after<? AND EXISTS(SELECT 1 FROM e2ee_legacy_readers lr WHERE lr.user_id=u.id AND lr.message_id=?)'} ORDER BY u.id`,gid,...(messageId===null ? [] : [messageId,messageId]));
    return describeRoster(values);
  }
  function describeRoster(values) {
    const roster_hash=createHash('sha256').update(canonical(values.map(u=>[u.id,u.join_token,u.fingerprint,u.custody]))).digest('hex');
    return {readers:values,roster_hash,self_encrypted:values.length>0 && values.every(u=>u.custody==='self' && !one('SELECT 1 FROM e2ee_managed_keys WHERE user_id=?',u.id)),missing:values.filter(u=>!u.public_key).map(({id,name})=>({id,name}))};
  }
  function reader(req,gid) {
    const g=visibleCircle(req.user.id,gid), gm=one('SELECT * FROM group_members WHERE group_id=? AND user_id=?',gid,req.user.id);
    if(!gm)fail(403,'Join this Nest to read messages sent from that point onward.');
    return {g,gm};
  }
  function roster(req,gid,messageId=null) {
    const {gm}=reader(req,gid);
    if(messageId!==null && (messageId<=gm.joined_after || !one('SELECT 1 FROM e2ee_legacy_readers WHERE message_id=? AND user_id=?',messageId,req.user.id)))fail(404,'Earlier history is not available to this membership.');
    return members(gid,messageId);
  }
  function assertRoster(req,gid,hash,messageId=null) {
    const result=roster(req,gid,messageId);
    if(result.missing.length)fail(409,`${result.missing.map(u=>u.name).join(', ')} must set up encrypted messaging before this content can be encrypted.`);
    if(!result.readers.length || result.roster_hash!==hash)fail(409,'Nest membership changed. Refresh and send again.');
    return result;
  }
  function editRoster(req,message) {
    reader(req,message.group_id);
    const values=members(message.group_id).readers.filter(u=>u.joined_after<message.id && one('SELECT 1 FROM e2ee_recipients WHERE message_id=? AND user_id=?',message.id,u.id));
    return describeRoster(values);
  }
  function assertEditRoster(req,message,hash) {
    const result=editRoster(req,message);
    if(result.missing.length || !result.readers.some(u=>u.id===req.user.id) || result.roster_hash!==hash)fail(409,'The message audience changed. Close this editor and try again.');
    return result;
  }
  async function validateEdit(req,message) {
    device(req);
    const {ciphertext,clientId,rosterHash,signature,expectedVersion}=req.body;
    if(!uuid(clientId))fail(400,'A unique encrypted edit ID is required.');
    const rs=assertEditRoster(req,message,rosterHash);
    try{await validateCiphertext(ciphertext,rs.readers.map(u=>u.public_key));}catch(e){fail(400,e.message);}
    const original=all('SELECT file_id FROM message_files WHERE message_id=? ORDER BY file_id',message.id).map(f=>f.file_id), files=req.body.files;
    if(!Array.isArray(files) || canonical([...files].sort())!==canonical(original) || (req.body.reply_to ?? null)!==message.reply_to)fail(400,'Editing text must keep the original attachments and reply.');
    const payload=editPayload({messageId:message.id,expectedVersion,groupId:message.group_id,clientId,rosterHash,cipherHash:await digest(ciphertext),files,replyTo:message.reply_to});
    await proof(req,'edit',payload,signature);
    return {rs,clientId,ciphertext,rosterHash};
  }
  async function proof(req,operation,payload,signature) {
    const i=identity(req.user.id);if(!i)fail(403,'Set up encrypted messaging first.');
    try{await verify(i.public_key,operation,payload,signature);}catch{fail(403,'The encryption identity signature could not be verified.');}
  }
  async function readProof(req,kind,id) {
    const deviceId=device(req);let p;
    try{p=JSON.parse(req.get('x-churp-encryption-proof') || '');}catch{fail(403,'An approved device must authorize history conversion.');}
    if(!Number.isSafeInteger(p.time) || Math.abs(Date.now()-p.time)>60000 || typeof p.nonce!=='string' || p.nonce.length>80)fail(403,'History authorization expired. Try again.');
    await proof(req,'legacy-read',{kind,id,deviceId,time:p.time,nonce:p.nonce},p.signature);
  }
  function cleanup() {
    for(const row of all('SELECT * FROM e2ee_plaintext_cleanup')){
      if(basename(row.disk_name)!==row.disk_name)throw new Error('Invalid legacy cleanup path.');
      try{unlinkSync(join(uploadDir,row.disk_name));run('DELETE FROM e2ee_plaintext_cleanup WHERE disk_name=?',row.disk_name);}
      catch(e){if(e.code==='ENOENT')run('DELETE FROM e2ee_plaintext_cleanup WHERE disk_name=?',row.disk_name);else console.error('Legacy attachment cleanup is pending.');}
    }
    if(!one('SELECT COUNT(*) AS n FROM e2ee_plaintext_cleanup').n && one("SELECT value FROM e2ee_meta WHERE key='vacuum_pending'")?.value==='1'){
      try{
        if(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy)throw new Error('Checkpoint is busy');
        db.exec('VACUUM');
        if(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy)throw new Error('Checkpoint is busy');
        run("INSERT OR REPLACE INTO e2ee_meta VALUES ('vacuum_pending','0')");
      }catch{console.error('Earlier history storage cleanup is pending.');}
    }
  }
  if(enabled){
    if(!one("SELECT 1 FROM e2ee_meta WHERE key='active'")) transaction(()=>{
      run('UPDATE group_members SET join_token=lower(hex(randomblob(16))) WHERE join_token IS NULL');
      run(`INSERT OR IGNORE INTO e2ee_legacy_readers SELECT m.id,gm.user_id FROM messages m JOIN group_members gm ON gm.group_id=m.group_id
        JOIN groups g ON g.id=m.group_id JOIN community_members cm ON cm.community_id=g.community_id AND cm.user_id=gm.user_id WHERE m.e2ee_version=0 AND m.deleted=0`);
      // Deleted bodies and dangling quote text must not survive in database pages.
      run("UPDATE messages SET body='' WHERE deleted=1");
      run("INSERT INTO e2ee_meta VALUES ('active','1')");
      run("INSERT OR REPLACE INTO e2ee_meta VALUES ('vacuum_pending','1')");
    });
    cleanup();
  }
  const limited=rateLimit({windowMs:15*60*1000,limit:testing ? 1000 : 30,keyGenerator:req=>req.user.id,message:{error:'Too many encryption setup attempts. Please try later.'}});
  app.get('/api/e2ee/account',(req,res)=>res.json(publicAccount(req.user.id)));
  app.get('/api/e2ee/identities/:id',(req,res)=>{
    const i=identity(req.params.id);if(!i)fail(404,'Encryption identity not found.');
    res.json({public_key:i.public_key,fingerprint:i.fingerprint,custody:i.custody,history:history(req.params.id)});
  });
  app.post('/api/e2ee/managed-device',limited,async(req,res)=>{
    const {deviceId,deviceName}=req.body;
    if(!uuid(deviceId) || typeof deviceName!=='string' || !deviceName.trim() || deviceName.length>80)fail(400,'Choose a valid device name.');
    const i=await ensureManaged(req.user.id);
    if(i.custody!=='managed')fail(409,'This account uses self-managed keys. Use your recovery key or an approved device.');
    const stored=one('SELECT * FROM e2ee_managed_keys WHERE user_id=? AND fingerprint=?',req.user.id,i.fingerprint);
    if(!stored)fail(503,'The managed key vault is unavailable. Please try again later.');
    const privateKey=vault.open(req.user.id,i.fingerprint,stored.encrypted_key);
    transaction(()=>{
      if(identity(req.user.id).fingerprint!==i.fingerprint || identity(req.user.id).custody!=='managed')fail(409,'Key settings changed. Reload this device.');
      if(one('SELECT 1 FROM e2ee_devices WHERE id=? AND user_id<>?',deviceId,req.user.id))fail(409,'Device ID is already in use.');
      run('INSERT OR IGNORE INTO e2ee_devices VALUES (?,?,?,?)',deviceId,req.user.id,deviceName.trim(),Date.now());
    });res.json({...publicAccount(req.user.id),privateKey});
  });
  app.post('/api/e2ee/churp-managed',limited,async(req,res)=>{
    device(req);const previous=identity(req.user.id);
    if(previous?.custody!=='self')fail(409,'Churp-managed keys are already enabled.');
    const {privateKey,signature}=req.body;
    let key;
    try{
      if(typeof privateKey!=='string' || privateKey.length>20000)throw new Error('Invalid key');
      key=await readPrivate(privateKey);
      if(!key.isDecrypted() || key.getFingerprint()!==previous.fingerprint)throw new Error('A matching unlocked key is required');
      await verify(previous.public_key,'enable-managed-keys',{userId:req.user.id,fingerprint:previous.fingerprint,privateKeyHash:await digest(privateKey),historyHash:await digest(previous.history_backup || '')},signature);
    }catch{fail(400,'The current encryption key and authorization could not be verified.');}
    transaction(()=>{
      const latest=identity(req.user.id);if(latest.custody!=='self' || latest.fingerprint!==previous.fingerprint || latest.history_backup!==previous.history_backup)fail(409,'Key settings changed. Reload before continuing.');
      run('INSERT INTO e2ee_managed_keys VALUES (?,?,?)',req.user.id,previous.fingerprint,vault.seal(req.user.id,previous.fingerprint,key.armor()));
      run("UPDATE e2ee_identities SET custody='managed',backup='' WHERE user_id=?",req.user.id);
      run('DELETE FROM e2ee_transfers WHERE user_id=?',req.user.id);
    });refresh();res.json(publicAccount(req.user.id));
  });
  app.post('/api/e2ee/self-managed',limited,async(req,res)=>{
    device(req);const previous=identity(req.user.id);
    if(previous?.custody!=='managed')fail(409,'Self-managed encryption is already enabled.');
    const {publicKey,backup,historyBackup,signature,newSignature}=req.body;let key,payload;
    try{
      key=await readPublic(publicKey);
      if(key.getUserIDs().length!==1 || key.getUserIDs()[0]!==`Churp account ${req.user.id}` || key.getFingerprint()===previous.fingerprint)throw new Error('A fresh identity is required');
      await validateBackup(backup,key.getFingerprint());await validateCiphertext(historyBackup,[publicKey]);
      payload={userId:req.user.id,fromFingerprint:previous.fingerprint,toFingerprint:key.getFingerprint(),publicKey,backupHash:await digest(backup),historyHash:await digest(historyBackup)};
      await verify(previous.public_key,'self-managed-transition',payload,signature);
      await verify(publicKey,'accept-self-managed',payload,newSignature);
    }catch{fail(400,'The new self-managed identity or recovery backup could not be verified.');}
    transaction(()=>{
      const latest=identity(req.user.id);if(latest.custody!=='managed' || latest.fingerprint!==previous.fingerprint)fail(409,'Key settings changed. Reload before continuing.');
      if(one('SELECT 1 FROM e2ee_identities WHERE fingerprint=?',key.getFingerprint()) || one('SELECT 1 FROM e2ee_key_history WHERE fingerprint=?',key.getFingerprint()))fail(409,'The new identity must be unique.');
      run('INSERT INTO e2ee_key_history VALUES (?,?,?,?,?,?)',req.user.id,previous.fingerprint,previous.public_key,key.getFingerprint(),canonical(payload),signature);
      run("UPDATE e2ee_identities SET public_key=?,fingerprint=?,backup=?,history_backup=?,custody='self' WHERE user_id=?",publicKey,key.getFingerprint(),backup,historyBackup,req.user.id);
      run('DELETE FROM e2ee_managed_keys WHERE user_id=?',req.user.id);
    });refresh();res.json(publicAccount(req.user.id));
  });
  app.post('/api/e2ee/identity',limited,async(req,res)=>{
    if(identity(req.user.id))fail(409,'This account already has an encryption identity. Use recovery or another approved device.');
    const {publicKey,backup,deviceId,deviceName,signature}=req.body;
    if(!uuid(deviceId) || typeof deviceName!=='string' || !deviceName.trim() || deviceName.length>80)fail(400,'Choose a valid device name.');
    let key;
    try{
      key=await readPublic(publicKey);
      if(key.getUserIDs().length!==1 || key.getUserIDs()[0]!==`Churp account ${req.user.id}`)throw new Error('Wrong identity');
      await validateBackup(backup,key.getFingerprint());
      await verify(publicKey,'enroll',enrollmentPayload({userId:req.user.id,publicKey,backupHash:await digest(backup),deviceId,deviceName}),signature);
    }catch{fail(400,'The encryption identity or encrypted recovery backup is invalid.');}
    transaction(()=>{
      if(identity(req.user.id))fail(409,'Encryption was already set up on another device. Use recovery.');
      if(one('SELECT 1 FROM e2ee_identities WHERE fingerprint=?',key.getFingerprint()))fail(409,'An encryption identity must be unique to this account.');
      run('INSERT INTO e2ee_identities(user_id,public_key,fingerprint,backup,created_at) VALUES (?,?,?,?,?)',req.user.id,publicKey,key.getFingerprint(),backup,Date.now());
      run('INSERT INTO e2ee_devices VALUES (?,?,?,?)',deviceId,req.user.id,deviceName.trim(),Date.now());
    });
    refresh();res.status(201).json(publicAccount(req.user.id));
  });
  app.post('/api/e2ee/devices',limited,async(req,res)=>{
    const {deviceId,deviceName,signature}=req.body;
    if(!uuid(deviceId) || typeof deviceName!=='string' || !deviceName.trim() || deviceName.length>80)fail(400,'Choose a valid device name.');
    await proof(req,'device',{userId:req.user.id,deviceId,deviceName},signature);
    if(one('SELECT 1 FROM e2ee_devices WHERE id=? AND user_id<>?',deviceId,req.user.id))fail(409,'Device ID is already in use.');
    run('INSERT OR IGNORE INTO e2ee_devices VALUES (?,?,?,?)',deviceId,req.user.id,deviceName.trim(),Date.now());
    res.json({ok:true});
  });
  app.put('/api/e2ee/backup',limited,async(req,res)=>{
    device(req);const i=identity(req.user.id);
    if(i?.custody!=='self')fail(409,'Personal recovery keys are only used with self-managed encryption.');
    try{await validateBackup(req.body.backup,i.fingerprint);}catch{fail(400,'An encrypted matching recovery backup is required.');}
    await proof(req,'backup',{userId:req.user.id,backupHash:await digest(req.body.backup)},req.body.signature);
    if(!run("UPDATE e2ee_identities SET backup=? WHERE user_id=? AND fingerprint=? AND custody='self'",req.body.backup,req.user.id,i.fingerprint).changes)fail(409,'Key settings changed. Reload before replacing your recovery key.');
    res.json({ok:true});
  });
  app.post('/api/e2ee/transfers',limited,async(req,res)=>{
    const i=identity(req.user.id);if(!i)fail(409,'Set up the original encryption identity first.');
    const {deviceId,deviceName,publicKey,nonce}=req.body;
    if(!uuid(deviceId) || typeof deviceName!=='string' || !deviceName.trim() || deviceName.length>80 || !/^[a-f0-9]{64}$/.test(nonce))fail(400,'Invalid device request.');
    try{await readPublic(publicKey);}catch{fail(400,'Invalid temporary device key.');}
    run('DELETE FROM e2ee_transfers WHERE expires_at<?',Date.now());
    if(one('SELECT COUNT(*) AS n FROM e2ee_transfers WHERE user_id=?',req.user.id).n>=5)fail(429,'Too many pending devices. Let a request expire first.');
    const id=randomUUID();run('INSERT INTO e2ee_transfers VALUES (?,?,?,?,?,?,?,NULL)',id,req.user.id,deviceId,deviceName.trim(),publicKey,nonce,Date.now()+10*60*1000);
    refreshUser(req.user.id);res.status(201).json({id});
  });
  app.get('/api/e2ee/transfers',(req,res)=>{device(req);res.json({transfers:all('SELECT id,device_id,device_name,public_key,nonce,expires_at FROM e2ee_transfers WHERE user_id=? AND expires_at>? AND grant_ciphertext IS NULL',req.user.id,Date.now())});});
  function transfer(req){const t=one('SELECT * FROM e2ee_transfers WHERE id=? AND user_id=? AND expires_at>?',req.params.id,req.user.id,Date.now());if(!t)fail(410,'This device request expired. Start again.');return t;}
  app.get('/api/e2ee/transfers/:id',(req,res)=>{const t=transfer(req);res.json({ciphertext:t.grant_ciphertext,expires_at:t.expires_at});});
  app.post('/api/e2ee/transfers/:id/approve',limited,async(req,res)=>{
    device(req);const t=transfer(req);if(t.grant_ciphertext)fail(409,'This device request was already approved.');
    try{await validateCiphertext(req.body.ciphertext,[t.public_key]);}catch{fail(400,'The device grant must be encrypted for the requesting device.');}
    await proof(req,'approve-transfer',{userId:req.user.id,transferId:t.id,cipherHash:await digest(req.body.ciphertext)},req.body.signature);
    if(!run('UPDATE e2ee_transfers SET grant_ciphertext=? WHERE id=? AND grant_ciphertext IS NULL AND expires_at>?',req.body.ciphertext,t.id,Date.now()).changes)fail(409,'The device request changed.');
    refreshUser(req.user.id);res.json({ok:true});
  });
  app.delete('/api/e2ee/transfers/:id',async(req,res)=>{device(req);transfer(req);run('DELETE FROM e2ee_transfers WHERE id=? AND user_id=?',req.params.id,req.user.id);res.json({ok:true});});
  app.get('/api/groups/:id/e2ee/roster',async(req,res)=>{device(req);reader(req,req.params.id);await prepareMembers(req.params.id);res.json(roster(req,req.params.id));});
  app.get('/api/groups/:id/e2ee/legacy',async(req,res)=>{
    await readProof(req,'group',req.params.id);const {gm}=reader(req,req.params.id);cleanup();
    const messages=all(`SELECT m.* FROM messages m JOIN e2ee_legacy_readers lr ON lr.message_id=m.id AND lr.user_id=?
      WHERE m.group_id=? AND m.e2ee_version=0 AND m.deleted=0 AND m.id>? ORDER BY m.id LIMIT 10`,req.user.id,req.params.id,gm.joined_after);
    for(const m of messages){await prepareMembers(m.group_id,m.id);m.files=all('SELECT f.id,f.name,f.mime,f.size FROM files f JOIN message_files mf ON mf.file_id=f.id WHERE mf.message_id=?',m.id);m.roster=roster(req,m.group_id,m.id);}
    res.json({messages,cleanup_pending:!!one('SELECT 1 FROM e2ee_plaintext_cleanup LIMIT 1') || one("SELECT value FROM e2ee_meta WHERE key='vacuum_pending'")?.value==='1'});
  });
  app.get('/api/e2ee/legacy-files/:id',async(req,res)=>{
    await readProof(req,'file',req.params.id);
    const record=one(`SELECT f.*,m.group_id,m.id AS message_id FROM files f JOIN message_files mf ON mf.file_id=f.id JOIN messages m ON m.id=mf.message_id
      JOIN e2ee_legacy_readers lr ON lr.message_id=m.id AND lr.user_id=?
      JOIN group_members gm ON gm.group_id=m.group_id AND gm.user_id=lr.user_id
      JOIN groups g ON g.id=m.group_id JOIN community_members cm ON cm.community_id=g.community_id AND cm.user_id=lr.user_id
      WHERE f.id=? AND m.e2ee_version=0 AND m.deleted=0 AND m.id>gm.joined_after`,req.user.id,req.params.id);
    if(!record)fail(404,'Earlier attachment is unavailable.');roster(req,record.group_id,record.message_id);res.type('application/octet-stream').sendFile(join(uploadDir,record.disk_name));
  });
  const encryptedUpload=multer({dest:uploadDir,limits:{fileSize:FILE_LIMIT+65536,files:1,fields:0}});
  app.post('/api/e2ee/uploads',limited,(req,res,next)=>{device(req);next();},encryptedUpload.single('file'),async(req,res)=>{
    if(!req.file)fail(400,'Choose an encrypted attachment.');
    try{await validateEncryptedFile(readFileSync(req.file.path));}catch{try{unlinkSync(req.file.path);}catch{}fail(400,'Only encrypted message attachments can be uploaded here.');}
    const id=randomUUID();run('INSERT INTO files(id,user_id,name,disk_name,mime,size,created_at,encrypted) VALUES (?,?,?,?,?,?,?,1)',id,req.user.id,'encrypted-attachment.pgp',req.file.filename,'application/octet-stream',req.file.size,Date.now());
    res.status(201).json({file:{id}});
  });
  async function validateSend(req,gid,legacyId=null,audienceMessage=null) {
    device(req);const {ciphertext,clientId,rosterHash,signature}=req.body;
    if(typeof clientId!=='string' || (legacyId ? clientId!==`legacy-${legacyId}` : !uuid(clientId)))fail(400,'A unique encrypted message ID is required.');
    const rs=audienceMessage ? assertEditRoster(req,audienceMessage,rosterHash) : assertRoster(req,gid,rosterHash,legacyId);
    try{await validateCiphertext(ciphertext,rs.readers.map(u=>u.public_key));}catch(e){fail(400,e.message);}
    const files=req.body.files ?? [];
    if(!Array.isArray(files) || files.length>5 || files.some(id=>!uuid(id)) || new Set(files).size!==files.length)fail(400,'Attach up to five encrypted files.');
    for(const id of files)if(!one('SELECT 1 FROM files WHERE id=? AND user_id=? AND encrypted=1',id,req.user.id) || one('SELECT 1 FROM message_files WHERE file_id=?',id))fail(400,'An encrypted attachment is unavailable. Upload it again.');
    try{await validateNotificationPreviews(req.body.notificationPreviews,rs.readers,req.user.id);}catch(e){fail(400,e.message);}
    const payload=sendPayload({groupId:gid,clientId,rosterHash,cipherHash:await digest(ciphertext),files,replyTo:req.body.reply_to ?? null,...await previewProof(req.body.notificationPreviews)});
    await proof(req,legacyId ? 'migrate' : 'send',legacyId ? {...payload,legacyId} : payload,signature);
    return {rs,files,clientId,ciphertext,rosterHash};
  }
  function recordRecipients(id,rs){for(const r of rs.readers)run('INSERT INTO e2ee_recipients VALUES (?,?)',id,r.id);}
  app.put('/api/e2ee/legacy/:id',async(req,res)=>{
    const id=Number(req.params.id), original=one('SELECT * FROM messages WHERE id=? AND deleted=0',id);
    if(!original)fail(404,'Earlier message is unavailable.');
    if(original.e2ee_version)fail(409,'This message was already converted.');
    if((req.body.reply_to ?? null)!==original.reply_to)fail(400,'The original thread must be preserved.');
    const checked=await validateSend(req,original.group_id,id);
    transaction(()=>{
      const current=one('SELECT * FROM messages WHERE id=? AND deleted=0 AND e2ee_version=0',id);if(!current)fail(409,'This message changed while converting.');
      const fresh=assertRoster(req,original.group_id,checked.rosterHash,id);
      const oldFiles=all('SELECT f.* FROM files f JOIN message_files mf ON mf.file_id=f.id WHERE mf.message_id=?',id);
      if(oldFiles.length!==checked.files.length)fail(400,'All earlier attachments must be converted with their message.');
      run("UPDATE messages SET body='',ciphertext=?,client_id=?,encrypted_by=?,e2ee_version=1,recipient_hash=?,signer_fingerprint=?,self_encrypted=0 WHERE id=?",checked.ciphertext,checked.clientId,req.user.id,checked.rosterHash,identity(req.user.id).fingerprint,id);
      run('DELETE FROM message_files WHERE message_id=?',id);for(const fid of checked.files)run('INSERT INTO message_files VALUES (?,?)',id,fid);recordRecipients(id,fresh);
      run('DELETE FROM e2ee_legacy_readers WHERE message_id=?',id);
      for(const file of oldFiles){
        const used=one(`SELECT 1 FROM users WHERE avatar_id=? UNION ALL SELECT 1 FROM communities WHERE avatar_id=? UNION ALL SELECT 1 FROM subcommunities WHERE avatar_id=? UNION ALL SELECT 1 FROM groups WHERE avatar_id=? UNION ALL SELECT 1 FROM creation_requests WHERE json_extract(payload,'$.avatar_id')=? UNION ALL SELECT 1 FROM message_files WHERE file_id=? LIMIT 1`,file.id,file.id,file.id,file.id,file.id,file.id);
        if(!used){run('INSERT OR IGNORE INTO e2ee_plaintext_cleanup VALUES (?)',file.disk_name);run('DELETE FROM files WHERE id=?',file.id);}
      }
      run("INSERT OR REPLACE INTO e2ee_meta VALUES ('vacuum_pending','1')");
    });
    cleanup();refresh(original.group_id ? group(original.group_id).community_id : null);res.json({ok:true});
  });
  return {enabled,ensureManaged,device,reader,roster,members,assertRoster,validateSend,editRoster,assertEditRoster,validateEdit,recordRecipients,identity,cleanup,protection,
    canRead:(userId,m)=>!!one('SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id JOIN community_members cm ON cm.community_id=g.community_id AND cm.user_id=gm.user_id WHERE gm.group_id=? AND gm.user_id=? AND gm.joined_after<?',m.group_id,userId,m.id)
      && !!one('SELECT 1 FROM e2ee_recipients WHERE message_id=? AND user_id=?',m.id,userId)};
}
