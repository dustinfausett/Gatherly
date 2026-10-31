import {createHash} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import * as enc from '../shared/encryption.js';
import {reactionProof,validateReactions} from '../shared/reactions.js';

export function installReactions({app,db,encryption,encryptionRequired,family,visibleCircle,joined,transaction,refresh,refreshUser,testing}){
 const one=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 const column=channel=>channel==='nest'?'nest_message_id':'private_message_id';
 function access(req,channel,id,writing=false){
  if(!['nest','private'].includes(channel)||!Number.isSafeInteger(id)||id<1)fail(400,'Choose a valid message.');
  if(channel==='nest'){
   const message=one("SELECT * FROM messages WHERE id=? AND deleted=0 AND message_kind IN ('chat','poll','rsvp','assignments')",id)||fail(404,'Message not found.');
   const g=visibleCircle(req.user.id,message.group_id);
   if(!joined(req.user.id,g.id)||(encryptionRequired&&!encryption.canRead(req.user.id,message)))fail(404,'Message not found.');
   return {message,g,can_react:true};
  }
  encryption.device(req);
  const message=one('SELECT * FROM private_messages WHERE id=?',id)||fail(404,'Message not found.');
  const c=one('SELECT * FROM private_conversations WHERE id=?',message.conversation_id),participant=[c.user_low,c.user_high].includes(req.user.id);
  const guardian=!participant&&family.viewChild(req.user.id,c,req.query.child_id)&&one('SELECT 1 FROM private_message_readers WHERE message_id=? AND user_id=?',id,req.user.id);
  if(participant&&(message.removed_by||message.deleted||!family.participantCanRead(req.user.id,c,message)))fail(404,'Message not found.');
  if(!participant&&!guardian)fail(404,'Message not found.');
  const can_react=participant&&!family.parentBlocked(c)&&!message.removed_by&&!message.deleted&&!c.blocked_low&&!c.blocked_high&&family.pairAllowed(c.user_low,c.user_high);
  if(writing&&!can_react)fail(403,'Reactions are paused for this private conversation.');
  return {message,c,can_react};
 }
 function roster(req,channel,a){
  if(channel==='nest')return encryption.editRoster(req,a.message);
  const readers=family.readerIds(a.c).filter(id=>one('SELECT 1 FROM private_message_readers WHERE message_id=? AND user_id=?',a.message.id,id)).map(id=>{
   const i=encryption.identity(id);if(!i)fail(409,'Message keys changed. Try again.');return {id,public_key:i.public_key,fingerprint:i.fingerprint,custody:i.custody};
  });
  return {readers,roster_hash:createHash('sha256').update(enc.canonical(readers.map(({id,fingerprint,custody})=>[id,fingerprint,custody]))).digest('hex')};
 }
 function states(req,channel,id){
  return all(`SELECT r.*,u.name,COALESCE(h.public_key,i.public_key) AS signer_key FROM message_reactions r JOIN users u ON u.id=r.user_id
    LEFT JOIN e2ee_identities i ON i.user_id=r.user_id LEFT JOIN e2ee_key_history h ON h.user_id=r.user_id AND h.fingerprint=r.signer_fingerprint
    WHERE r.${column(channel)}=? ${encryptionRequired||channel==='private'?'AND EXISTS(SELECT 1 FROM reaction_readers rr WHERE rr.reaction_id=r.id AND rr.user_id=?)':''} ORDER BY r.id`,id,...(encryptionRequired||channel==='private'?[req.user.id]:[])).map(r=>({...r,channel,message_id:id}));
 }
 app.get('/api/reactions',(req,res)=>{
  const {channel}=req.query,ids=typeof req.query.ids==='string'?req.query.ids.split(',').filter(Boolean).map(Number):[];
  if(ids.length>500||new Set(ids).size!==ids.length||!['nest','private'].includes(channel))fail(400,'Choose up to 500 distinct messages.');
  const values=[];for(const id of ids){try{access(req,channel,id);values.push(...states(req,channel,id));}catch(error){if(error.status!==404)throw error;}}
  res.json({states:values});
 });
 app.get('/api/reactions/:channel/:id',(req,res)=>{
  const {channel}=req.params,id=Number(req.params.id),a=access(req,channel,id),rs=encryptionRequired||channel==='private'?roster(req,channel,a):null;
  res.json({states:states(req,channel,id),can_react:a.can_react,roster:rs});
 });
 app.put('/api/reactions/:channel/:id',rateLimit({windowMs:60000,limit:testing?1000:90,keyGenerator:req=>req.user.id,message:{error:'Please wait a moment before reacting again.'}}),async(req,res)=>{
  const {channel}=req.params,id=Number(req.params.id),encrypted=encryptionRequired||channel==='private';
  access(req,channel,id,true);
  const {expectedVersion,clientId,reactionCount,ciphertext,rosterHash,signature}=req.body;
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!Number.isInteger(reactionCount)||reactionCount<0||reactionCount>5||typeof clientId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(clientId))fail(400,'Choose up to five different reactions and refresh their current version.');
  const existing=()=>one(`SELECT * FROM message_reactions WHERE ${column(channel)}=? AND user_id=?`,id,req.user.id);
  const prior=existing();
  if(prior?.client_id===clientId){if(prior.ciphertext!==(ciphertext??null)||prior.reaction_count!==reactionCount||prior.body!==(req.body.body??null)||prior.version!==expectedVersion+1)fail(409,'This reaction update ID is already in use.');return res.json({states:states(req,channel,id)});}
  if((prior?.version||0)!==expectedVersion)fail(409,'Your reactions changed on another device. Try again.');
  let body=null,rs;
  if(encrypted){
   encryption.device(req);if(req.body.body!==undefined)fail(400,'Reactions must be encrypted on your device.');
   rs=roster(req,channel,access(req,channel,id,true));
   if(rs.roster_hash!==rosterHash||!rs.readers.some(r=>r.id===req.user.id)||rs.readers.some(r=>!r.public_key))fail(409,'The message audience changed. Try again.');
   try{await enc.validateCiphertext(ciphertext,rs.readers.map(r=>r.public_key));await enc.verify(encryption.identity(req.user.id).public_key,'message-reactions',reactionProof({channel,messageId:id,userId:req.user.id,expectedVersion,clientId,rosterHash,reactionCount,cipherHash:await enc.digest(ciphertext)}),signature);}catch{fail(400,'The encrypted reactions could not be verified.');}
  }else{
   let emojis;try{emojis=validateReactions(JSON.parse(req.body.body));}catch(e){fail(400,e.message);}
   if(emojis.length!==reactionCount)fail(400,'The reaction count does not match.');body=JSON.stringify(emojis);
  }
  transaction(()=>{
   const a=access(req,channel,id,true);
   if(encrypted)encryption.device(req);
   if(encrypted&&roster(req,channel,a).roster_hash!==rosterHash)fail(409,'The message audience changed. Try again.');
   if((existing()?.version||0)!==expectedVersion)fail(409,'Your reactions changed on another device. Try again.');
   if(one('SELECT 1 FROM message_reactions WHERE client_id=?',clientId))fail(409,'This reaction update ID is already in use.');
   run(`INSERT INTO message_reactions(${column(channel)},user_id,version,reaction_count,client_id,ciphertext,body,recipient_hash,signer_fingerprint) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(${column(channel)},user_id) DO UPDATE SET version=excluded.version,reaction_count=excluded.reaction_count,client_id=excluded.client_id,ciphertext=excluded.ciphertext,body=excluded.body,recipient_hash=excluded.recipient_hash,signer_fingerprint=excluded.signer_fingerprint`,id,req.user.id,expectedVersion+1,reactionCount,clientId,encrypted?ciphertext:null,body,encrypted?rosterHash:null,encrypted?encryption.identity(req.user.id).fingerprint:null);
   const saved=existing();run('DELETE FROM reaction_readers WHERE reaction_id=?',saved.id);if(encrypted)for(const reader of rs.readers)run('INSERT INTO reaction_readers VALUES (?,?)',saved.id,reader.id);
  });
  const a=access(req,channel,id);if(channel==='nest')refresh(a.g.community_id);else for(const uid of family.readerIds(a.c))refreshUser(uid);
  res.json({states:states(req,channel,id)});
 });
}
