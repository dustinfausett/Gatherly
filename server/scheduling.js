import {randomUUID} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import * as enc from '../shared/encryption.js';
import {scheduleTime,scheduleProof,conversationParts} from '../shared/scheduling.js';
import {keyVault} from './key-vault.js';
import {hash} from './security.js';
export function installScheduling({app,db,dataDir,encryption,family,transaction,refreshUser,sendNest,sendPrivate,sms,invitations,notifyHold,testing,autoProcess=true,now=()=>Date.now()}){
 const one=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a),fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 const vault=keyVault(dataDir,!!one('SELECT 1 FROM scheduled_sends LIMIT 1')||!!one('SELECT 1 FROM e2ee_managed_keys LIMIT 1')||!!one('SELECT 1 FROM sms_messages LIMIT 1'));
 const seal=(id,value)=>vault.seal('scheduled',id,JSON.stringify(value)),open=(id,value)=>JSON.parse(vault.open('scheduled',id,value));
 const saved=one('SELECT id,packet_cipher FROM scheduled_sends LIMIT 1');if(saved)try{open(saved.id,saved.packet_cipher);}catch{throw new Error('Scheduled sends need the original key-vault.key. Restore it before starting.');}
 let working=false,closed=false;run("UPDATE scheduled_parts SET state='pending' WHERE state='sending'");
 const limited=rateLimit({windowMs:60000,limit:testing?1000:40,keyGenerator:r=>r.user.id,message:{error:'Please wait before changing more scheduled sends.'}});
 const owned=(id,uid)=>one('SELECT * FROM scheduled_sends WHERE id=? AND owner_id=?',id,uid)||fail(404,'Scheduled send not found.');
 const context=(job,entry)=>({user:one('SELECT * FROM users WHERE id=?',job.owner_id)||fail(403,'This account is unavailable.'),params:{id:entry.target_id},body:entry.request,get:name=>name.toLowerCase()==='x-churp-device'?job.device_id:undefined});
 const parts=id=>all('SELECT id,position,state,receipt,error FROM scheduled_parts WHERE send_id=? ORDER BY position',id).map(p=>({...p,receipt:p.receipt?JSON.parse(p.receipt):null}));
 function view(job){const packet=open(job.id,job.packet_cipher),rows=parts(job.id),sent=rows.filter(p=>p.state==='sent').length,status=rows.every(p=>p.state==='cancelled')?'cancelled':sent===rows.length?'sent':rows.some(p=>p.state==='sending')?'sending':rows.some(p=>p.state==='held')?'needs_review':sent?'partly_sent':'scheduled';return {id:job.id,client_id:job.client_id,send_at:job.send_at,time_zone:job.time_zone,version:job.version,created_at:job.created_at,signer_key:job.signer_key,draft_ciphertext:packet.draft_ciphertext,entries:packet.entries,parts:rows,status};}
 async function validate(req,body){
  family.requireReady(req.user.id);encryption.device(req);
  let sendAt;try{sendAt=scheduleTime(body.send_at,now());}catch(e){fail(400,e.message);}if(typeof body.time_zone!=='string'||body.time_zone.length>100)fail(400,'Choose a time zone.');try{new Intl.DateTimeFormat('en',{timeZone:body.time_zone});}catch{fail(400,'Choose a valid time zone.');}
  if(typeof body.client_id!=='string'||!/^[\da-f-]{36}$/i.test(body.client_id))fail(400,'A unique scheduled send ID is required.');
  if(!Array.isArray(body.entries)||!body.entries.length||body.entries.length>50||body.entries.some(e=>!e||typeof e!=='object'))fail(400,'Schedule between 1 and 50 messages together.');
  if(new Set(body.entries.map(e=>`${e.channel}:${e.target_id}`)).size!==body.entries.length)fail(400,'Choose different recipients.');
  const identity=encryption.identity(req.user.id);try{await enc.validateCiphertext(body.draft_ciphertext,[identity.public_key]);await enc.verify(identity.public_key,'scheduled-send',scheduleProof(body),body.signature);}catch{fail(400,'The encrypted scheduled draft could not be verified.');}
  for(const entry of body.entries){
   if(!['nest','private','sms'].includes(entry.channel)||typeof entry.target_id!=='string'||!entry.request||typeof entry.request!=='object')fail(400,'Choose a supported message destination.');
   const ctx=context({owner_id:req.user.id,device_id:req.get('x-churp-device')},entry);
   if(entry.channel==='nest'){
    if(entry.request.response_deadline&&Date.parse(entry.request.response_deadline)<=sendAt)fail(400,'Send the invitation before its response deadline.');await sendNest(ctx,{validateOnly:true});
   }else if(entry.channel==='private')await sendPrivate(ctx,{validateOnly:true});
   else{if(entry.target_id!==entry.request.tree_id)fail(400,'Choose the matching Tree for these texts.');const preview=sms.preview(req.user.id,entry.request);if(!preview.rows.some(r=>r.eligible))fail(403,'No recipients currently have permission to receive these phone texts.');}
  }
  return {sendAt,deviceId:req.get('x-churp-device'),signerKey:identity.public_key};
 }
 app.get('/api/scheduled',(req,res)=>{
  encryption.device(req);res.set('Cache-Control','no-store');const {channel,target_id:targetId}=req.query;
  if(channel!==undefined&&(!['nest','private','sms'].includes(channel)||typeof targetId!=='string'||!targetId||targetId.length>100))fail(400,'Choose a supported scheduled-message conversation.');
  const active="EXISTS(SELECT 1 FROM scheduled_parts p WHERE p.send_id=scheduled_sends.id AND p.state IN ('pending','held','sending'))";
  const rows=all(`SELECT * FROM scheduled_sends WHERE owner_id=? ${channel?`AND ${active}`:''} ORDER BY CASE WHEN ${active} THEN 0 ELSE 1 END,send_at DESC,created_at DESC LIMIT 200`,req.user.id).map(view);
  res.json({sends:channel?rows.filter(row=>conversationParts(row,channel,targetId).length):rows});
 });
 app.post('/api/scheduled',limited,async(req,res)=>{
  encryption.device(req);
  const prior=typeof req.body.client_id==='string'&&one('SELECT * FROM scheduled_sends WHERE owner_id=? AND client_id=?',req.user.id,req.body.client_id),digest=hash(JSON.stringify(req.body));
  if(prior){if(prior.request_hash!==digest)fail(409,'This scheduled send ID has already been used.');return res.json(view(prior));}
  const checked=await validate(req,req.body);let id=randomUUID();
  transaction(()=>{const repeated=one('SELECT * FROM scheduled_sends WHERE owner_id=? AND client_id=?',req.user.id,req.body.client_id);if(repeated){if(repeated.request_hash!==digest)fail(409,'This scheduled send ID has already been used.');id=repeated.id;return;}if(one("SELECT COUNT(*) AS n FROM scheduled_sends s WHERE owner_id=? AND EXISTS(SELECT 1 FROM scheduled_parts p WHERE p.send_id=s.id AND p.state IN ('pending','held','sending'))",req.user.id).n>=100)fail(400,'Manage your existing scheduled sends before adding more.');run('INSERT INTO scheduled_sends(id,owner_id,client_id,request_hash,send_at,time_zone,device_id,signer_key,packet_cipher,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',id,req.user.id,req.body.client_id,digest,checked.sendAt,req.body.time_zone,checked.deviceId,checked.signerKey,seal(id,req.body),Date.now());req.body.entries.forEach((e,i)=>run("INSERT INTO scheduled_parts(id,send_id,position,state,mode) VALUES (?,?,?,'pending',?)",randomUUID(),id,i,e.channel==='sms'?sms.mode:null));});refreshUser(req.user.id);res.status(201).json(view(owned(id,req.user.id)));
 });
 app.put('/api/scheduled/:id',limited,async(req,res)=>{
  const old=owned(req.params.id,req.user.id);if(req.body.expected_version!==old.version)fail(409,'This scheduled send changed. Refresh it before editing.');
  const checked=await validate(req,req.body);transaction(()=>{const current=owned(old.id,req.user.id);if(current.version!==req.body.expected_version||one("SELECT 1 FROM scheduled_parts WHERE send_id=? AND state NOT IN ('pending','held')",old.id))fail(409,'Delivery has started or this send changed. Refresh its status.');run('UPDATE scheduled_sends SET send_at=?,time_zone=?,device_id=?,signer_key=?,packet_cipher=?,version=version+1 WHERE id=?',checked.sendAt,req.body.time_zone,checked.deviceId,checked.signerKey,seal(old.id,req.body),old.id);run('DELETE FROM scheduled_parts WHERE send_id=?',old.id);req.body.entries.forEach((e,i)=>run("INSERT INTO scheduled_parts(id,send_id,position,state,mode) VALUES (?,?,?,'pending',?)",randomUUID(),old.id,i,e.channel==='sms'?sms.mode:null));});refreshUser(req.user.id);res.json(view(owned(old.id,req.user.id)));
 });
 app.post('/api/scheduled/:id/cancel',limited,(req,res)=>{const old=owned(req.params.id,req.user.id);transaction(()=>{if(old.version!==req.body.expected_version||one("SELECT 1 FROM scheduled_parts WHERE send_id=? AND state='sending'",old.id))fail(409,'Delivery has started or this send changed. Refresh its status.');run("UPDATE scheduled_parts SET state='cancelled',error=NULL WHERE send_id=? AND state IN ('pending','held')",old.id);run('UPDATE scheduled_sends SET version=version+1 WHERE id=?',old.id);});refreshUser(req.user.id);res.json(view(owned(old.id,req.user.id)));});
 async function tick(){
  if(working||closed)return;working=true;
  try{for(let n=0;n<10&&!closed;n++){
   const part=one("SELECT p.*,s.owner_id,s.device_id,s.packet_cipher,s.send_at FROM scheduled_parts p JOIN scheduled_sends s ON s.id=p.send_id WHERE p.state='pending' AND s.send_at<=? ORDER BY s.send_at,p.position LIMIT 1",now());if(!part)break;
   run("UPDATE scheduled_parts SET state='sending' WHERE id=? AND state='pending'",part.id);
   try{
    family.requireReady(part.owner_id);const packet=open(part.send_id,part.packet_cipher),entry=packet.entries[part.position],ctx=context(part,entry);encryption.device(ctx);
    ctx.scheduledStored=receipt=>run("UPDATE scheduled_parts SET state='sent',receipt=?,error=NULL WHERE id=? AND state='sending'",JSON.stringify(receipt),part.id);
    let receipt;
    if(entry.channel==='nest')receipt=await sendNest(ctx);
    else if(entry.channel==='private')receipt=await sendPrivate(ctx);
    else{
     if(sms.mode==='disabled')fail(410,'Provider texting has been retired. Cancel this text and prepare a phone draft in Messages.');
     if(part.mode!==sms.mode)fail(409,'Phone texting mode changed. Review this scheduled send before resubmitting.');
     let delivery=part.delivery_context?open(part.id,part.delivery_context):null;
     if(!delivery){delivery={invitation_url:await invitations.createForText(part.owner_id,entry.target_id)};run('UPDATE scheduled_parts SET delivery_context=? WHERE id=?',seal(part.id,delivery),part.id);}
     ctx.body={...entry.request,...delivery};if(!sms.preview(part.owner_id,ctx.body).rows.some(r=>r.eligible))fail(403,'Recipients no longer have permission to receive these phone texts.');receipt=sms.queue(ctx);
    }
    if(one('SELECT state FROM scheduled_parts WHERE id=?',part.id)?.state==='sending')ctx.scheduledStored(receipt);
   }catch(error){if(one('SELECT state FROM scheduled_parts WHERE id=?',part.id)?.state==='sending'){run("UPDATE scheduled_parts SET state='held',error=? WHERE id=?",(error.status&&error.status<500?String(error.message):'Delivery paused unexpectedly. Review and reschedule this send.').slice(0,300),part.id);notifyHold?.(part.owner_id);}}
   refreshUser(part.owner_id);
  }}finally{working=false;}
 }
 const timer=autoProcess?setInterval(()=>tick().catch(()=>{if(!closed)console.error('Scheduled-send processing paused; pending sends retained.');}),1000):null;timer?.unref();
 return {tick,close:()=>{closed=true;clearInterval(timer);}};
}
