import { randomBytes,randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import QRCode from 'qrcode';
import { hash,token } from './security.js';

export function installInvitations({app,db,appUrl,testing,transaction,membership,communityAdmin,groupAdmin,group,joinParent,refresh,refreshUser}){
  const one=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
  const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
  const limited=rateLimit({windowMs:15*60000,limit:testing?1000:30,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Please wait before creating more invitations.'}});
  const accepting=rateLimit({windowMs:15*60000,limit:testing?1000:60,skipSuccessfulRequests:true,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Please wait before trying another invitation.'}});
  const treeReviewer=(uid,cid)=>{try{return communityAdmin(uid,cid)||!!one("SELECT 1 FROM scoped_admins sa JOIN subcommunities s ON s.id=sa.scope_id WHERE sa.scope_type='subcommunity' AND sa.user_id=? AND s.community_id=?",uid,cid);}catch{return false;}};
  const memberLink=inv=>{try{membership(inv.created_by,inv.community_id);return true;}catch{return false;}};
  const validSender=inv=>{try{return inv.group_id?groupAdmin(inv.created_by,group(inv.group_id)):inv.requires_approval?memberLink(inv):treeReviewer(inv.created_by,inv.community_id);}catch{return false;}};
  const fresh=inv=>{if(!inv || inv.expires_at<=Date.now() || !validSender(inv))fail(410,'This invitation is invalid, expired or revoked. Ask an admin for a new invitation.');return inv;};
  function join(userId,inv){
    if(inv.group_id && !one('SELECT 1 FROM community_members WHERE community_id=? AND user_id=?',inv.community_id,userId))fail(403,'Join the Tree with a Tree invitation before accepting a Nest invitation.');
    if(!inv.group_id && inv.requires_approval && !one('SELECT 1 FROM community_members WHERE community_id=? AND user_id=?',inv.community_id,userId)){
      const old=one('SELECT * FROM tree_join_requests WHERE community_id=? AND user_id=?',inv.community_id,userId);
      if(old?.status!=='pending')run("INSERT INTO tree_join_requests(id,community_id,user_id,invited_by,status,created_at) VALUES (?,?,?,?,'pending',?) ON CONFLICT(community_id,user_id) DO UPDATE SET invited_by=excluded.invited_by,status='pending',created_at=excluded.created_at,reviewed_by=NULL",randomUUID(),inv.community_id,userId,inv.created_by,Date.now());
      for(const u of all('SELECT user_id FROM community_members WHERE community_id=?',inv.community_id))if(treeReviewer(u.user_id,inv.community_id))refreshUser(u.user_id);refreshUser(userId);return {pending:true,community_id:inv.community_id};
    }
    transaction(()=>{
      if(!inv.group_id)run("INSERT OR IGNORE INTO community_members VALUES (?,?,'member')",inv.community_id,userId);
      else{run('INSERT OR IGNORE INTO group_members(group_id,user_id) VALUES (?,?)',inv.group_id,userId);joinParent(userId,group(inv.group_id));run("UPDATE nest_invitations SET status='accepted' WHERE group_id=? AND recipient_id=? AND status='pending'",inv.group_id,userId);}
      run('UPDATE users SET last_community_id=? WHERE id=?',inv.community_id,userId);
    });refresh(inv.community_id);return {community_id:inv.community_id,group_id:inv.group_id};
  }
  app.post('/api/invitations',limited,async(req,res)=>{
    const {community_id:cid,group_id:gid}=req.body;membership(req.user.id,cid);
    if(gid){const g=group(gid);if(g.community_id!==cid || !groupAdmin(req.user.id,g))fail(403,'Only Nest admins can invite people into this Nest.');}
    const requiresApproval=!gid&&!treeReviewer(req.user.id,cid);
    const value=token(),expires=Date.now()+7*86400000,alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code;
    do{code=Array.from(randomBytes(10),byte=>alphabet[byte%alphabet.length]).join('');}while(one('SELECT 1 FROM invitation_codes WHERE code_hash=?',hash(code)));
    const path=`/?invite=${value}`,url=new URL(path,appUrl).href;
    // Render before writing, so an image failure cannot leave a half-created share.
    const qr=await QRCode.toDataURL(url,{width:300,margin:4,errorCorrectionLevel:'M',color:{dark:'#304a32',light:'#ffffff'}});
    // Re-check authorization after the asynchronous QR generation.
    if(!validSender({group_id:gid,community_id:cid,created_by:req.user.id,requires_approval:requiresApproval}))fail(403,'Your invitation permissions changed. Reload and try again.');
    transaction(()=>{run('INSERT INTO invitations(token_hash,community_id,group_id,created_by,expires_at,requires_approval) VALUES (?,?,?,?,?,?)',hash(value),cid,gid || null,req.user.id,expires,Number(requiresApproval));run('INSERT INTO invitation_codes VALUES (?,?)',hash(code),hash(value));});
    res.status(201).json({path,url,code:`${code.slice(0,5)}-${code.slice(5)}`,qr_data_url:qr,expires_at:expires,requires_approval:requiresApproval});
  });
  app.post('/api/invitations/accept',accepting,(req,res)=>{
    if(typeof req.body.token!=='string' || req.body.token.length>2048)fail(400,'Enter an invitation link or code.');
    let value=req.body.token.trim();try{value=new URL(value).searchParams.get('invite') || value;}catch{}
    const normalized=value.replace(/[\s-]/g,'').toUpperCase();
    const inv=/^[A-HJ-NP-Z2-9]{10}$/.test(normalized)?one('SELECT i.* FROM invitations i JOIN invitation_codes c ON c.token_hash=i.token_hash WHERE c.code_hash=?',hash(normalized)):one('SELECT * FROM invitations WHERE token_hash=?',hash(value));
    res.json(join(req.user.id,fresh(inv)));
  });
  app.get('/api/groups/:id/invitations/members',(req,res)=>{
    const g=group(req.params.id);if(!groupAdmin(req.user.id,g))fail(403,'Only Nest admins can invite Tree members.');
    const members=all(`SELECT u.id,u.name,u.username,u.avatar_id,u.avatar_choice,u.avatar_style,
      EXISTS(SELECT 1 FROM nest_invitations ni WHERE ni.group_id=? AND ni.recipient_id=u.id AND ni.status='pending' AND ni.expires_at>?) AS pending
      FROM users u JOIN community_members cm ON cm.user_id=u.id WHERE cm.community_id=?
      AND NOT EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=? AND gm.user_id=u.id) ORDER BY u.name COLLATE NOCASE,u.id`,g.id,Date.now(),g.community_id,g.id);
    res.json({members:members.map(m=>({...m,pending:!!m.pending && validSender(one('SELECT ni.*,? AS community_id FROM nest_invitations ni WHERE group_id=? AND recipient_id=?',g.community_id,g.id,m.id))}))});
  });
  app.post('/api/groups/:id/invitations',limited,(req,res)=>{
    const g=group(req.params.id);if(!groupAdmin(req.user.id,g))fail(403,'Only Nest admins can invite Tree members.');
    const ids=req.body.user_ids;if(!Array.isArray(ids) || !ids.length || ids.length>100 || ids.some(id=>typeof id!=='string') || new Set(ids).size!==ids.length)fail(400,'Choose between 1 and 100 Tree members.');
    for(const id of ids){if(!one('SELECT 1 FROM community_members WHERE community_id=? AND user_id=?',g.community_id,id))fail(400,'Choose existing members of this Tree.');if(one('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?',g.id,id))fail(409,'Someone selected has already joined. Refresh the member list.');}
    const now=Date.now(),expires=now+7*86400000;
    transaction(()=>{for(const id of ids)run(`INSERT INTO nest_invitations(id,group_id,recipient_id,created_by,expires_at,created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(group_id,recipient_id) DO UPDATE SET created_by=excluded.created_by,expires_at=excluded.expires_at,created_at=excluded.created_at,status='pending'`,randomUUID(),g.id,id,req.user.id,expires,now);});
    for(const id of ids)refreshUser(id);res.status(201).json({ok:true,count:ids.length});
  });
  app.get('/api/invitations',(req,res)=>{
    const invitations=all(`SELECT ni.*,g.community_id,g.name AS nest_name,g.avatar_id,c.name AS tree_name,u.name AS sender_name
      FROM nest_invitations ni JOIN groups g ON g.id=ni.group_id JOIN communities c ON c.id=g.community_id JOIN users u ON u.id=ni.created_by
      JOIN community_members cm ON cm.community_id=g.community_id AND cm.user_id=ni.recipient_id
      WHERE ni.recipient_id=? AND ni.status='pending' AND ni.expires_at>? AND NOT EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=ni.group_id AND gm.user_id=ni.recipient_id)
      ORDER BY ni.created_at DESC,ni.id`,req.user.id,Date.now()).filter(validSender).map(({recipient_id,created_by,status,...inv})=>inv);
    const join_request_count=all("SELECT * FROM tree_join_requests WHERE status='pending'").filter(r=>r.user_id===req.user.id||treeReviewer(req.user.id,r.community_id)).length;res.json({invitations,join_request_count});
  });
  app.get('/api/tree-join-requests',(req,res)=>{
    const requests=all(`SELECT r.*,u.name AS requester_name,c.name AS tree_name,inviter.name AS inviter_name FROM tree_join_requests r JOIN users u ON u.id=r.user_id JOIN users inviter ON inviter.id=r.invited_by JOIN communities c ON c.id=r.community_id WHERE r.status='pending' OR r.user_id=? ORDER BY r.created_at`,req.user.id).filter(r=>r.user_id===req.user.id||treeReviewer(req.user.id,r.community_id)).map(r=>({...r,can_review:!!treeReviewer(req.user.id,r.community_id)}));res.json({requests});
  });
  app.post('/api/tree-join-requests/:id/review',limited,(req,res)=>{
    const r=one('SELECT * FROM tree_join_requests WHERE id=?',req.params.id);if(!r||!treeReviewer(req.user.id,r.community_id))fail(403,'A Tree or Branch admin must review this request.');
    if(!['approve','decline'].includes(req.body.decision))fail(400,'Choose approve or decline.');if(r.status!=='pending')fail(409,'This request has already been reviewed.');
    transaction(()=>{if(req.body.decision==='approve'){run("INSERT OR IGNORE INTO community_members VALUES (?,?,'member')",r.community_id,r.user_id);run('UPDATE users SET last_community_id=? WHERE id=?',r.community_id,r.user_id);}run('UPDATE tree_join_requests SET status=?,reviewed_by=? WHERE id=?',req.body.decision==='approve'?'approved':'declined',req.user.id,r.id);});refresh(r.community_id);refreshUser(r.user_id);res.json({ok:true});
  });
  function owned(req){return one('SELECT ni.*,g.community_id FROM nest_invitations ni JOIN groups g ON g.id=ni.group_id WHERE ni.id=? AND ni.recipient_id=?',req.params.id,req.user.id) || fail(404,'Invitation not found.');}
  app.post('/api/invitations/:id/accept',accepting,(req,res)=>{
    const inv=fresh(owned(req));if(inv.status!=='pending')fail(410,'This invitation has already been answered.');res.json(join(req.user.id,inv));
  });
  app.post('/api/invitations/:id/decline',accepting,(req,res)=>{
    const inv=owned(req);if(inv.status!=='pending')fail(410,'This invitation has already been answered.');run("UPDATE nest_invitations SET status='declined' WHERE id=?",inv.id);refreshUser(req.user.id);res.json({ok:true});
  });
}
