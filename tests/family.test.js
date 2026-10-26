import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
import {birthDate,ageAt} from '../shared/family.js';
import * as enc from '../shared/encryption.js';

async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'churp-family-'));let runtime,server,base;
 async function start(){runtime=createApp({dataDir:dir,testing:true,pushEnabled:false,googleClientId:''});server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api`;}
 async function stop(){runtime.close();await new Promise(r=>server.close(r));}await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 async function req(path,a,method='GET',body){const form=body instanceof FormData,r=await fetch(base+path,{method,headers:{...(a?{cookie:a.cookie,'x-churp-device':a.device}:{}),...(body&&!form?{'content-type':'application/json'}:{})},body:body?form?body:JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer()),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r.data));return r.data;}
 async function actor(name,dob='1990-01-01'){const r=await req('/auth/register',null,'POST',{birth_date:dob,username:name,name,password:'Family protection password!'});assert.equal(r.status,201);const a={...r.data.user,cookie:r.cookie,device:randomUUID()};const k=await ok('/e2ee/managed-device',a,'POST',{deviceId:a.device,deviceName:name});a.privateKey=await enc.readPrivate(k.privateKey);return a;}
 async function link(parent,child){const {code}=await ok('/family/codes',parent,'POST');await ok('/family/claim',child,'POST',{code});const l=(await ok('/family',parent)).links.find(l=>l.child_id===child.id&&l.status==='pending');await ok(`/family/links/${l.id}/confirm`,parent,'POST',{confirm_parent:true});return l;}
 async function prepare(a,cid,body,attachments=[],readers=null){const rs=await ok(`/private/conversations/${cid}/roster`,a),clientId=randomUUID(),files=attachments.map(f=>f.id);const ciphertext=await enc.seal(a.privateKey,(readers||rs.readers).map(r=>r.public_key),{version:1,kind:'private-message',conversationId:cid,clientId,senderId:a.id,rosterHash:rs.roster_hash,selfEncrypted:rs.self_encrypted,body,attachments});return {clientId,ciphertext,rosterHash:rs.roster_hash,files,signature:await enc.sign(a.privateKey,'private-send',{conversationId:cid,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files,sourceNest:null})};}
 async function migrate(child){let batch;while((batch=await ok('/family/history',child)).messages.length){for(const m of batch.messages)for(const pid of m.missing){const p=batch.parents.find(p=>p.id===pid),ciphertext=await enc.rewrap([child.privateKey],p.public_key,m.ciphertext),proof={messageId:m.id,parentId:pid,linkId:p.link_id,originalHash:await enc.digest(m.ciphertext),copyHash:await enc.digest(ciphertext)};await ok(`/family/history/${m.id}`,child,'POST',{parent_id:pid,link_id:p.link_id,ciphertext,signature:await enc.sign(child.privateKey,'guardian-history',proof)});}}}
 const owner=await actor('owner');const tree=(await ok('/communities',owner,'POST',{name:'Family Tree'})).community;const invite=await ok('/invitations',owner,'POST',{community_id:tree.id});
 const joinTree=async a=>ok('/invitations/accept',a,'POST',{token:invite.code});
 return {req,ok,actor,link,prepare,migrate,owner,tree,join:joinTree,restart:async()=>{await stop();await start();},get db(){return runtime.db;}};
}
test('birth dates are real private calendar dates and switch protection exactly at 18',()=>{
 const now=new Date('2026-10-26T12:00:00Z');assert.equal(ageAt('2008-10-26',now),18);assert.equal(ageAt('2008-10-27',now),17);assert.equal(ageAt(null,now),null);assert.equal(ageAt('2008-02-29',new Date('2026-02-28')),17);assert.equal(ageAt('2008-02-29',new Date('2026-03-01')),18);
 for(const bad of ['2026-02-30','2027-01-01','yesterday','1800-01-01','2026-1-1',null])assert.throws(()=>birthDate(bad,now));assert.equal(birthDate('2010-01-01',now),'2010-01-01');
});
test('age and confirmed parent setup cannot be skipped by existing accounts, Google-style accounts or API calls',async t=>{
 const f=await fixture(t),kid=await f.actor('kid','2012-01-01'),parent=await f.actor('parent');
 assert.equal((await f.req('/auth/register',null,'POST',{username:'missing',name:'Missing',password:'long enough password'})).status,400);
 for(const endpoint of ['/communities','/contacts','/private/people','/private/conversations','/groups/not-a-nest/e2ee/roster'])assert.equal((await f.req(endpoint,kid)).status,403);
 assert.equal((await f.req('/e2ee/uploads',kid,'POST',{})).status,403);assert.equal((await f.req('/family/codes',kid,'POST')).status,403);assert.equal((await f.req('/family/birth-date',kid,'POST',{birth_date:'1990-01-01'})).status,409);
 const {code}=await f.ok('/family/codes',parent,'POST');await f.ok('/family/claim',kid,'POST',{code});assert.equal((await f.req('/family/claim',kid,'POST',{code})).status,400);assert.equal((await f.req('/communities',kid)).status,403);
 const l=(await f.ok('/family',parent)).links[0];assert.equal((await f.req(`/family/links/${l.id}/confirm`,f.owner,'POST',{confirm_parent:true})).status,404);assert.equal((await f.req(`/family/links/${l.id}/confirm`,parent,'POST',{})).status,400);
 await f.ok(`/family/links/${l.id}/confirm`,parent,'POST',{confirm_parent:true});assert.equal((await f.ok('/me',kid)).user.family.needs_setup,false);
 assert.equal((await f.req(`/family/links/${l.id}`,kid,'DELETE')).status,403);
 await f.ok(`/family/links/${l.id}`,parent,'DELETE');assert.equal((await f.req('/communities',kid)).status,403);
 f.db.prepare('UPDATE users SET birth_date=NULL,google_id=? WHERE id=?').run('fixture-google-sub',parent.id);assert.equal((await f.ok('/me',parent)).user.family.needs_setup,true);assert.equal((await f.req('/contacts',parent)).status,403);
 await f.ok('/family/birth-date',parent,'POST',{birth_date:'1990-01-01'});assert.equal((await f.ok('/me',parent)).user.family.needs_setup,false);
});
test('adult contact requests require either linked parent, all youth DMs include guardian readers, guardians are read-only and Nests remain separate',async t=>{
 const f=await fixture(t),{owner}=f,kid=await f.actor('kid','2011-01-01'),parent=await f.actor('parent'),second=await f.actor('second'),stranger=await f.actor('stranger');
 await f.link(parent,kid);await f.link(second,kid);await f.join(kid);
 assert.equal((await f.req('/contacts',owner,'POST',{name:'Kid',linked_user_id:kid.id})).status,403);
 assert.equal((await f.req('/contacts/import',owner,'POST',{contacts:[{name:'Kid',linked_user_id:kid.id}]})).status,403);
 const result=await f.ok('/private/conversations',owner,'POST',{user_id:kid.id}),cid=result.conversation.id;assert.equal(result.approval_required,true);
 assert.equal((await f.req(`/private/conversations/${cid}/roster`,owner)).status,403);assert.equal((await f.req(`/private/conversations/${cid}/roster`,kid)).status,403);
 assert.equal((await f.ok('/family',parent)).approvals[0].adult_id,owner.id);
 assert.equal((await f.req('/family/approvals',owner,'POST',{child_id:kid.id,adult_id:owner.id,decision:'approved'})).status,403);
 await f.ok('/family/approvals',second,'POST',{child_id:kid.id,adult_id:owner.id,decision:'approved'});
 const rs=await f.ok(`/private/conversations/${cid}/roster`,owner);assert.deepEqual(rs.readers.map(r=>r.id).sort(),[owner.id,kid.id,parent.id,second.id].sort());
 assert.equal((await f.req(`/private/conversations/${cid}/messages`,owner,'POST',await f.prepare(owner,cid,'No missing parents',[],rs.readers.filter(r=>[owner.id,kid.id].includes(r.id))))).status,400);
 const raw=enc.bytes('Protected private attachment'),crypt=await enc.encryptFile(raw),form=new FormData();form.append('file',new Blob([crypt.encrypted]),'attachment.pgp');const file=(await f.ok('/e2ee/uploads',owner,'POST',form)).file,desc={id:file.id,name:'private.txt',mime:'application/octet-stream',size:raw.length,key:crypt.key,sha256:crypt.sha256};
 const sent=await f.ok(`/private/conversations/${cid}/messages`,owner,'POST',await f.prepare(owner,cid,'Supervised hello',[desc]));
 for(const p of [parent,second]){const rows=(await f.ok(`/private/conversations/${cid}/messages?child_id=${kid.id}`,p)).messages;assert.equal((await enc.open(p.privateKey,owner.privateKey.toPublic().armor(),rows[0].ciphertext)).body,'Supervised hello');assert.deepEqual(await enc.decryptFile((await f.req(`/files/${file.id}`,p)).data,desc),raw);assert.equal((await f.req(`/private/conversations/${cid}/read`,p,'POST',{through:sent.id})).status,404);assert.equal((await f.req(`/private/conversations/${cid}/block`,p,'PATCH',{blocked:true})).status,404);assert.equal((await f.req(`/private/conversations/${cid}/messages`,p,'POST',{})).status,404);}
 assert.equal((await f.req(`/private/conversations/${cid}/messages?child_id=${kid.id}`,stranger)).status,404);assert.equal((await f.req(`/files/${file.id}`,stranger)).status,404);assert.equal((await f.req(`/private/conversations/${cid}/roster?child_id=${kid.id}`,parent)).status,404);
 const nest=(await f.ok(`/communities/${f.tree.id}/circles`,owner,'POST',{name:'School Nest'})).group;await f.ok(`/groups/${nest.id}/join`,kid,'POST');assert.equal((await f.req(`/groups/${nest.id}/messages`,parent)).status,403);
 assert.equal((await f.ok(`/groups/${nest.id}/individual-recipients`,owner)).people.length,1);
 await f.ok('/family/approvals',parent,'POST',{child_id:kid.id,adult_id:owner.id,decision:'declined'});
 assert.equal((await f.ok(`/groups/${nest.id}/individual-recipients`,owner)).people.length,0);assert.equal((await f.req(`/private/conversations/${cid}/messages`,owner,'POST',{})).status,403);
 await f.restart();assert.equal((await f.ok('/family',second)).approvals[0].status,'declined');assert.equal((await f.ok(`/private/conversations/${cid}/messages?child_id=${kid.id}`,parent)).messages.length,1);
});
test('historical DMs retain original signatures when shared with parents; second parents trigger migration and removing links revokes access',async t=>{
 const f=await fixture(t),{owner}=f,child=await f.actor('legacy'),parent=await f.actor('parent'),second=await f.actor('second'),third=await f.actor('third');await f.join(child);
 const cid=(await f.ok('/private/conversations',owner,'POST',{user_id:child.id})).conversation.id;
 const plain=enc.bytes('An earlier private file'),encrypted=await enc.encryptFile(plain),form=new FormData();form.append('file',new Blob([encrypted.encrypted]),'attachment.pgp');const file=(await f.ok('/e2ee/uploads',owner,'POST',form)).file,attachment={id:file.id,name:'earlier.txt',mime:'application/octet-stream',size:plain.length,key:encrypted.key,sha256:encrypted.sha256};
 await f.ok(`/private/conversations/${cid}/messages`,owner,'POST',await f.prepare(owner,cid,'Before protected accounts',[attachment]));
 // Simulate an account created before age collection was introduced.
 f.db.prepare('UPDATE users SET birth_date=NULL WHERE id=?').run(child.id);await f.ok('/family/birth-date',child,'POST',{birth_date:'2010-01-01'});
 const first=await f.link(parent,child);assert.equal((await f.ok('/me',child)).user.family.history_remaining,1);assert.equal((await f.req('/communities',child)).status,403);
 const batch=await f.ok('/family/history',child),m=batch.messages[0],p=batch.parents[0],fake=await enc.seal(child.privateKey,[p.public_key],{fake:'different contents'});
 const badProof={messageId:m.id,parentId:parent.id,linkId:p.link_id,originalHash:await enc.digest(m.ciphertext),copyHash:await enc.digest(fake)};
 assert.equal((await f.req(`/family/history/${m.id}`,child,'POST',{parent_id:parent.id,link_id:p.link_id,ciphertext:fake,signature:await enc.sign(child.privateKey,'guardian-history',badProof)})).status,400);
 const originalKey=child.privateKey;child.privateKey=(await enc.generateIdentity(child.id)).privateKey;await assert.rejects(()=>f.migrate(child),/original encryption key/);assert.equal((await f.ok('/me',child)).user.family.needs_setup,true);child.privateKey=originalKey;
 await f.migrate(child);assert.equal((await f.ok('/me',child)).user.family.needs_setup,false);assert.deepEqual(await enc.decryptFile((await f.req(`/files/${file.id}`,parent)).data,attachment),plain);let rows=(await f.ok(`/private/conversations/${cid}/messages?child_id=${child.id}`,parent)).messages;assert.equal((await enc.open(parent.privateKey,owner.privateKey.toPublic().armor(),rows[0].ciphertext)).body,'Before protected accounts');assert.equal(await enc.encryptedContentsHash(rows[0].ciphertext),await enc.encryptedContentsHash(m.ciphertext));
 await f.link(second,child);assert.equal((await f.ok('/me',child)).user.family.history_remaining,1);await f.migrate(child);
 const {code}=await f.ok('/family/codes',third,'POST');assert.equal((await f.req('/family/claim',child,'POST',{code})).status,409);
 await f.ok(`/family/links/${first.id}`,parent,'DELETE');assert.equal((await f.req(`/files/${file.id}`,parent)).status,404);assert.equal((await f.req(`/private/conversations/${cid}/messages?child_id=${child.id}`,parent)).status,404);assert.equal((await f.req(`/family/children/${child.id}/conversations`,parent)).status,404);assert.equal((await f.ok('/me',child)).user.family.needs_setup,false);
 await f.restart();rows=(await f.ok(`/private/conversations/${cid}/messages?child_id=${child.id}`,second)).messages;assert.equal((await enc.open(second.privateKey,owner.privateKey.toPublic().armor(),rows[0].ciphertext)).body,'Before protected accounts');
 const now=new Date(),adultDate=`${now.getUTCFullYear()-18}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;f.db.prepare('UPDATE users SET birth_date=? WHERE id=?').run(adultDate,child.id);
 assert.equal((await f.ok('/me',child)).user.family.protected,false);assert.equal((await f.req(`/family/children/${child.id}/conversations`,second)).status,404);assert.equal((await f.req(`/private/conversations/${cid}/messages?child_id=${child.id}`,second)).status,404);assert.equal((await f.ok(`/private/conversations/${cid}/roster`,child)).readers.length,2);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('youth-to-youth chats include both families without adult-contact approval and stale audiences cannot omit a new parent',async t=>{
 const f=await fixture(t),a=await f.actor('youthone','2010-01-01'),b=await f.actor('youthtwo','2011-01-01'),pa=await f.actor('parentone'),pb=await f.actor('parenttwo'),pc=await f.actor('parentthree');await f.link(pa,a);await f.link(pb,b);await f.join(a);await f.join(b);
 const cid=(await f.ok('/private/conversations',a,'POST',{user_id:b.id})).conversation.id,draft=await f.prepare(a,cid,'A youth conversation');await f.link(pc,a);
 assert.equal((await f.req(`/private/conversations/${cid}/messages`,a,'POST',draft)).status,409);
 await f.ok(`/private/conversations/${cid}/messages`,a,'POST',await f.prepare(a,cid,'All linked parents included'));
 for(const [p,child] of [[pa,a],[pc,a],[pb,b]]){const rows=(await f.ok(`/private/conversations/${cid}/messages?child_id=${child.id}`,p)).messages;assert.equal((await enc.open(p.privateKey,a.privateKey.toPublic().armor(),rows[0].ciphertext)).body,'All linked parents included');}
 assert.equal((await f.ok('/family',pa)).approvals.length,0);
});

test('historical session-key wrapping uses archived identities and preserves the original signer',async()=>{
 const old=await enc.generateIdentity('youth'),current=await enc.generateIdentity('youth'),sender=await enc.generateIdentity('sender'),parent=await enc.generateIdentity('parent');
 const ciphertext=await enc.seal(sender.privateKey,[old.publicKey,sender.publicKey],{body:'Before key rotation'}),copy=await enc.rewrap([current.privateKey,old.privateKey],parent.publicKey,ciphertext);
 await enc.validateCiphertext(copy,[parent.publicKey]);assert.deepEqual(await enc.open(parent.privateKey,sender.publicKey,copy),{body:'Before key rotation'});assert.equal(await enc.encryptedContentsHash(copy),await enc.encryptedContentsHash(ciphertext));
});
