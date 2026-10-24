import { rateLimit } from 'express-rate-limit';
import { assignmentProof, assignmentSetup, isId, operationMetadata, parseAssignmentOperation, parseAssignments } from '../shared/assignments.js';
import { digest, verify } from '../shared/encryption.js';

export function installAssignments({ app, db, encryption, encryptionRequired, visibleCircle, joined, groupAdmin, transaction, refresh, testing }) {
  const one = (s,...a) => db.prepare(s).get(...a), all = (s,...a) => db.prepare(s).all(...a), run = (s,...a) => db.prepare(s).run(...a);
  const fail = (status,message) => { throw Object.assign(new Error(message),{status}); };
  function parsed(fn) { try { return fn(); } catch (e) { fail(400,e.message); } }
  const messageSelect = `SELECT m.*,u.name,COALESCE(kh.public_key,ei.public_key) AS signer_key,COALESCE(m.signer_fingerprint,ei.fingerprint) AS signer_fingerprint FROM messages m JOIN users u ON u.id=m.user_id LEFT JOIN e2ee_identities ei ON ei.user_id=m.encrypted_by LEFT JOIN e2ee_key_history kh ON kh.user_id=m.encrypted_by AND kh.fingerprint=m.signer_fingerprint`;
  const message = id => { const m = one(messageSelect+' WHERE m.id=?',id); return m && { ...m,files:[] }; };
  function access(req) {
    const root = message(req.params.id);
    if (!root || root.deleted || root.message_kind !== 'assignments') fail(404,'Assignment list not found.');
    const state = one('SELECT * FROM assignment_lists WHERE message_id=?',root.id) || fail(404,'Assignment list not found.');
    const g = visibleCircle(req.user.id,root.group_id);
    if (!joined(req.user.id,g.id)) fail(403,'Join this Nest to open its assignments.');
    if (encryptionRequired && !encryption.canRead(req.user.id,root)) fail(404,'This assignment list is not available to this membership.');
    return { root,state,g,canManage:root.user_id === req.user.id || !!groupAdmin(req.user.id,g) };
  }
  function eligible(gid,listId=null) {
    return all(`SELECT u.id,u.name FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=? ${encryptionRequired && listId ? 'AND gm.joined_after<? AND EXISTS(SELECT 1 FROM e2ee_recipients er WHERE er.message_id=? AND er.user_id=u.id)' : ''} ORDER BY u.name,u.id`,gid,...(encryptionRequired && listId ? [listId,listId] : []));
  }
  function assignee(id,members) { if (id!==null && !members.some(m=>m.id===id)) fail(400,'Choose a member who can access this list.'); }
  async function proof(req,kind,listId,metadata) {
    if (!encryptionRequired) return;
    try { await verify(encryption.identity(req.user.id).public_key,kind,assignmentProof({listId,clientId:req.body.clientId,cipherHash:await digest(req.body.ciphertext),metadata}),req.body.assignmentSignature); }
    catch { fail(403,'The assignment update signature could not be verified.'); }
  }
  app.get('/api/groups/:id/assignment-members',(req,res)=>{
    const g=visibleCircle(req.user.id,req.params.id);
    if(!joined(req.user.id,g.id) || (g.admin_only && !groupAdmin(req.user.id,g)))fail(403,'Posting permissions are required to create a list.');
    res.json({members:eligible(g.id)});
  });
  app.get('/api/messages/:id/assignments/roster',(req,res)=>{const {root}=access(req);encryption.device(req);res.json(encryption.editRoster(req,root));});
  app.get('/api/messages/:id/assignments',(req,res)=>{
    const {root,state,g,canManage}=access(req), items=all('SELECT id,assignee_id,completed,deleted FROM assignment_items WHERE list_id=? ORDER BY id',root.id);
    res.json({message:root,settings_message:message(state.settings_message_id),settings_metadata:one('SELECT metadata FROM assignment_operations WHERE message_id=?',state.settings_message_id)?.metadata || null,revision:state.revision,allow_member_adds:!!state.allow_member_adds,can_manage:canManage,eligible:eligible(g.id,root.id),items});
  });
  app.get('/api/messages/:id/assignments/operations',(req,res)=>{
    const {root,state}=access(req),after=Number(req.query.after || 0),version=Number(req.query.version);
    if(!Number.isSafeInteger(after) || after<0 || !Number.isSafeInteger(version) || version<0 || version>state.revision)fail(400,'Choose a valid assignment update cursor.');
    const rows=all('SELECT message_id,revision,metadata FROM assignment_operations WHERE list_id=? AND revision>? AND revision<=? ORDER BY revision LIMIT 100',root.id,after,version);
    const operations=rows.map(row=>{const m=message(row.message_id);if(encryptionRequired && !encryption.canRead(req.user.id,m))fail(409,'Some assignment updates are not available to this membership.');return {...row,metadata:JSON.parse(row.metadata),message:m};});
    res.json({operations,has_more:operations.at(-1)?.revision<version});
  });
  function authorize(req,context,op) {
    const {root,state,g,canManage}=context;
    if(op.expectedVersion!==state.revision)fail(409,'This list changed. Review the latest assignments and try again.');
    const members=eligible(g.id,root.id);
    if(op.action==='settings'){if(!canManage)fail(403,'Only the creator or a Nest admin can change list settings.');return;}
    if(op.action==='add'){
      if(!canManage && !state.allow_member_adds)fail(403,'The creator has turned off member additions.');
      if(one('SELECT COUNT(*) AS n FROM assignment_items WHERE list_id=? AND deleted=0',root.id).n>=100)fail(400,'A list can contain up to 100 active assignments.');
      if(one('SELECT 1 FROM assignment_items WHERE id=?',op.itemId))fail(409,'That assignment ID is already in use.');
      assignee(op.assigneeId,members);
      if(!canManage && op.assigneeId!==null && op.assigneeId!==req.user.id)fail(403,'Add an open assignment or assign it to yourself.');
      return;
    }
    const item=one('SELECT * FROM assignment_items WHERE id=? AND list_id=? AND deleted=0',op.itemId,root.id) || fail(404,'Assignment not found.');
    if(['edit','remove'].includes(op.action)){
      if(!canManage)fail(403,'Only the creator or a Nest admin can edit or remove assignments.');
      if(op.action==='edit')assignee(op.assigneeId,members);
    }
    if(op.action==='claim' && (item.assignee_id!==null || item.completed || op.assigneeId!==req.user.id))fail(409,'This assignment is no longer open to claim.');
    if(op.action==='release' && (item.assignee_id!==req.user.id || item.completed))fail(403,'You can release your own unfinished assignment.');
    if(op.action==='complete' && !canManage && item.assignee_id!==req.user.id)fail(403,'You can only complete or reopen your own assignments.');
  }
  app.post('/api/messages/:id/assignments/operations',rateLimit({windowMs:60000,limit:testing?1000:60,keyGenerator:req=>req.user.id,message:{error:'Please wait before updating assignments again.'}}),async(req,res)=>{
    const context=access(req),{root,g}=context,op=parsed(()=>operationMetadata(req.body.operation));
    if(req.body.reply_to!==root.id || req.body.files?.length || req.body.urgent)fail(400,'Send an assignment update without attachments or urgency.');
    if(encryptionRequired && req.body.body!==undefined)fail(400,'Assignment contents must be encrypted on your device.');
    if(encryptionRequired && typeof req.body.clientId==='string'){
      const existing=one('SELECT * FROM messages WHERE client_id=?',req.body.clientId),record=existing && one('SELECT * FROM assignment_operations WHERE message_id=?',existing.id);
      if(existing){if(existing.user_id!==req.user.id || existing.reply_to!==root.id || existing.message_kind!=='assignment_op' || existing.ciphertext!==req.body.ciphertext || record?.metadata!==JSON.stringify(op))fail(409,'That assignment update ID is already in use.');return res.status(201).json({id:existing.id});}
    }
    authorize(req,context,op);
    const checked=encryptionRequired ? await encryption.validateSend(req,g.id,null,root) : null;
    await proof(req,'assignment-operation',root.id,op);
    const body=encryptionRequired?'':req.body.body;
    if(!encryptionRequired && !parseAssignmentOperation(body,root.id,op))fail(400,'Add a valid assignment update.');
    let id;
    transaction(()=>{
      authorize(req,access(req),op);
      if(checked)encryption.assertEditRoster(req,root,checked.rosterHash);
      id=Number(run(`INSERT INTO messages(group_id,user_id,body,reply_to,message_kind,ciphertext,client_id,encrypted_by,e2ee_version,recipient_hash,signer_fingerprint,self_encrypted) VALUES (?,?,?,?,'assignment_op',?,?,?,?,?,?,?)`,g.id,req.user.id,body,root.id,checked?.ciphertext??null,checked?.clientId??null,checked?req.user.id:null,checked?1:0,checked?.rosterHash??null,checked?encryption.identity(req.user.id).fingerprint:null,checked?.rs.self_encrypted?1:0).lastInsertRowid);
      if(checked)encryption.recordRecipients(id,checked.rs);
      if(op.action==='settings')run('UPDATE assignment_lists SET allow_member_adds=?,settings_message_id=? WHERE message_id=?',Number(op.allowMemberAdds),id,root.id);
      if(op.action==='add')run('INSERT INTO assignment_items(id,list_id,assignee_id) VALUES (?,?,?)',op.itemId,root.id,op.assigneeId);
      if(['edit','claim'].includes(op.action))run('UPDATE assignment_items SET assignee_id=? WHERE id=?',op.assigneeId,op.itemId);
      if(op.action==='release')run('UPDATE assignment_items SET assignee_id=NULL WHERE id=?',op.itemId);
      if(op.action==='complete')run('UPDATE assignment_items SET completed=? WHERE id=?',Number(op.completed),op.itemId);
      if(op.action==='remove')run('UPDATE assignment_items SET deleted=1 WHERE id=?',op.itemId);
      run('INSERT INTO assignment_operations VALUES (?,?,?,?)',id,root.id,op.expectedVersion+1,JSON.stringify(op));
      run('UPDATE assignment_lists SET revision=revision+1 WHERE message_id=?',root.id);
    });
    refresh(g.community_id);res.status(201).json({id});
  });
  return {
    async prepare(req,gid){
      const raw=req.body.assignment_setup;
      if(!raw || typeof raw.allowMemberAdds!=='boolean' || !Array.isArray(raw.items) || raw.items.length<1 || raw.items.length>20 || raw.items.some(i=>!isId(i?.id) || (i.assigneeId!==null && !isId(i.assigneeId))) || new Set(raw.items.map(i=>i.id)).size!==raw.items.length)fail(400,'Start with 1–20 valid assignments.');
      const setup={allowMemberAdds:raw.allowMemberAdds,items:raw.items.map(({id,assigneeId})=>({id,assigneeId}))};
      if(setup.items.some(i=>one('SELECT 1 FROM assignment_items WHERE id=?',i.id)))fail(409,'An assignment ID is already in use.');
      const members=eligible(gid);for(const item of setup.items)assignee(item.assigneeId,members);
      if(!encryptionRequired){const list=parseAssignments(req.body.body);if(!list || JSON.stringify(assignmentSetup(list))!==JSON.stringify(setup))fail(400,'Add a valid assignment list.');}
      await proof(req,'assignment-setup',null,setup);return setup;
    },
    create(id,setup){if(setup.items.some(i=>one('SELECT 1 FROM assignment_items WHERE id=?',i.id)))fail(409,'An assignment ID is already in use.');run('INSERT INTO assignment_lists(message_id,allow_member_adds,settings_message_id) VALUES (?,?,?)',id,Number(setup.allowMemberAdds),id);for(const item of setup.items)run('INSERT INTO assignment_items(id,list_id,assignee_id) VALUES (?,?,?)',item.id,id,item.assigneeId);},
  };
}
