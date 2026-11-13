import {randomUUID} from 'node:crypto';
import {unlinkSync} from 'node:fs';
import {basename,join} from 'node:path';
import {OAuth2Client} from 'google-auth-library';
import {rateLimit} from 'express-rate-limit';
import {hash,token,passwordMatches} from './security.js';
import {deletedAccountName,deletedAccountAvatar,protectedHistoryUntil} from '../shared/deleted-account.js';

export function installAccountDeletion({app,db,uploadDir,transaction,family,refresh,endSessions,googleClientId,googleVerifyToken,testing}){
 const one=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a),fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 const google=new OAuth2Client(googleClientId),verify=testing&&googleVerifyToken?googleVerifyToken:async credential=>(await google.verifyIdToken({idToken:credential,audience:googleClientId})).getPayload();
 const limited=rateLimit({windowMs:15*60000,limit:testing?1000:15,keyGenerator:req=>req.user.id,message:{error:'Please wait before trying account deletion again.'}});
 const sessionHash=req=>hash(req.cookies.gatherly_session||'');
 const current=req=>{const u=one('SELECT * FROM users WHERE id=? AND deleted_at IS NULL',req.user.id);if(!u||!one('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',sessionHash(req),req.user.id,Date.now()))fail(401,'Please sign in again before deleting your account.');return u;};
 const ownedTrees=uid=>all('SELECT id,name FROM communities WHERE owner_id=? AND archived_at IS NULL ORDER BY name,id',uid).map(c=>({...c,members:all(`SELECT u.id,u.name,u.username FROM community_members m JOIN users u ON u.id=m.user_id WHERE m.community_id=? AND u.id<>? AND u.deleted_at IS NULL ORDER BY CASE WHEN m.role='admin' THEN 0 ELSE 1 END,u.name,u.id`,c.id,uid)}));
 function cleanup(){for(const row of all('SELECT disk_name FROM account_file_cleanup LIMIT 200')){if(basename(row.disk_name)!==row.disk_name)continue;try{unlinkSync(join(uploadDir,row.disk_name));run('DELETE FROM account_file_cleanup WHERE disk_name=?',row.disk_name);}catch(e){if(e.code==='ENOENT')run('DELETE FROM account_file_cleanup WHERE disk_name=?',row.disk_name);}}}
 cleanup();const timer=setInterval(cleanup,60000);timer.unref();
 app.get('/api/me/deletion',(req,res)=>{const u=current(req);res.json({owned_trees:ownedTrees(u.id),has_password:!!u.password,has_google:!!u.google_id,google_available:!!googleClientId,linked_children:all("SELECT child_id FROM family_links WHERE parent_id=? AND status='active'",u.id).filter(r=>family.youth(r.child_id)).length,protected:family.youth(u.id)});});
 app.post('/api/me/deletion/challenge',limited,(req,res)=>{
  const u=current(req);if(!u.google_id||!googleClientId)fail(400,'Google confirmation is unavailable for this account.');const nonce=token();run('DELETE FROM account_deletion_proofs WHERE user_id=? OR expires_at<=?',u.id,Date.now());run('INSERT INTO account_deletion_proofs VALUES (?,?,?,?,NULL)',hash(nonce),u.id,sessionHash(req),Date.now()+5*60000);res.json({nonce});
 });
 app.post('/api/me/deletion/verify-google',limited,async(req,res)=>{
  const u=current(req);if(!u.google_id||!googleClientId)fail(400,'Google confirmation is unavailable for this account.');const nonce=req.body.nonce;if(typeof nonce!=='string'||nonce.length!==43||typeof req.body.credential!=='string'||req.body.credential.length>16000)fail(400,'Confirm your Google account again.');
  const proof=one('DELETE FROM account_deletion_proofs WHERE token_hash=? AND user_id=? AND session_hash=? AND verified_at IS NULL RETURNING *',hash(nonce),u.id,sessionHash(req));if(!proof||proof.expires_at<=Date.now())fail(400,'Google confirmation expired. Try again.');
  let payload;try{payload=await verify(req.body.credential);}catch{fail(401,'Google could not verify this confirmation.');}
  if(payload?.nonce!==nonce||payload?.sub!==u.google_id||payload?.email_verified!==true)fail(403,'Choose the Google account linked to this Churp account.');const fresh=current(req);if(fresh.google_id!==u.google_id||fresh.password!==u.password)fail(409,'Account security changed. Confirm your account again.');
  const verified=token();run('INSERT INTO account_deletion_proofs VALUES (?,?,?,?,?)',hash(verified),u.id,sessionHash(req),Date.now()+5*60000,Date.now());res.json({deletion_token:verified});
 });
 app.delete('/api/me/deletion',limited,async(req,res)=>{
  const u=current(req);if(req.body.confirmation!=='DELETE')fail(400,'Type DELETE to confirm permanent account deletion.');
  const transfers=req.body.transfers??{};if(!transfers||typeof transfers!=='object'||Array.isArray(transfers))fail(400,'Choose the new owner for each Tree.');
  if(u.password){if(typeof req.body.currentPassword!=='string'||req.body.currentPassword.length>128||!await passwordMatches(req.body.currentPassword,u.password))fail(403,'Your current password is incorrect.');}
  else if(typeof req.body.deletion_token!=='string'||req.body.deletion_token.length!==43)fail(403,'Confirm your linked Google account before deleting.');
  transaction(()=>{
   const fresh=current(req);if(fresh.password!==u.password||fresh.google_id!==u.google_id)fail(409,'Account security changed. Confirm your account again.');
   if(!u.password){const p=one('SELECT * FROM account_deletion_proofs WHERE token_hash=? AND user_id=? AND session_hash=? AND verified_at IS NOT NULL',hash(req.body.deletion_token),u.id,sessionHash(req));if(!p||p.expires_at<=Date.now())fail(403,'Google confirmation expired. Confirm again.');}
   const trees=ownedTrees(u.id);for(const tree of trees)if((tree.members.length||transfers[tree.id])&&!tree.members.some(m=>m.id===transfers[tree.id]))fail(409,`Choose a current member to take ownership of ${tree.name}.`);
   const now=Date.now(),historyUntil=family.youth(u.id)?protectedHistoryUntil(u.birth_date):null,keepSelf=!!historyUntil&&family.parents(u.id).length>0;
   for(const tree of trees){if(tree.members.length){run('UPDATE communities SET owner_id=? WHERE id=?',transfers[tree.id],tree.id);run("UPDATE community_members SET role='owner' WHERE community_id=? AND user_id=?",tree.id,transfers[tree.id]);}else{run('UPDATE communities SET archived_at=? WHERE id=?',now,tree.id);run('DELETE FROM invitations WHERE community_id=?',tree.id);run('DELETE FROM nest_invitations WHERE group_id IN (SELECT id FROM groups WHERE community_id=?)',tree.id);}}
   // Keep shared history and its public signing keys. Remove all future work,
   // credentials, private address-book data and access permissions.
   for(const table of ['calendar_notification_settings','calendar_event_reminders','calendar_reminder_deliveries','calendar_preferences','calendar_subscriptions'])run(`DELETE FROM ${table} WHERE user_id=?`,u.id);
   run('DELETE FROM scheduled_sends WHERE owner_id=?',u.id);run('DELETE FROM phone_drafts WHERE owner_id=?',u.id);run('DELETE FROM phone_draft_series WHERE owner_id=?',u.id);
   run('DELETE FROM sms_threads WHERE owner_id=?',u.id);run('DELETE FROM sms_jobs WHERE owner_id=?',u.id);run('DELETE FROM sms_usage WHERE owner_id=?',u.id);
   run('DELETE FROM personal_contacts WHERE owner_id=?',u.id);run('DELETE FROM birdhouses WHERE owner_id=?',u.id);
   run('DELETE FROM private_read_markers WHERE user_id=?',u.id);run('DELETE FROM private_conversation_pins WHERE user_id=?',u.id);
   if(!keepSelf)run('DELETE FROM private_conversations WHERE user_low=? AND user_high=?',u.id,u.id);
   run('DELETE FROM group_members WHERE user_id=?',u.id);run('DELETE FROM collection_members WHERE user_id=?',u.id);run('DELETE FROM scoped_admins WHERE user_id=?',u.id);run('DELETE FROM community_members WHERE user_id=?',u.id);
   run('DELETE FROM invitations WHERE created_by=?',u.id);run('DELETE FROM nest_invitations WHERE created_by=? OR recipient_id=?',u.id,u.id);run('DELETE FROM tree_join_requests WHERE user_id=? OR invited_by=?',u.id,u.id);run('DELETE FROM creation_requests WHERE requester_id=?',u.id);
   run("UPDATE private_approvals SET status='pending',reviewed_by=NULL WHERE reviewed_by=?",u.id);run("UPDATE family_links SET status='removed' WHERE parent_id=? OR (child_id=? AND status='pending')",u.id,u.id);run('DELETE FROM family_codes WHERE parent_id=?',u.id);
   run('DELETE FROM private_guardian_copies WHERE parent_id=?',u.id);run('DELETE FROM private_delivery_copies WHERE user_id=?',u.id);
   run('DELETE FROM native_push_subscriptions WHERE user_id=?',u.id);run('DELETE FROM native_auth_requests WHERE user_id=?',u.id);run('DELETE FROM notifications WHERE user_id=?',u.id);run('DELETE FROM push_subscriptions WHERE user_id=?',u.id);run('DELETE FROM pending_push_alerts WHERE user_id=?',u.id);run('DELETE FROM push_alert_windows WHERE user_id=?',u.id);
   run('DELETE FROM e2ee_transfers WHERE user_id=?',u.id);run('DELETE FROM e2ee_devices WHERE user_id=?',u.id);run('DELETE FROM e2ee_managed_keys WHERE user_id=?',u.id);run("UPDATE e2ee_identities SET backup='',history_backup=NULL WHERE user_id=?",u.id);
   run('DELETE FROM account_tokens WHERE user_id=?',u.id);run('DELETE FROM google_auth_challenges WHERE user_id=?',u.id);run('DELETE FROM account_deletion_proofs WHERE user_id=?',u.id);run('DELETE FROM sessions WHERE user_id=?',u.id);run('DELETE FROM bird_unlocks WHERE user_id=?',u.id);
   run('UPDATE users SET deleted_at=?,deleted_protected_until=?,username=?,name=?,password=NULL,google_id=NULL,google_email=NULL,email=NULL,email_verified_at=NULL,pending_email=NULL,birth_date=NULL,avatar_id=NULL,avatar_style=\'portrait\',avatar_choice=?,bird_id=\'blue\',last_community_id=NULL,notification_previews=0 WHERE id=?',now,historyUntil,`deleted_${randomUUID().replaceAll('-','')}`,deletedAccountName,deletedAccountAvatar,u.id);
   for(const f of all(`SELECT f.* FROM files f WHERE f.user_id=? AND NOT EXISTS(SELECT 1 FROM message_files r WHERE r.file_id=f.id) AND NOT EXISTS(SELECT 1 FROM private_message_files r WHERE r.file_id=f.id) AND NOT EXISTS(SELECT 1 FROM users r WHERE r.avatar_id=f.id) AND NOT EXISTS(SELECT 1 FROM communities r WHERE r.avatar_id=f.id) AND NOT EXISTS(SELECT 1 FROM subcommunities r WHERE r.avatar_id=f.id) AND NOT EXISTS(SELECT 1 FROM groups r WHERE r.avatar_id=f.id) AND NOT EXISTS(SELECT 1 FROM creation_requests r WHERE json_extract(r.payload,'$.avatar_id')=f.id)`,u.id)){run('INSERT OR IGNORE INTO account_file_cleanup VALUES (?)',f.disk_name);run('DELETE FROM files WHERE id=?',f.id);}
  });
  endSessions(u.id);refresh();cleanup();res.clearCookie('gatherly_session',{path:'/'});res.json({deleted:true});
 });
 return {close:()=>clearInterval(timer)};
}
