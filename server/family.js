import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {ageAt,birthDate} from '../shared/family.js';
import * as enc from '../shared/encryption.js';

export function installFamily({app,db,encryption,transaction,refreshUser,publicUser,testing,onApproved}) {
  const one=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
  const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
  const hash=s=>createHash('sha256').update(s).digest('hex');
  const user=id=>one('SELECT * FROM users WHERE id=?',id);
  const age=id=>ageAt(user(id)?.birth_date);
  const youth=id=>age(id)!==null && age(id)<18;
  const parents=id=>youth(id)?all(`SELECT l.*,u.name,u.username FROM family_links l JOIN users u ON u.id=l.parent_id WHERE l.child_id=? AND l.status='active' ORDER BY l.confirmed_at,l.id`,id).filter(l=>age(l.parent_id)>=18):[];
  const guardian=(parent,child)=>parents(child).some(l=>l.parent_id===parent);
  const missing=id=>{
    const ps=parents(id);if(!ps.length)return 0;
    return ps.reduce((n,p)=>n+one(`SELECT COUNT(*) AS n FROM private_messages pm JOIN private_conversations c ON c.id=pm.conversation_id WHERE (c.user_low=? OR c.user_high=?) AND (pm.intro=0 OR EXISTS(SELECT 1 FROM private_message_readers own WHERE own.message_id=pm.id AND own.user_id=c.user_low AND c.user_low=?) OR EXISTS(SELECT 1 FROM private_message_readers own WHERE own.message_id=pm.id AND own.user_id=c.user_high AND c.user_high=?)) AND NOT EXISTS(SELECT 1 FROM private_message_readers r WHERE r.message_id=pm.id AND r.user_id=?)`,id,id,id,id,p.parent_id).n,0);
  };
  function summary(id) {
    const a=age(id),ps=parents(id),remaining=a!==null&&a<18?missing(id):0;
    const pending=all("SELECT child_id FROM family_links WHERE parent_id=? AND status='pending'",id).filter(l=>youth(l.child_id)).length+all("SELECT DISTINCT a.child_id,a.adult_id FROM private_approvals a JOIN family_links l ON l.child_id=a.child_id WHERE l.parent_id=? AND l.status='active' AND a.status='pending'",id).filter(l=>youth(l.child_id)).length;
    const pendingLinks=a!==null&&a<18?one("SELECT COUNT(*) AS n FROM family_links WHERE child_id=? AND status='pending'",id).n:0;
    return {action_required:pending>0||pendingLinks>0||remaining>0,pending_links:pendingLinks,pending_reviews:pending,age_recorded:a!==null,protected:a!==null&&a<18,parent_count:ps.length,history_remaining:remaining,needs_setup:a===null||(a<18&&(!ps.length||remaining>0))};
  }
  const ready=id=>!summary(id).needs_setup;
  function requireReady(id) {if(!ready(id))fail(403,'Complete age, parent linking and supervised-message setup before continuing.');}
  function adult(id) {if(age(id)===null||age(id)<18)fail(403,'A parent account must be 18 or older.');}
  const requiredApprovals=(a,b)=>a===b?[]:[a,b].filter(id=>youth(id)&&!guardian(id===a?b:a,id)).map(child=>({child,peer:child===a?b:a}));
  function pairAllowed(a,b) {
    return ready(a)&&ready(b)&&requiredApprovals(a,b).every(({child,peer})=>!!one("SELECT 1 FROM private_approvals WHERE child_id=? AND adult_id=? AND status='approved'",child,peer));
  }
  function requests(a,b) {
    if(!ready(a)||!ready(b))fail(403,'Both accounts must complete their age and parent setup.');
    for(const {child,peer} of requiredApprovals(a,b)){
      run("INSERT OR IGNORE INTO private_approvals(child_id,adult_id,status,requested_by,created_at) VALUES (?,?,'pending',?,?)",child,peer,a,Date.now());
      for(const p of parents(child))refreshUser(p.parent_id);refreshUser(child);
    }
  }
  const parentBlocked=(c,child=null)=>all(`SELECT child_id FROM private_parent_blocks WHERE conversation_id=? AND active=1 ${child?'AND child_id=?':''}`,c.id,...(child?[child]:[])).some(r=>youth(r.child_id)&&parents(r.child_id).length>0);
  const introAllowed=(uid,c)=>!parentBlocked(c)&&!one('SELECT 1 FROM private_messages WHERE conversation_id=?',c.id)&&!requiredApprovals(c.user_low,c.user_high).some(({child,peer})=>one("SELECT 1 FROM private_approvals WHERE child_id=? AND adult_id=? AND status='declined'",child,peer));
  const participantCanRead=(uid,c,m)=>!parentBlocked(c,uid)&&(!m.intro||m.user_id===uid||pairAllowed(c.user_low,c.user_high));
  const readerIds=c=>[...new Set([c.user_low,c.user_high,...parents(c.user_low).map(p=>p.parent_id),...parents(c.user_high).map(p=>p.parent_id)])].sort();
  const supervised=c=>youth(c.user_low)||youth(c.user_high);
  const viewChild=(uid,c,child)=>!!child && [c.user_low,c.user_high].includes(child)&&guardian(uid,child);
  const limit=rateLimit({windowMs:15*60000,limit:testing?1000:30,keyGenerator:r=>r.user.id,message:{error:'Please wait before making more family setup changes.'}});
  const touch=(...ids)=>[...new Set(ids)].forEach(refreshUser);

  app.post('/api/family/birth-date',limit,(req,res)=>{
    if(req.user.birth_date)fail(409,'Date of birth has already been recorded. It cannot be changed from account settings.');
    let date;try{date=birthDate(req.body.birth_date);}catch(e){fail(400,e.message);}
    run('UPDATE users SET birth_date=? WHERE id=? AND birth_date IS NULL',date,req.user.id);touch(req.user.id);
    res.json({user:publicUser(user(req.user.id))});
  });
  app.get('/api/family',(req,res)=>{
    const links=all(`SELECT l.*,p.name AS parent_name,p.username AS parent_username,c.name AS child_name,c.username AS child_username FROM family_links l JOIN users p ON p.id=l.parent_id JOIN users c ON c.id=l.child_id WHERE (l.parent_id=? OR l.child_id=?) AND l.status<>'removed' ORDER BY l.created_at`,req.user.id,req.user.id).map(l=>({...l,child_protected:youth(l.child_id)}));
    const approvals=all(`SELECT a.*,u.name AS adult_name,u.username AS adult_username,c.name AS child_name FROM private_approvals a JOIN users u ON u.id=a.adult_id JOIN users c ON c.id=a.child_id WHERE a.child_id=? OR EXISTS(SELECT 1 FROM family_links l WHERE l.parent_id=? AND l.child_id=a.child_id AND l.status='active') ORDER BY a.created_at DESC`,req.user.id,req.user.id).filter(a=>youth(a.child_id));
    res.json({status:summary(req.user.id),links,approvals});
  });
  app.post('/api/family/codes',limit,(req,res)=>{
    adult(req.user.id);const code=randomBytes(9).toString('base64url').toUpperCase(),expires=Date.now()+86400000;
    run('DELETE FROM family_codes WHERE parent_id=? OR expires_at<?',req.user.id,Date.now());
    run('INSERT INTO family_codes(token_hash,parent_id,expires_at) VALUES (?,?,?)',hash(code),req.user.id,expires);
    res.json({code,expires_at:expires});
  });
  app.post('/api/family/claim',limit,(req,res)=>{
    if(!youth(req.user.id))fail(403,'Only an account under 18 can enter a parent invitation.');
    const code=typeof req.body.code==='string'?req.body.code.replace(/\s/g,'').toUpperCase():'';
    const found=code.length<=30&&one('SELECT * FROM family_codes WHERE token_hash=? AND expires_at>? AND claimed_at IS NULL',hash(code),Date.now());
    if(!found)fail(400,'This parent code is invalid, expired or already used.');adult(found.parent_id);
    transaction(()=>{
      if(one("SELECT COUNT(*) AS n FROM family_links WHERE child_id=? AND status IN ('pending','active')",req.user.id).n>=2)fail(409,'An account can have up to two linked parents.');
      const old=one('SELECT * FROM family_links WHERE parent_id=? AND child_id=?',found.parent_id,req.user.id);
      if(old&&old.status!=='removed')fail(409,'That parent is already linked or awaiting confirmation.');
      if(old)run("UPDATE family_links SET id=?,status='pending',created_at=?,confirmed_at=NULL WHERE parent_id=? AND child_id=?",randomUUID(),Date.now(),found.parent_id,req.user.id);
      else run("INSERT INTO family_links(id,parent_id,child_id,status,created_at) VALUES (?,?,?,'pending',?)",randomUUID(),found.parent_id,req.user.id,Date.now());
      run('UPDATE family_codes SET claimed_at=? WHERE token_hash=?',Date.now(),found.token_hash);
    });touch(req.user.id,found.parent_id);res.json({pending:true});
  });
  app.post('/api/family/links/:id/confirm',limit,(req,res)=>{
    adult(req.user.id);if(req.body.confirm_parent!==true)fail(400,'Confirm that you are this user’s parent or legal guardian.');
    const link=one("SELECT * FROM family_links WHERE id=? AND parent_id=? AND status='pending'",req.params.id,req.user.id)||fail(404,'Pending family link not found.');
    if(!youth(link.child_id))fail(409,'This account is no longer under 18.');
    if(parents(link.child_id).length>=2)fail(409,'Two parents are already linked.');
    run("UPDATE family_links SET status='active',confirmed_at=? WHERE id=?",Date.now(),link.id);touch(req.user.id,link.child_id);res.json({ok:true});
  });
  app.delete('/api/family/links/:id',limit,(req,res)=>{
    const l=one("SELECT * FROM family_links WHERE id=? AND status<>'removed'",req.params.id)||fail(404,'Family link not found.');
    if(l.parent_id!==req.user.id && !(l.child_id===req.user.id&&l.status==='pending'))fail(403,'Only the linked parent can remove an active family link.');
    run("UPDATE family_links SET status='removed' WHERE id=?",l.id);
    // Approval belongs to the child, but cannot outlive the approving parent link.
    run("UPDATE private_approvals SET status='pending',reviewed_by=NULL WHERE child_id=? AND reviewed_by=?",l.child_id,l.parent_id);
    touch(l.parent_id,l.child_id);res.json({ok:true});
  });
  const requestConversation=(child,peer)=>one('SELECT * FROM private_conversations WHERE (user_low=? AND user_high=?) OR (user_low=? AND user_high=?)',child,peer,peer,child)||fail(404,'Conversation not found.');
  app.get('/api/family/requests/:child/:peer',(req,res)=>{
    encryption.device(req);if(!guardian(req.user.id,req.params.child))fail(404,'Message request not found.');
    const c=requestConversation(req.params.child,req.params.peer),messages=all(`SELECT m.*,COALESCE(h.public_key,i.public_key) AS signer_key,u.name FROM private_messages m JOIN users u ON u.id=m.user_id LEFT JOIN e2ee_identities i ON i.user_id=m.user_id LEFT JOIN e2ee_key_history h ON h.user_id=m.user_id AND h.fingerprint=m.signer_fingerprint WHERE m.conversation_id=? AND m.intro=1 AND EXISTS(SELECT 1 FROM private_message_readers r WHERE r.message_id=m.id AND r.user_id=?)`,c.id,req.user.id).map(m=>({...m,files:all('SELECT file_id AS id FROM private_message_files WHERE message_id=?',m.id)}));
    const recipients=[...new Set([c.user_low,c.user_high])].map(id=>({id,...encryption.identity(id)})).map(({id,public_key,fingerprint})=>({id,public_key,fingerprint}));res.json({conversation:c,messages,recipients});
  });
  app.post('/api/family/approvals',limit,async(req,res)=>{const {child_id,adult_id,decision,delivery_copies=[]}=req.body;
    encryption.device(req);if(!guardian(req.user.id,child_id))fail(403,'Only a linked parent can review this request.');
    if(!['approved','declined'].includes(decision))fail(400,'Choose approved or declined.');
    const approval=one('SELECT * FROM private_approvals WHERE child_id=? AND adult_id=?',child_id,adult_id);if(!approval)fail(404,'Message request not found.');
    const c=requestConversation(child_id,adult_id),intro=one('SELECT * FROM private_messages WHERE conversation_id=? AND intro=1',c.id);
    if(!one('SELECT 1 FROM private_messages WHERE conversation_id=?',c.id))fail(409,'Read the first message before approving this conversation.');
    if(!Array.isArray(delivery_copies)||delivery_copies.length>2)fail(400,'Invalid protected message copies.');
    const checked=[];
    if(decision==='approved'&&intro){
      for(const id of [...new Set([c.user_low,c.user_high])]){
        if(one('SELECT 1 FROM private_message_readers WHERE message_id=? AND user_id=?',intro.id,id))continue;
        const copy=delivery_copies.find(x=>x.message_id===intro.id&&x.user_id===id),identity=encryption.identity(id);
        if(!copy||!identity)fail(400,'Share the reviewed first message with its participant before approval.');
        try{await enc.validateCiphertext(copy.ciphertext,[identity.public_key]);if(await enc.encryptedContentsHash(copy.ciphertext)!==await enc.encryptedContentsHash(intro.ciphertext))throw new Error('Changed contents');await enc.verify(encryption.identity(req.user.id).public_key,'private-intro-share',{messageId:intro.id,recipientId:id,originalHash:await enc.digest(intro.ciphertext),copyHash:await enc.digest(copy.ciphertext)},copy.signature);}catch{fail(400,'The reviewed first message could not be verified.');}
        checked.push({...copy,fingerprint:identity.fingerprint});
      }
    }
    transaction(()=>{
      if(!guardian(req.user.id,child_id))fail(403,'Parent link changed.');
      for(const copy of checked){if(encryption.identity(copy.user_id)?.fingerprint!==copy.fingerprint)fail(409,'Participant keys changed. Review this request again.');run('INSERT OR REPLACE INTO private_delivery_copies VALUES (?,?,?,?,?)',intro.id,copy.user_id,copy.ciphertext,req.user.id,copy.signature);run('INSERT OR IGNORE INTO private_message_readers VALUES (?,?)',intro.id,copy.user_id);}
      run('UPDATE private_approvals SET status=?,reviewed_by=? WHERE child_id=? AND adult_id=?',decision,req.user.id,child_id,adult_id);
      if(decision==='declined')run('INSERT INTO private_parent_blocks VALUES (?,?,?,1) ON CONFLICT(conversation_id,child_id) DO UPDATE SET parent_id=excluded.parent_id,active=1',c.id,child_id,req.user.id);
    });
    touch(c.user_low,c.user_high,...parents(c.user_low).map(p=>p.parent_id),...parents(c.user_high).map(p=>p.parent_id));
    if(intro&&pairAllowed(c.user_low,c.user_high)&&!parentBlocked(c))onApproved?.(intro,c);
    res.json({ok:true});
  });
  app.post('/api/family/conversations/:id/block',limit,(req,res)=>{
    const c=one('SELECT * FROM private_conversations WHERE id=?',req.params.id),{child_id,blocked}=req.body;
    if(!c||![c.user_low,c.user_high].includes(child_id)||!guardian(req.user.id,child_id))fail(404,'Protected conversation not found.');if(typeof blocked!=='boolean')fail(400,'Choose whether to block this conversation.');
    if(!blocked&&requiredApprovals(c.user_low,c.user_high).filter(r=>r.child===child_id).some(r=>!one("SELECT 1 FROM private_approvals WHERE child_id=? AND adult_id=? AND status='approved'",r.child,r.peer)))fail(409,'Approve the reviewed first message before unblocking.');
    run('INSERT INTO private_parent_blocks VALUES (?,?,?,?) ON CONFLICT(conversation_id,child_id) DO UPDATE SET parent_id=excluded.parent_id,active=excluded.active',c.id,child_id,req.user.id,Number(blocked));touch(c.user_low,c.user_high,...parents(child_id).map(p=>p.parent_id));if(!blocked&&!parentBlocked(c)){const intro=one('SELECT * FROM private_messages WHERE conversation_id=? AND intro=1',c.id);if(intro)onApproved?.(intro,c);}res.json({ok:true});
  });
  app.post('/api/family/messages/:id/remove',limit,(req,res)=>{
    const m=one('SELECT * FROM private_messages WHERE id=?',req.params.id),c=m&&one('SELECT * FROM private_conversations WHERE id=?',m.conversation_id),child=req.body.child_id;
    if(!c||![c.user_low,c.user_high].includes(child)||!guardian(req.user.id,child))fail(404,'Protected message not found.');
    run('UPDATE private_messages SET removed_by=?,removed_at=? WHERE id=?',req.user.id,Date.now(),m.id);touch(c.user_low,c.user_high,...parents(child).map(p=>p.parent_id));res.json({ok:true});
  });
  app.get('/api/family/children/:id/conversations',(req,res)=>{
    requireReady(req.user.id);if(!guardian(req.user.id,req.params.id))fail(404,'Protected account not found.');
    const child=req.params.id,cs=all(`SELECT c.*,a.name AS low_name,b.name AS high_name FROM private_conversations c JOIN users a ON a.id=c.user_low JOIN users b ON b.id=c.user_high WHERE c.user_low=? OR c.user_high=? ORDER BY c.created_at DESC`,child,child).map(c=>({...c,name:c.user_low===child?c.high_name:c.low_name,child_name:user(child).name}));
    res.json({conversations:cs.map(c=>({...c,approval_required:!pairAllowed(c.user_low,c.user_high),parent_blocked:parentBlocked(c,child),peer_id:c.user_low===child?c.user_high:c.user_low,own_approval:one('SELECT status FROM private_approvals WHERE child_id=? AND adult_id=?',child,c.user_low===child?c.user_high:c.user_low)?.status}))});
  });
  // These routes run before the setup gate: only the child and an approved device
  // may migrate old ciphertext. Parents never receive the child's identity keys.
  app.get('/api/family/history',async(req,res)=>{
    encryption.device(req);if(!youth(req.user.id))return res.json({messages:[],parents:[],remaining:0});
    const ps=parents(req.user.id);for(const p of ps)await encryption.ensureManaged(p.parent_id);
    const rows=all(`SELECT pm.*,COALESCE(kh.public_key,i.public_key) AS signer_key FROM private_messages pm JOIN private_conversations c ON c.id=pm.conversation_id LEFT JOIN e2ee_identities i ON i.user_id=pm.user_id LEFT JOIN e2ee_key_history kh ON kh.user_id=pm.user_id AND kh.fingerprint=pm.signer_fingerprint WHERE (c.user_low=? OR c.user_high=?) AND (pm.intro=0 OR EXISTS(SELECT 1 FROM private_message_readers own WHERE own.message_id=pm.id AND own.user_id=?)) AND EXISTS(SELECT 1 FROM family_links l WHERE l.child_id=? AND l.status='active' AND NOT EXISTS(SELECT 1 FROM private_message_readers r WHERE r.message_id=pm.id AND r.user_id=l.parent_id)) ORDER BY pm.id LIMIT 20`,req.user.id,req.user.id,req.user.id,req.user.id);
    res.json({messages:rows.map(m=>({...m,ciphertext:one('SELECT ciphertext FROM private_delivery_copies WHERE message_id=? AND user_id=?',m.id,req.user.id)?.ciphertext||m.ciphertext,files:all('SELECT file_id AS id FROM private_message_files WHERE message_id=?',m.id),missing:ps.filter(p=>!one('SELECT 1 FROM private_message_readers WHERE message_id=? AND user_id=?',m.id,p.parent_id)).map(p=>p.parent_id)})),parents:ps.map(p=>({id:p.parent_id,link_id:p.id,...encryption.identity(p.parent_id)})).map(p=>({id:p.id,link_id:p.link_id,public_key:p.public_key,fingerprint:p.fingerprint})),remaining:missing(req.user.id)});
  });
  app.post('/api/family/history/:id',rateLimit({windowMs:60000,limit:testing?1000:600,keyGenerator:r=>r.user.id,message:{error:'Please wait a minute, then resume message setup.'}}),async(req,res)=>{
    encryption.device(req);const {parent_id,link_id,ciphertext,signature}=req.body;
    const allowed=()=>{if(!guardian(parent_id,req.user.id)||!one("SELECT 1 FROM family_links WHERE id=? AND parent_id=? AND child_id=? AND status='active'",link_id,parent_id,req.user.id))fail(403,'Parent link changed. Reload family setup.');};allowed();
    const m=one(`SELECT pm.* FROM private_messages pm JOIN private_conversations c ON c.id=pm.conversation_id WHERE pm.id=? AND (c.user_low=? OR c.user_high=?)`,req.params.id,req.user.id,req.user.id)||fail(404,'Private message not found.');
    const fingerprint=encryption.identity(parent_id)?.fingerprint;
    const readableCipher=one('SELECT ciphertext FROM private_delivery_copies WHERE message_id=? AND user_id=?',m.id,req.user.id)?.ciphertext||m.ciphertext;
    const proof={messageId:m.id,parentId:parent_id,linkId:link_id,originalHash:await enc.digest(readableCipher),copyHash:await enc.digest(ciphertext)};
    try{
      await enc.verify(encryption.identity(req.user.id).public_key,'guardian-history',proof,signature);
      await enc.validateCiphertext(ciphertext,[encryption.identity(parent_id).public_key]);
      if(await enc.encryptedContentsHash(ciphertext)!==await enc.encryptedContentsHash(m.ciphertext))throw new Error('Message contents changed.');
    }catch{fail(400,'The historical message access could not be verified.');}
    transaction(()=>{allowed();encryption.device(req);if(encryption.identity(parent_id)?.fingerprint!==fingerprint)fail(409,'Parent keys changed. Try again.');
      run('INSERT OR REPLACE INTO private_guardian_copies VALUES (?,?,?,?,?,?)',m.id,parent_id,ciphertext,req.user.id,signature,Date.now());
      run('INSERT OR IGNORE INTO private_message_readers VALUES (?,?)',m.id,parent_id);
    });touch(req.user.id,parent_id);if(ready(req.user.id))for(const m of all('SELECT pm.* FROM private_messages pm JOIN private_conversations c ON c.id=pm.conversation_id WHERE pm.intro=1 AND (c.user_low=? OR c.user_high=?)',req.user.id,req.user.id)){const c=one('SELECT * FROM private_conversations WHERE id=?',m.conversation_id);if(pairAllowed(c.user_low,c.user_high)&&!parentBlocked(c))onApproved?.(m,c);}res.json({ok:true});
  });
  return {requiredApprovals,parentBlocked,introAllowed,participantCanRead,summary,ready,requireReady,parents,guardian,pairAllowed,requests,readerIds,supervised,viewChild,youth,age};
}
