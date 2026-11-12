import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,unlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createApp} from '../server/app.js';
import {keyVault} from '../server/key-vault.js';
import {calendarIcs} from '../server/calendars.js';

test('calendar permissions, aggregation, encryption, filters, subscriptions and revocation',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'churp-calendar-')),runtime=createApp({dataDir:dir,testing:true,pushEnabled:false,googleClientId:''});
 const server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 async function req(path,a,method='GET',body){const r=await fetch(base+'/api'+path,{method,headers:{...(a?{cookie:a.cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r));return r.data;}
 async function actor(name){const r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,name,password:'Calendar fixture pass!',birth_date:'1990-01-01'})});return {...(await r.json()).user,cookie:r.headers.get('set-cookie').split(';')[0]};}
 const owner=await actor('calendarowner'),member=await actor('calendarmember'),outsider=await actor('calendaroutsider');
 const tree=(await ok('/communities',owner,'POST',{name:'Calendar Tree'})).community;
 // Membership fixtures keep encryption setup independent from calendar transport.
 runtime.db.prepare("INSERT INTO community_members(community_id,user_id,role) VALUES (?,?,'member')").run(tree.id,member.id);
 const branch=(await ok(`/communities/${tree.id}/subcommunities`,owner,'POST',{name:'Calendar Branch'})).subcommunity;
 const nest=(await ok(`/communities/${tree.id}/circles`,owner,'POST',{name:'Secret Nest',private:true,subcommunity_id:branch.id})).group;
 const other=(await ok(`/communities/${tree.id}/circles`,owner,'POST',{name:'Other Nest'})).group;
 const event={group_id:nest.id,title:'Secret meeting',description:'Details only here',location:'Garden',start:'2027-04-17T15:00:00Z',end:'2027-04-17T16:00:00Z',visibility:'private'};
 const privateId=(await ok('/calendar/events',owner,'POST',event)).id;
 const publicId=(await ok('/calendar/events',owner,'POST',{...event,title:'Tree gathering',visibility:'public'})).id;
 await ok('/calendar/events',owner,'POST',{...event,group_id:other.id,title:'Other branch event'});
 assert.equal((await req('/calendar/events',member,'POST',event)).status,404);
 assert.equal((await req(`/calendar/trees/${tree.id}`,outsider)).status,403);
 let view=await ok(`/calendar/trees/${tree.id}`,member);assert.deepEqual(view.events.map(e=>e.title),['Tree gathering']);assert.equal(view.nests.some(n=>n.id===nest.id),false);
 assert.equal((await ok(`/calendar/trees/${tree.id}`,owner)).events.length,3);
 const row=runtime.db.prepare('SELECT * FROM calendar_events WHERE id=?').get(privateId);assert.ok(!JSON.stringify(row).includes(event.title));assert.ok(!JSON.stringify(row).includes(event.location));
 await ok(`/calendar/trees/${tree.id}/filters`,member,'PUT',{branches:[branch.id],nests:[]});assert.deepEqual((await ok(`/calendar/trees/${tree.id}`,member)).filters,{branches:[branch.id],nests:[]});assert.equal((await ok(`/calendar/trees/${tree.id}`,owner)).filters,null);
 const sub=await ok(`/calendar/trees/${tree.id}/subscriptions`,member,'POST',{scope_type:'branch',scope_id:branch.id});const token=new URL(sub.url).pathname;
 async function feed(){const r=await fetch(base+token);return {status:r.status,text:await r.text()};}
 assert.equal((await feed()).status,200);assert.match((await feed()).text,/Tree gathering/);assert.doesNotMatch((await feed()).text,/Secret meeting|Other branch event/);
 assert.equal(runtime.db.prepare('SELECT token_hash FROM calendar_subscriptions WHERE id=?').get(sub.id).token_hash.includes(token.split('/').at(-1).slice(0,-4)),false);
 runtime.db.prepare('INSERT INTO group_members(group_id,user_id) VALUES (?,?)').run(nest.id,member.id);
 assert.match((await feed()).text,/Secret meeting/);
 assert.equal((await req(`/calendar/events/${privateId}`,member,'PATCH',event)).status,403);
 runtime.db.prepare('UPDATE groups SET admin_only=1 WHERE id=?').run(nest.id);
 assert.equal((await req('/calendar/events',member,'POST',event)).status,403);
 runtime.db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(nest.id,member.id);
 assert.doesNotMatch((await feed()).text,/Secret meeting/);
 await ok(`/calendar/events/${publicId}`,owner,'PATCH',{...event,title:'Now Nest only',visibility:'private'});assert.doesNotMatch((await feed()).text,/Tree gathering|Now Nest only/);
 await ok(`/calendar/subscriptions/${sub.id}`,member,'DELETE');assert.equal((await feed()).status,404);
 const sub2=await ok(`/calendar/trees/${tree.id}/subscriptions`,member,'POST',{scope_type:'tree',scope_id:tree.id});runtime.db.prepare('DELETE FROM community_members WHERE user_id=? AND community_id=?').run(member.id,tree.id);assert.equal((await fetch(base+new URL(sub2.url).pathname)).status,403);
 await ok(`/calendar/events/${privateId}`,owner,'DELETE');assert.equal(runtime.db.prepare('SELECT 1 FROM calendar_events WHERE id=?').get(privateId),undefined);
});
test('ICS escapes injection and folds unicode safely',()=>{
 const ics=calendarIcs([{id:'1',updated_at:'2027-01-01',start:'2027-01-01',end:'2027-01-02',title:'Hi\nBEGIN:VEVENT,;'+ '🦜'.repeat(60),description:'a\\b',location:'Park',visibility:'private'}],'Tree');
 assert.match(ics,/CLASS:PRIVATE/);assert.equal(ics.split('\r\n').filter(l=>l==='BEGIN:VEVENT').length,1);for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);assert.ok(!ics.includes('�'));
});

test('calendar-only storage refuses to replace a lost master key',()=>{
 const dir=mkdtempSync(join(tmpdir(),'churp-calendar-vault-'));
 try {
  const app=createApp({dataDir:dir,testing:true,encryptionRequired:false,pushEnabled:false,googleClientId:''});
  const db=app.db;
  db.prepare("INSERT INTO users(id,username,name) VALUES ('u','calendarvault','Calendar vault')").run();
  db.prepare("INSERT INTO communities(id,name,owner_id) VALUES ('t','Tree','u')").run();
  db.prepare("INSERT INTO groups(id,community_id,name) VALUES ('g','t','Nest')").run();
  db.prepare('INSERT INTO calendar_events VALUES (?,?,?,?,?,?)').run('e','g','u','private',keyVault(dir,false).seal('calendar','e','{}'),new Date().toISOString());
  app.close();unlinkSync(join(dir,'key-vault.key'));
  assert.throws(()=>createApp({dataDir:dir,testing:true,encryptionRequired:false,pushEnabled:false,googleClientId:''}),/master key/);
  assert.equal(existsSync(join(dir,'key-vault.key')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
