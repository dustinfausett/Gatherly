export function nestRecipientIds(db,groupAdmin,uid,cid,nid){
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 const g=db.prepare('SELECT * FROM groups WHERE id=? AND community_id=?').get(nid,cid);
 if(!g||!db.prepare('SELECT 1 FROM community_members WHERE user_id=? AND community_id=?').get(uid,cid)||(!groupAdmin(uid,g)&&!db.prepare('SELECT 1 FROM group_members WHERE user_id=? AND group_id=?').get(uid,nid)))fail(403,'Choose a Nest you belong to in this Tree.');
 return db.prepare('SELECT gm.user_id FROM group_members gm JOIN community_members cm ON cm.user_id=gm.user_id AND cm.community_id=? WHERE gm.group_id=?').all(cid,nid).map(r=>r.user_id);
}
export function installRecipientScopes({app,db,groupAdmin,membership}){
 app.get('/api/contacts/recipient-scopes',(req,res)=>{
  const cid=req.query.tree_id;if(typeof cid!=='string'||!cid)return res.status(400).json({error:'Choose a Tree.'});membership(req.user.id,cid);
  const nests=db.prepare('SELECT * FROM groups WHERE community_id=? ORDER BY name COLLATE NOCASE,id').all(cid).filter(g=>groupAdmin(req.user.id,g)||db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(g.id,req.user.id)).map(g=>({id:g.id,name:g.name,member_ids:nestRecipientIds(db,groupAdmin,req.user.id,cid,g.id)}));
  res.json({nests});
 });
}
