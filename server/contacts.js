import { randomUUID } from 'node:crypto';
import { normalizePhone } from '../shared/contacts.js';
import { rateLimit } from 'express-rate-limit';
export function installContacts({app,db,transaction,refreshUser,family,testing}){
 const one=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 const limited=rateLimit({windowMs:60000,limit:testing?1000:60,keyGenerator:req=>req.user.id,message:{error:'Please wait before updating more contacts.'}});
 const label=v=>{if(typeof v!=='string' || !v.trim() || v.trim().length>100)fail(400,'Enter a name up to 100 characters.');return v.trim();};
 const contact=(id,uid)=>one('SELECT * FROM personal_contacts WHERE id=? AND owner_id=?',id,uid)||fail(404,'Contact not found.');
 const house=(id,uid)=>one('SELECT * FROM birdhouses WHERE id=? AND owner_id=?',id,uid)||fail(404,'Birdhouse not found.');
 const shared=(a,b)=>one('SELECT 1 FROM community_members a JOIN community_members b ON a.community_id=b.community_id WHERE a.user_id=? AND b.user_id=?',a,b);
 function values(body,user,allowedLinked=null){let phone;try{phone=normalizePhone(body.phone,body.country || 'US');}catch(e){fail(400,e.message);}const linked=body.linked_user_id || null;if(linked && (linked===user || (linked!==allowedLinked && !shared(user,linked))))fail(400,'Choose a person from a shared Tree.');if(linked&&!family.pairAllowed(user,linked))fail(403,'Parent approval is required before linking this Churp contact.');if(!phone&&!linked)fail(400,'Add a phone number or choose a Churp member.');return {name:label(body.name),phone,linked};}
 function destination(body,uid){
  if(body.birdhouse_id&&body.new_birdhouse_name)fail(400,'Choose an existing Birdhouse or create a new one.');
  if(body.birdhouse_id)return house(body.birdhouse_id,uid).id;
  if(body.new_birdhouse_name){const id=randomUUID();run('INSERT INTO birdhouses VALUES (?,?,?)',id,uid,label(body.new_birdhouse_name));return id;}return null;
 }
 const assign=(hid,id)=>{if(hid)run('INSERT OR IGNORE INTO birdhouse_contacts VALUES (?,?)',hid,id);};
 app.get('/api/contacts',(req,res)=>res.json({contacts:all('SELECT * FROM personal_contacts WHERE owner_id=? ORDER BY name COLLATE NOCASE,id',req.user.id),birdhouses:all(`SELECT b.*,COUNT(bc.contact_id) AS contact_count FROM birdhouses b LEFT JOIN birdhouse_contacts bc ON bc.birdhouse_id=b.id WHERE b.owner_id=? GROUP BY b.id ORDER BY b.name COLLATE NOCASE`,req.user.id),memberships:all('SELECT bc.* FROM birdhouse_contacts bc JOIN birdhouses b ON b.id=bc.birdhouse_id WHERE b.owner_id=?',req.user.id)}));
 app.post('/api/contacts',limited,(req,res)=>{const v=values(req.body,req.user.id);let id,duplicate=false;transaction(()=>{const hid=destination(req.body,req.user.id),existing=one('SELECT * FROM personal_contacts WHERE owner_id=? AND ((phone IS NOT NULL AND phone=?) OR (linked_user_id IS NOT NULL AND linked_user_id=?))',req.user.id,v.phone,v.linked);id=existing?.id||randomUUID();duplicate=!!existing;if(!existing)run('INSERT INTO personal_contacts VALUES (?,?,?,?,?,?)',id,req.user.id,v.name,v.phone,v.linked,Date.now());assign(hid,id);});refreshUser(req.user.id);res.status(duplicate?200:201).json({contact:contact(id,req.user.id),...(duplicate?{duplicate:true}:{})});});
 app.patch('/api/contacts/:id',limited,(req,res)=>{const old=contact(req.params.id,req.user.id);const v=values({...old,...req.body},req.user.id,old.linked_user_id);if(one('SELECT 1 FROM personal_contacts WHERE owner_id=? AND id<>? AND ((phone IS NOT NULL AND phone=?) OR (linked_user_id IS NOT NULL AND linked_user_id=?))',req.user.id,old.id,v.phone,v.linked))fail(409,'That number or Churp member is already saved.');run('UPDATE personal_contacts SET name=?,phone=?,linked_user_id=? WHERE id=?',v.name,v.phone,v.linked,old.id);refreshUser(req.user.id);res.json({contact:contact(old.id,req.user.id)});});
 app.delete('/api/contacts/:id',limited,(req,res)=>{contact(req.params.id,req.user.id);run('DELETE FROM personal_contacts WHERE id=?',req.params.id);refreshUser(req.user.id);res.json({ok:true});});
 app.post('/api/contacts/import',limited,(req,res)=>{const rows=req.body.contacts;if(!Array.isArray(rows)||!rows.length||rows.length>1000)fail(400,'Select between 1 and 1,000 contacts.');const prepared=rows.map(r=>values({...r,country:req.body.country || r.country},req.user.id));let added=0,duplicates=0;transaction(()=>{const hid=destination(req.body,req.user.id);for(const v of prepared){const old=one('SELECT id FROM personal_contacts WHERE owner_id=? AND ((phone IS NOT NULL AND phone=?) OR (linked_user_id IS NOT NULL AND linked_user_id=?))',req.user.id,v.phone,v.linked);if(old){duplicates++;assign(hid,old.id);continue;}const id=randomUUID();run('INSERT INTO personal_contacts VALUES (?,?,?,?,?,?)',id,req.user.id,v.name,v.phone,v.linked,Date.now());assign(hid,id);added++;}});refreshUser(req.user.id);res.json({added,duplicates});});
 app.post('/api/contacts/from-tree',limited,(req,res)=>{
  const ids=req.body.user_ids;
  if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||id.length>100)||new Set(ids).size!==ids.length)fail(400,'Choose between 1 and 1,000 different Tree members.');
  let added=0,duplicates=0,assigned=0;
  transaction(()=>{
   // Resolve names and eligibility here; the browser supplies only selected IDs.
   // Validate the whole batch before creating a Birdhouse or saving any contact.
   const prepared=ids.map(id=>{const person=one('SELECT name FROM users WHERE id=?',id);if(!person)fail(400,'Choose current members of your Trees.');return values({name:person.name,linked_user_id:id},req.user.id);});
   const hid=destination(req.body,req.user.id);
   for(const v of prepared){
    const old=one('SELECT id FROM personal_contacts WHERE owner_id=? AND linked_user_id=?',req.user.id,v.linked),id=old?.id||randomUUID();
    if(old)duplicates++;else{run('INSERT INTO personal_contacts VALUES (?,?,?,?,?,?)',id,req.user.id,v.name,null,v.linked,Date.now());added++;}
    if(hid)assigned+=Number(run('INSERT OR IGNORE INTO birdhouse_contacts VALUES (?,?)',hid,id).changes);
   }
  });
  refreshUser(req.user.id);res.status(added?201:200).json({added,duplicates,assigned});
 });
 app.delete('/api/contacts',limited,(req,res)=>{if(req.body.confirm!==true)fail(400,'Confirm removal of your saved contacts.');run('DELETE FROM personal_contacts WHERE owner_id=?',req.user.id);refreshUser(req.user.id);res.json({ok:true});});
 app.post('/api/birdhouses',limited,(req,res)=>{const id=randomUUID();run('INSERT INTO birdhouses VALUES (?,?,?)',id,req.user.id,label(req.body.name));refreshUser(req.user.id);res.status(201).json({birdhouse:house(id,req.user.id)});});
 app.patch('/api/birdhouses/:id',limited,(req,res)=>{house(req.params.id,req.user.id);run('UPDATE birdhouses SET name=? WHERE id=?',label(req.body.name),req.params.id);refreshUser(req.user.id);res.json({ok:true});});
 app.delete('/api/birdhouses/:id',limited,(req,res)=>{house(req.params.id,req.user.id);run('DELETE FROM birdhouses WHERE id=?',req.params.id);refreshUser(req.user.id);res.json({ok:true});});
 app.put('/api/birdhouses/:id/contacts',limited,(req,res)=>{house(req.params.id,req.user.id);const ids=req.body.contact_ids;if(!Array.isArray(ids)||ids.length>1000||new Set(ids).size!==ids.length)fail(400,'Choose your contacts.');ids.forEach(id=>contact(id,req.user.id));transaction(()=>{run('DELETE FROM birdhouse_contacts WHERE birdhouse_id=?',req.params.id);ids.forEach(id=>run('INSERT INTO birdhouse_contacts VALUES (?,?)',req.params.id,id));});refreshUser(req.user.id);res.json({ok:true});});
}
