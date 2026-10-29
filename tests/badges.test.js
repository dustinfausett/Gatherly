import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {runInNewContext} from 'node:vm';
import {PNG} from 'pngjs';
import {createApp} from '../server/app.js';
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'churp-badges-')),runtime=createApp({dataDir:dir,testing:true,encryptionRequired:false,pushEnabled:false,googleClientId:''}),server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 t.after(async()=>{runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 async function req(path,a,method='GET',body){const r=await fetch(base+path,{method,headers:{...(a?{cookie:a.cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,headers:r.headers,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r.data));return r.data;}
 async function actor(name,dob='1990-01-01'){const r=await req('/auth/register',null,'POST',{birth_date:dob,username:name,name,password:'Badge integration fixture!'});return {...r.data.user,cookie:r.cookie};}
 return {req,ok,actor};
}
test('badges count messages across joined Trees, respecting mute, read, membership, deletion and manual unread',async t=>{
 const f=await fixture(t),owner=await f.actor('owner'),bob=await f.actor('bob'),outsider=await f.actor('outsider');assert.equal((await f.req('/badges')).status,401);
 const a=(await f.ok('/communities',owner,'POST',{name:'First Tree'})).community,b=(await f.ok('/communities',owner,'POST',{name:'Second Tree'})).community;
 for(const c of [a,b]){const invite=await f.ok('/invitations',owner,'POST',{community_id:c.id});await f.ok('/invitations/accept',bob,'POST',{token:invite.code});}
 const nestA=(await f.ok(`/communities/${a.id}/circles`,owner,'POST',{name:'First Nest'})).group,nestB=(await f.ok(`/communities/${b.id}/circles`,owner,'POST',{name:'Second Nest'})).group;
 await f.ok(`/groups/${nestA.id}/messages`,owner,'POST',{body:'Earlier history does not count'});
 for(const n of [nestA,nestB])await f.ok(`/groups/${n.id}/join`,bob,'POST');
 const first=await f.ok(`/groups/${nestA.id}/messages`,owner,'POST',{body:'One'}),second=await f.ok(`/groups/${nestA.id}/messages`,owner,'POST',{body:'Two'}),third=await f.ok(`/groups/${nestB.id}/messages`,owner,'POST',{body:'Three'});
 let badge=await f.req('/badges',bob);assert.equal(badge.headers.get('cache-control'),'no-store');assert.deepEqual(badge.data,{count:3,nests:3,private:0,sms:0});assert.equal((await f.ok('/badges',owner)).count,0);assert.equal((await f.ok('/badges',outsider)).count,0);assert.equal((await f.ok(`/badges?user_id=${bob.id}`,outsider)).count,0);
 const prefs=(n,v)=>f.ok(`/groups/${n.id}/membership`,bob,'PATCH',v);
 await prefs(nestA,{muted:true});assert.equal((await f.ok('/badges',bob)).count,1);await prefs(nestA,{marked_unread:true});assert.equal((await f.ok('/badges',bob)).count,1);
 await prefs(nestA,{muted:false});assert.equal((await f.ok('/badges',bob)).count,3);await prefs(nestA,{read_to:second.id});assert.equal((await f.ok('/badges',bob)).count,1);await prefs(nestA,{marked_unread:true});assert.equal((await f.ok('/badges',bob)).count,2);
 await f.ok(`/groups/${nestA.id}/messages`,bob,'POST',{body:'My reply'});assert.equal((await f.ok('/badges',bob)).count,1);await f.ok(`/messages/${third.id}`,owner,'DELETE');assert.equal((await f.ok('/badges',bob)).count,0);
 await f.ok(`/groups/${nestB.id}/messages`,owner,'POST',{body:'Not a member anymore'});await f.ok(`/groups/${nestB.id}/join`,bob,'DELETE');assert.equal((await f.ok('/badges',bob)).count,0);assert.ok(first.id<second.id);
 const youth=await f.actor('youth','2011-01-01');assert.equal((await f.ok('/badges',youth)).count,0);
});
async function worker({visible=false,count=4,offline=false,status=200,fallback=9,unsupported=false,denied=false}={}){
 const handlers={},calls={set:[],clear:0,notifications:[]};let waited;
 const self={location:{origin:'https://app.churptree.com'},clients:{matchAll:async()=>visible?[{visibilityState:'visible',url:'https://app.churptree.com/'}]:[]},navigator:unsupported?{}:{setAppBadge:async n=>{if(denied)throw new Error('Denied');calls.set.push(n);},clearAppBadge:async()=>{calls.clear++;}},registration:{showNotification:async(...a)=>calls.notifications.push(a)},addEventListener:(name,fn)=>handlers[name]=fn};
 runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self,crypto:{randomUUID:()=> 'test-alert'},URL,AbortController,setTimeout,clearTimeout,fetch:async(path,options)=>{assert.equal(path,'/api/badges');assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');if(offline)throw new Error('Offline');return {ok:status===200,status,json:async()=>({count})};}});
 handlers.push({data:{json:()=>({title:'Churp',body:'A new message',unread_count:fallback})},waitUntil:p=>waited=p});await waited;return calls;
}
test('closed-app push badges use authoritative totals; offline uses payload, expired login clears, notifications remain visible',async()=>{
 let calls=await worker();assert.deepEqual(calls.set,[4]);assert.equal(calls.notifications.length,1);assert.equal(calls.notifications[0][1].icon,'/icons/churp-home-192.png');
 calls=await worker({offline:true});assert.deepEqual(calls.set,[9]);
 calls=await worker({status:401});assert.equal(calls.clear,1);assert.deepEqual(calls.set,[]);
 calls=await worker({count:0});assert.equal(calls.clear,1);
 for(const options of [{unsupported:true},{denied:true},{offline:true,fallback:-1}]){calls=await worker(options);assert.equal(calls.notifications.length,1);assert.deepEqual(calls.set,[]);}
});
test('visible Churp suppresses push alerts while keeping unread badges current',async()=>{
 const calls=await worker({visible:true});assert.equal(calls.notifications.length,0);assert.deepEqual(calls.set,[4]);
});
test('fresh Home Screen assets have real icon dimensions and opaque backgrounds; installed app identity is retained',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url)));assert.equal(manifest.id,'/');assert.equal(manifest.start_url,'/');
 for(const icon of manifest.icons){const png=PNG.sync.read(readFileSync(new URL('../public'+icon.src,import.meta.url)));assert.equal(`${png.width}x${png.height}`,icon.sizes);assert.ok(icon.src.includes('churp-home-'));for(let i=3;i<png.data.length;i+=4)assert.equal(png.data[i],255);}
 const apple=PNG.sync.read(readFileSync(new URL('../public/icons/churp-home-apple.png',import.meta.url)));assert.equal(apple.width,180);assert.match(readFileSync(new URL('../index.html',import.meta.url),'utf8'),/apple-touch-icon.*churp-home-apple.png/);
});
