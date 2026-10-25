import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createApp} from '../server/app.js';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';

async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'churp-invitations-'));let runtime,server,base;
 async function start(){runtime=createApp({dataDir:dir,testing:true,pushEnabled:false,googleClientId:'',appUrl:'https://app.churptree.com'});server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api`;}
 async function stop(){runtime.close();await new Promise(r=>server.close(r));}
 await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 async function req(path,actor,method='GET',body){const r=await fetch(base+path,{method,headers:{...(actor?{cookie:actor.cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r.data));return r.data;}
 async function actor(name){const r=await req('/auth/register',null,'POST',{username:name,name,password:'Invitation fixture password!'});return {...r.data.user,cookie:r.cookie};}
 const owner=await actor('owner'),member=await actor('member'),second=await actor('second'),outsider=await actor('outsider');
 const tree=(await ok('/communities',owner,'POST',{name:'Family Tree'})).community;
 const shared=await ok('/invitations',owner,'POST',{community_id:tree.id});for(const a of [member,second])await ok('/invitations/accept',a,'POST',{token:shared.code});
 const branch=(await ok(`/communities/${tree.id}/subcommunities`,owner,'POST',{name:'Parties'})).subcommunity;
 const nest=(await ok(`/communities/${tree.id}/circles`,owner,'POST',{name:'Secret birthday',private:true,subcommunity_id:branch.id})).group;
 return {get db(){return runtime.db;},restart:async()=>{await stop();await start();},req,ok,actor,owner,member,second,outsider,tree,branch,nest,shared};
}
test('Tree QR and short code resolve to the same expiring, authorized full invitation',async t=>{
 const f=await fixture(t),{owner,member,outsider,tree,shared}=f;
 assert.match(shared.code,/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);assert.ok(shared.url.startsWith('https://app.churptree.com/?invite='));
 const png=PNG.sync.read(Buffer.from(shared.qr_data_url.split(',')[1],'base64'));assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height).data,shared.url);
 const stored=f.db.prepare('SELECT * FROM invitation_codes').get();assert.notEqual(stored.code_hash,shared.code.replace('-',''));assert.equal(stored.code_hash.length,64);
 const short=shared.code.toLowerCase().replace('-',' ');assert.equal((await f.ok('/invitations/accept',outsider,'POST',{token:short})).community_id,tree.id);
 assert.equal((await f.req('/invitations',member,'POST',{community_id:tree.id})).status,403);
 assert.equal((await f.req('/invitations/accept',null,'POST',{token:shared.code})).status,401);
 assert.equal((await f.req('/invitations/accept',outsider,'POST',{token:'AAAAA-AAAAA'})).status,410);
 await f.restart();assert.equal((await f.ok('/invitations/accept',member,'POST',{token:shared.url})).community_id,tree.id);
 f.db.prepare('UPDATE invitations SET expires_at=0 WHERE token_hash=?').run(stored.token_hash);assert.equal((await f.req('/invitations/accept',outsider,'POST',{token:shared.code})).status,410);
 assert.equal((await f.req('/invitations/accept',outsider,'POST',{token:shared.path.split('invite=')[1]})).status,410);
});
test('Nest invitations are private, recipient-bound, opt-in and respect membership history',async t=>{
 const f=await fixture(t),{owner,member,second,outsider,tree,nest,branch}=f;
 assert.equal((await f.req(`/groups/${nest.id}/invitations/members`,member)).status,403);
 assert.equal((await f.req(`/groups/${nest.id}/invitations`,member,'POST',{user_ids:[second.id]})).status,403);
 assert.equal((await f.req(`/groups/${nest.id}/invitations`,owner,'POST',{user_ids:[member.id,outsider.id]})).status,400);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM nest_invitations').get().n,0,'Invalid bulk request is atomic');
 assert.equal((await f.req(`/groups/${nest.id}/invitations`,owner,'POST',{user_ids:[member.id,member.id]})).status,400);
 await f.ok(`/groups/${nest.id}/invitations`,owner,'POST',{user_ids:[member.id,second.id]});
 const inbox=(await f.ok('/invitations',member)).invitations;assert.equal(inbox.length,1);assert.equal(inbox[0].nest_name,nest.name);assert.equal(inbox[0].tree_name,tree.name);assert.equal(inbox[0].sender_name,owner.name);
 assert.equal((await f.ok('/invitations',outsider)).invitations.length,0);
 assert.equal((await f.req(`/invitations/${inbox[0].id}/accept`,outsider,'POST')).status,404);
 assert.equal((await f.req(`/invitations/${inbox[0].id}/decline`,second,'POST')).status,404);
 assert.equal((await f.ok(`/communities/${tree.id}`,member)).community.circles.some(g=>g.id===nest.id),false,'Pending invite does not reveal private chat');
 const old=Number(f.db.prepare('INSERT INTO messages(group_id,user_id,body) VALUES (?,?,?)').run(nest.id,owner.id,'Earlier fixture message').lastInsertRowid);
 await f.restart();await f.ok(`/invitations/${inbox[0].id}/accept`,member,'POST');
 assert.equal(f.db.prepare('SELECT joined_after FROM group_members WHERE group_id=? AND user_id=?').get(nest.id,member.id).joined_after,old);
 assert.ok(f.db.prepare('SELECT 1 FROM collection_members WHERE subcommunity_id=? AND user_id=?').get(branch.id,member.id));
 assert.equal((await f.ok('/invitations',member)).invitations.length,0);assert.equal((await f.req(`/invitations/${inbox[0].id}/accept`,member,'POST')).status,410);
 const invite2=(await f.ok('/invitations',second)).invitations[0];await f.ok(`/invitations/${invite2.id}/decline`,second,'POST');assert.equal((await f.ok('/invitations',second)).invitations.length,0);assert.equal(f.db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(nest.id,second.id),undefined);
 await f.ok(`/groups/${nest.id}/invitations`,owner,'POST',{user_ids:[second.id]});assert.equal((await f.ok('/invitations',second)).invitations.length,1,'Admin can re-invite after a decline');
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('pending invitations revoke with permissions, member removal, expiry and Nest deletion',async t=>{
 const f=await fixture(t),{owner,member,second,tree,nest}=f;
 await f.ok(`/admins/group/${nest.id}/${second.id}`,owner,'PUT',{enabled:true});
 await f.ok(`/groups/${nest.id}/invitations`,second,'POST',{user_ids:[member.id]});const invitation=(await f.ok('/invitations',member)).invitations[0];
 await f.ok(`/admins/group/${nest.id}/${second.id}`,owner,'PUT',{enabled:false});assert.equal((await f.ok('/invitations',member)).invitations.length,0);assert.equal((await f.req(`/invitations/${invitation.id}/accept`,member,'POST')).status,410);
 assert.equal((await f.ok(`/groups/${nest.id}/invitations/members`,owner)).members.find(m=>m.id===member.id).pending,false);
 await f.ok(`/groups/${nest.id}/invitations`,owner,'POST',{user_ids:[member.id]});
 await f.ok(`/communities/${tree.id}/members/${member.id}`,owner,'DELETE');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM nest_invitations WHERE recipient_id=?').get(member.id).n,0);
 await f.ok('/invitations/accept',member,'POST',{token:f.shared.code});assert.equal((await f.ok('/invitations',member)).invitations.length,0);
 await f.ok(`/groups/${nest.id}/invitations`,owner,'POST',{user_ids:[member.id]});const renewed=(await f.ok('/invitations',member)).invitations[0];f.db.prepare('UPDATE nest_invitations SET expires_at=0').run();assert.equal((await f.req(`/invitations/${renewed.id}/accept`,member,'POST')).status,410);
 await f.ok(`/groups/${nest.id}/invitations`,owner,'POST',{user_ids:[member.id]});await f.ok(`/groups/${nest.id}`,owner,'DELETE',{confirm_name:nest.name});assert.equal((await f.ok('/invitations',member)).invitations.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM nest_invitations').get().n,0);
});
