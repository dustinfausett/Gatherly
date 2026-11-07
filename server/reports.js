import {randomUUID} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {keyVault} from './key-vault.js';
import * as enc from '../shared/encryption.js';
import {reportReasons,reportStatuses} from '../shared/reports.js';
export function installReports({app,db,dataDir,encryption,encryptionRequired,family,visibleCircle,joined,transaction,refresh,refreshUser}){
 const one=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a),fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 db.exec(`CREATE TABLE IF NOT EXISTS report_reviewers(user_id TEXT PRIMARY KEY REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS report_config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS report_identity(id INTEGER PRIMARY KEY CHECK(id=1),public_key TEXT NOT NULL,fingerprint TEXT NOT NULL,encrypted_private TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS safety_reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES users(id),sender_id TEXT NOT NULL REFERENCES users(id),channel TEXT NOT NULL,message_id INTEGER NOT NULL,community_id TEXT REFERENCES communities(id) ON DELETE SET NULL,reason TEXT NOT NULL,contents TEXT NOT NULL,source_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',version INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS safety_report_scope ON safety_reports(community_id,status,created_at);
 CREATE TABLE IF NOT EXISTS report_audit(id INTEGER PRIMARY KEY,report_id TEXT NOT NULL REFERENCES safety_reports(id),actor_id TEXT NOT NULL REFERENCES users(id),event TEXT NOT NULL,created_at INTEGER NOT NULL);`);
 // Bind the already established operator once to an immutable account ID.
 // Renaming or reusing a username cannot inherit moderation privileges.
 if(!one("SELECT 1 FROM report_config WHERE key='operator_initialized'")){
  const operator=one("SELECT id FROM users WHERE username='dustin' AND deleted_at IS NULL");
  if(operator)transaction(()=>{run('INSERT OR IGNORE INTO report_reviewers VALUES (?)',operator.id);run("INSERT INTO report_config VALUES ('operator_initialized','1')");});
 }
 const vault=keyVault(dataDir,!!one('SELECT 1 FROM report_identity')||!!one('SELECT 1 FROM e2ee_managed_keys'));
 let preparing;
 async function identity(){let row=one('SELECT * FROM report_identity WHERE id=1');if(row)return row;if(!preparing)preparing=(async()=>{const keys=await enc.generateIdentity('Churp safety reports');transaction(()=>{if(!one('SELECT 1 FROM report_identity'))run('INSERT INTO report_identity VALUES (1,?,?,?)',keys.publicKey,keys.fingerprint,vault.seal('safety-reports',keys.fingerprint,keys.privateKey.armor()));});return one('SELECT * FROM report_identity WHERE id=1');})().finally(()=>preparing=null);return preparing;}
 const platform=uid=>!!one('SELECT 1 FROM report_reviewers rr JOIN users u ON u.id=rr.user_id WHERE rr.user_id=? AND u.deleted_at IS NULL',uid);
 const canReview=(uid,r)=>platform(uid)||!!r.community_id&&!!one("SELECT 1 FROM community_members WHERE community_id=? AND user_id=? AND role IN ('owner','admin')",r.community_id,uid);
 const reviewable=uid=>all("SELECT * FROM safety_reports ORDER BY CASE WHEN status IN ('open','in_review') THEN 0 ELSE 1 END,created_at DESC,id").filter(r=>canReview(uid,r));
 const summary=uid=>({platform_admin:platform(uid),can_review:platform(uid)||!!one("SELECT 1 FROM community_members WHERE user_id=? AND role IN ('owner','admin')",uid),pending:reviewable(uid).filter(r=>['open','in_review'].includes(r.status)).length});
 const audit=(r,uid,event)=>run('INSERT INTO report_audit(report_id,actor_id,event,created_at) VALUES (?,?,?,?)',r.id,uid,event,Date.now());
 const unpack=r=>JSON.parse(vault.open('safety-report',r.id,r.contents));
 function access(req,channel,id){
  if(!['nest','private'].includes(channel)||!Number.isSafeInteger(id)||id<1)fail(400,'Choose a valid message.');encryption.device(req);
  if(channel==='nest'){
   const m=one("SELECT * FROM messages WHERE id=? AND deleted=0 AND message_kind IN ('chat','poll','rsvp','assignments')",id)||fail(404,'Message not found.'),g=visibleCircle(req.user.id,m.group_id);
   if(!joined(req.user.id,g.id)||(encryptionRequired&&!encryption.canRead(req.user.id,m)))fail(404,'Message not found.');
   return {m,source:m.ciphertext,signer:m.encrypted_by||m.user_id,trees:all('SELECT id,name FROM communities WHERE id=? AND archived_at IS NULL',g.community_id),location:g.name,treeName:one('SELECT name FROM communities WHERE id=?',g.community_id)?.name};
  }
  const m=one('SELECT * FROM private_messages WHERE id=?',id)||fail(404,'Message not found.'),c=one('SELECT * FROM private_conversations WHERE id=?',m.conversation_id),participant=[c.user_low,c.user_high].includes(req.user.id),guardian=!participant&&family.viewChild(req.user.id,c,req.query.child_id)&&one('SELECT 1 FROM private_message_readers WHERE message_id=? AND user_id=?',id,req.user.id);
  if(!guardian&&(!participant||m.deleted||m.removed_by||!family.participantCanRead(req.user.id,c,m)))fail(404,'Message not found.');
  if(!one('SELECT 1 FROM private_message_readers WHERE message_id=? AND user_id=?',id,req.user.id))fail(404,'Message not found.');
  const copy=one('SELECT ciphertext FROM private_delivery_copies WHERE message_id=? AND user_id=?',id,req.user.id)||one('SELECT ciphertext FROM private_guardian_copies WHERE message_id=? AND parent_id=?',id,req.user.id);
  const trees=all(`SELECT c.id,c.name FROM communities c JOIN community_members a ON a.community_id=c.id AND a.user_id=? JOIN community_members b ON b.community_id=c.id AND b.user_id=? JOIN community_members r ON r.community_id=c.id AND r.user_id=? WHERE c.archived_at IS NULL ORDER BY c.name`,c.user_low,c.user_high,req.user.id);
  return {m,c,guardian,source:copy?.ciphertext||m.ciphertext,signer:m.user_id,trees,location:'Private conversation'};
 }
 const limited=rateLimit({windowMs:15*60000,limit:20,keyGenerator:req=>req.user.id,message:{error:'Please wait before submitting more reports.'}});
 app.get('/api/reports/context/:channel/:id',async(req,res)=>{const a=access(req,req.params.channel,Number(req.params.id)),key=await identity();access(req,req.params.channel,Number(req.params.id));res.json({public_key:key.public_key,trees:a.trees,can_block:!a.guardian&&a.m.user_id!==req.user.id,sender_name:one('SELECT name FROM users WHERE id=?',a.m.user_id)?.name});});
 app.post('/api/reports/:channel/:id',limited,async(req,res)=>{
  const {channel}=req.params,id=Number(req.params.id),a=access(req,channel,id),{reason,details='',consent,community_id=null,ciphertext}=req.body;
  if(consent!==true)fail(400,'Confirm sharing this selected message with the reviewers.');
  if(!reportReasons.some(r=>r.id===reason)||typeof details!=='string'||details.length>2000)fail(400,'Choose a reason and keep details under 2,000 characters.');
  if(community_id!==null&&!a.trees.some(t=>t.id===community_id))fail(403,'Choose a shared Tree offered for this report.');
  if(!one('SELECT 1 FROM report_reviewers rr JOIN users u ON u.id=rr.user_id WHERE u.deleted_at IS NULL'))fail(503,'Churp review is awaiting setup. Contact churptree@gmail.com.');
  let value,sourceHash;
  try{if(typeof ciphertext!=='string'||ciphertext.length>800000)throw Error();sourceHash=await enc.encryptedContentsHash(a.source);if(await enc.encryptedContentsHash(ciphertext)!==sourceHash)throw Error();const key=await identity(),signer=one('SELECT public_key FROM e2ee_key_history WHERE user_id=? AND fingerprint=?',a.signer,a.m.signer_fingerprint)?.public_key||encryption.identity(a.signer)?.public_key;value=await enc.open(await enc.readPrivate(vault.open('safety-reports',key.fingerprint,key.encrypted_private)),signer,ciphertext);if(typeof value.body!=='string'||value.body.length>10000)throw Error();}catch{fail(400,'The selected message could not be verified. Reopen it and try again.');}
  const reportId=randomUUID(),now=Date.now();
  transaction(()=>{const fresh=access(req,channel,id);if(fresh.source!==a.source)fail(409,'This message changed. Reopen it before reporting.');if(community_id!==null&&!fresh.trees.some(t=>t.id===community_id))fail(403,'Tree access changed. Reopen the report.');
   if(one("SELECT 1 FROM safety_reports WHERE reporter_id=? AND channel=? AND message_id=? AND source_hash=? AND status IN ('open','in_review')",req.user.id,channel,id,sourceHash))fail(409,'You already have an open report for this message.');
   // Never persist message keys, original ciphertext, attachment descriptors or other chat history.
   const contents={consent:{version:1,shared_with_churp:true,tree_id:community_id,tree_name:a.trees.find(t=>t.id===community_id)?.name||null},body:value.body,content_type:value.contentType||'chat',details,location:a.location,tree_name:a.treeName||null,sent_at:a.m.created_at,edit_version:a.m.edit_version||0,attachment_count:Array.isArray(value.attachments)?value.attachments.length:0,review_note:'',action:'none'};
   run('INSERT INTO safety_reports(id,reporter_id,sender_id,channel,message_id,community_id,reason,contents,source_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',reportId,req.user.id,a.m.user_id,channel,id,community_id,reason,vault.seal('safety-report',reportId,JSON.stringify(contents)),sourceHash,now,now);audit({id:reportId},req.user.id,'submitted');
  });refresh();res.status(201).json({id:reportId,status:'open'});
 });
 app.post('/api/reports/block/:channel/:id',limited,(req,res)=>{const a=access(req,req.params.channel,Number(req.params.id));if(a.guardian||a.m.user_id===req.user.id)fail(400,'Use family protection to block your child’s conversation.');transaction(()=>{const [low,high]=[req.user.id,a.m.user_id].sort();let c=one('SELECT * FROM private_conversations WHERE user_low=? AND user_high=?',low,high);if(!c){const id=randomUUID();run('INSERT INTO private_conversations(id,user_low,user_high,created_at,created_by) VALUES (?,?,?,?,?)',id,low,high,Date.now(),req.user.id);c=one('SELECT * FROM private_conversations WHERE id=?',id);}run(`UPDATE private_conversations SET ${c.user_low===req.user.id?'blocked_low':'blocked_high'}=1 WHERE id=?`,c.id);});refreshUser(req.user.id);refreshUser(a.m.user_id);res.json({ok:true});});
 const brief=r=>({id:r.id,channel:r.channel,reason:r.reason,status:r.status,version:r.version,created_at:r.created_at,updated_at:r.updated_at,shared_with_tree:!!r.community_id});
 app.get('/api/reports',(req,res)=>{const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)fail(400,'Choose a valid report page.');const rows=reviewable(req.user.id);res.json({...summary(req.user.id),mine:all('SELECT * FROM safety_reports WHERE reporter_id=? ORDER BY created_at DESC LIMIT 100',req.user.id).map(brief),queue:rows.slice(offset,offset+100).map(brief),more:rows.length>offset+100,next_offset:offset+100});});
 app.get('/api/reports/:id',(req,res)=>{const r=one('SELECT * FROM safety_reports WHERE id=?',req.params.id);if(!r||!canReview(req.user.id,r))fail(404,'Report not found.');audit(r,req.user.id,'viewed');res.json({report:{...brief(r),...unpack(r),reporter:one('SELECT name FROM users WHERE id=?',r.reporter_id)?.name,sender:one('SELECT name FROM users WHERE id=?',r.sender_id)?.name,tree_admin_access:!!r.community_id}});});
 app.patch('/api/reports/:id',async(req,res)=>{const r=one('SELECT * FROM safety_reports WHERE id=?',req.params.id);if(!r||!canReview(req.user.id,r))fail(404,'Report not found.');const {status,note='',action='none',expected_version}=req.body;if(!reportStatuses.includes(status)||!['none','remove_message'].includes(action)||typeof note!=='string'||note.length>2000||!Number.isSafeInteger(expected_version))fail(400,'Choose a status and a review note under 2,000 characters.');if(action==='remove_message'&&status!=='resolved')fail(400,'Resolve the report when removing a message.');
  transaction(()=>{const current=one('SELECT * FROM safety_reports WHERE id=?',r.id);if(!canReview(req.user.id,current))fail(404,'Report not found.');if(current.version!==expected_version)fail(409,'This report changed. Reopen it before saving.');const contents=unpack(current);if(action==='remove_message'){
   if(current.channel==='nest'){
    const m=one('SELECT * FROM messages WHERE id=?',current.message_id);
    if(m){run("UPDATE messages SET deleted=1,body='',ciphertext=NULL WHERE id=?",m.id);run('DELETE FROM message_reactions WHERE nest_message_id=?',m.id);run('DELETE FROM message_files WHERE message_id=?',m.id);run('DELETE FROM notifications WHERE message_id=?',m.id);
     const related={poll:['poll_vote','poll_votes','poll_id'],rsvp:['rsvp_response','rsvp_responses','event_id'],assignments:['assignment_op','assignment_lists','message_id']}[m.message_kind];
     if(related){run("UPDATE messages SET deleted=1,body='',ciphertext=NULL WHERE reply_to=? AND message_kind=?",m.id,related[0]);run(`DELETE FROM ${related[1]} WHERE ${related[2]}=?`,m.id);}
    }
   }else run('UPDATE private_messages SET deleted=1 WHERE id=?',current.message_id);
   audit(current,req.user.id,'removed_message');
  }contents.review_note=note;contents.action=action;run('UPDATE safety_reports SET contents=?,status=?,version=version+1,updated_at=? WHERE id=?',vault.seal('safety-report',r.id,JSON.stringify(contents)),status,Date.now(),r.id);audit(current,req.user.id,`status:${status}`);});refresh();res.json({ok:true});
 });
 return {summary,isPlatform:platform};
}
