import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createApp} from '../server/app.js';
import {calendarOffsets} from '../server/calendar-reminders.js';
import {nativeRoute} from '../shared/mobile.js';

test('calendar reminders validate intervals and support native event deep links',()=>{
 assert.deepEqual(calendarOffsets([60,1440,60,0]),[1440,60,0]);
 for(const v of [null,[-1],[43201],[1.5],['60'],[1,2,3,4,5,6]])assert.throws(()=>calendarOffsets(v),{status:400});
 assert.equal(nativeRoute('https://app.churptree.com/?community=tree&calendar_event=event'),'/?community=tree&calendar_event=event');
});
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'churp-calendar-reminders-'));let runtime,server,base,time=Date.parse('2030-04-01T12:00:00Z');const delivered=[],nativeDelivered=[];
 const options={nativePushProviders:{configured:{ios:true,android:true},send:async(sub,payload)=>nativeDelivered.push(payload)},dataDir:dir,testing:true,googleClientId:'',pushEnabled:true,calendarAutoProcess:false,calendarNow:()=>time,pushNow:()=>time,pushSender:async(s,body)=>{delivered.push({endpoint:s.endpoint,...JSON.parse(body)});}};
 async function start(){runtime=createApp(options);server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api`;}
 async function stop(){runtime.close();await new Promise(r=>server.close(r));}await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 async function req(path,a,method='GET',body){const r=await fetch(base+path,{method,headers:{...(a?{cookie:a.cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r));return r.data;}
 async function actor(name){const r=await req('/auth/register',null,'POST',{birth_date:'1990-01-01',username:name,name,password:'Calendar reminder fixture!'});const a={...r.data.user,cookie:r.cookie};const endpoint=`https://push.example/${a.id}`;runtime.db.prepare('INSERT INTO push_subscriptions VALUES (?,?,?)').run(endpoint,a.id,JSON.stringify({endpoint}));return a;}
 const owner=await actor('reminderowner'),member=await actor('remindermember'),other=await actor('reminderother');
 const tree=(await ok('/communities',owner,'POST',{name:'Reminder Tree'})).community;
 for(const u of [member,other])runtime.db.prepare("INSERT INTO community_members VALUES (?,?,'member')").run(tree.id,u.id);
 const nest=(await ok(`/communities/${tree.id}/circles`,owner,'POST',{name:'Reminder Nest',private:true})).group;
 runtime.db.prepare('INSERT INTO group_members(group_id,user_id) VALUES (?,?)').run(nest.id,member.id);
 const create=async(extra={})=>{const body={group_id:nest.id,title:'Private activity',description:'Secret details',location:'Private place',start:new Date(time+48*3600000).toISOString(),end:new Date(time+49*3600000).toISOString(),visibility:'private',...extra};return {...body,...await ok('/calendar/events',owner,'POST',body)};};
 return {get runtime(){return runtime;},get time(){return time;},set time(v){time=v;},delivered,nativeDelivered,owner,member,other,tree,nest,create,req,ok,async restart(){await stop();await start();}};
}
test('24h defaults, custom defaults, personal reminders, restarts, privacy and Nest mute follow current access',async t=>{
 const f=await fixture(t),{owner,member,other,nest}=f;
 assert.deepEqual((await f.ok('/calendar/notification-settings',member)).offsets,[1440]);
 assert.equal((await f.req('/calendar/notification-settings',member,'PUT',{offsets:[-1]})).status,400);
 await f.ok('/calendar/notification-settings',owner,'PUT',{offsets:[]});
 const install=randomUUID();await f.ok('/native-push/subscribe',member,'POST',{install_id:install,platform:'ios',token:'ab'.repeat(32)});await f.ok('/native-push/presence',member,'POST',{install_id:install,visible:false});
 const e=await f.create();await f.runtime.calendars.tick();assert.equal(f.delivered.length,0);
 f.time+=24*3600000;await Promise.all([f.runtime.calendars.tick(),f.runtime.calendars.tick()]);
 assert.equal(f.delivered.length,1);assert.equal(f.delivered[0].recipient_id,member.id);assert.equal(f.delivered[0].source.channel,'calendar');assert.match(f.delivered[0].url,new RegExp(`calendar_event=${e.id}`));assert.equal(f.delivered[0].title,'Private activity');assert.match(f.delivered[0].body,/Apr 3, 2030/);assert.match(f.delivered[0].body,/12:00 PM UTC/);assert.doesNotMatch(JSON.stringify(f.delivered),/Secret details|Private place/);
 assert.equal(f.nativeDelivered[0].title,'Private activity');assert.equal(f.nativeDelivered[0].body,f.delivered[0].body);assert.equal(f.nativeDelivered[0].url,f.delivered[0].url);
 await f.restart();await f.runtime.calendars.tick();assert.equal(f.delivered.length,1,'restart must not repeat a reminder');
 await f.ok('/calendar/notification-settings',member,'PUT',{offsets:[60,1440]});
 f.runtime.db.prepare('UPDATE users SET notification_previews=0 WHERE id=?').run(member.id);
 const remindAt=f.time+3600000;
 assert.equal((await f.req(`/calendar/events/${e.id}/reminder`,other,'PUT',{remind_at:new Date(remindAt).toISOString()})).status,404);
 assert.equal((await f.req(`/calendar/events/${e.id}/reminder`,member,'PUT',{remind_at:new Date(f.time-1000).toISOString()})).status,400);
 await f.ok(`/calendar/events/${e.id}/reminder`,member,'PUT',{remind_at:new Date(remindAt).toISOString()});
 f.time=remindAt;await f.runtime.calendars.tick();assert.equal(f.delivered.length,2);assert.equal(f.delivered[1].title,'Calendar reminder');assert.equal(f.delivered[1].calendar_start,undefined);assert.doesNotMatch(f.delivered[1].body,/Private activity|2030/);
 assert.equal(f.nativeDelivered[1].title,'Calendar reminder');assert.doesNotMatch(f.nativeDelivered[1].body,/2030|Private activity/);
 const detail=(await f.ok(`/calendar/trees/${f.tree.id}`,member)).events.find(x=>x.id===e.id);assert.equal(detail.reminder.sent,true);
 // Personal reminders are one-time even if an activity is rescheduled later.
 await f.ok(`/calendar/events/${e.id}`,owner,'PATCH',{...e,start:new Date(f.time+4*3600000).toISOString(),end:new Date(f.time+5*3600000).toISOString()});await f.runtime.calendars.tick();assert.equal(f.delivered.length,2);
 f.runtime.db.prepare('UPDATE group_members SET muted=1 WHERE group_id=? AND user_id=?').run(nest.id,member.id);
 f.time+=3*3600000;await f.runtime.calendars.tick();assert.equal(f.delivered.length,2,'muted Nest suppresses reminders');
 f.runtime.db.prepare('UPDATE group_members SET muted=0 WHERE group_id=? AND user_id=?').run(nest.id,member.id);
 f.runtime.db.prepare('DELETE FROM community_members WHERE community_id=? AND user_id=?').run(f.tree.id,member.id);await f.runtime.calendars.tick();assert.equal(f.delivered.length,2,'Tree removal revokes reminders');
});
test('personal opt-in for public Tree events, cancellation, device opt-out, edits and event deletion',async t=>{
 const f=await fixture(t),{owner,member,other}=f;await f.ok('/calendar/notification-settings',owner,'PUT',{offsets:[]});await f.ok('/calendar/notification-settings',member,'PUT',{offsets:[]});
 const e=await f.create({visibility:'public'}),at=f.time+3600000;
 await f.ok(`/calendar/events/${e.id}/reminder`,other,'PUT',{remind_at:new Date(at).toISOString()});
 // A non-member may explicitly request a reminder for a public event.
 f.time=at;await f.runtime.calendars.tick();assert.equal(f.delivered.length,1);assert.equal(f.delivered[0].recipient_id,other.id);
 const second=await f.create(),next=f.time+60000;
 await f.ok(`/calendar/events/${second.id}/reminder`,member,'PUT',{remind_at:new Date(next).toISOString()});
 await f.ok(`/calendar/events/${second.id}/reminder`,member,'DELETE');f.time=next;await f.runtime.calendars.tick();assert.equal(f.delivered.length,1);
 const third=await f.create({visibility:'public'});await f.ok(`/calendar/events/${third.id}/reminder`,other,'PUT',{remind_at:new Date(f.time+60000).toISOString()});
 await f.ok(`/calendar/events/${third.id}`,owner,'PATCH',{...third,visibility:'private'});f.time+=60000;await f.runtime.calendars.tick();assert.equal(f.delivered.length,1,'privacy changes revoke pending public reminders');
 const fourth=await f.create();await f.ok(`/calendar/events/${fourth.id}/reminder`,member,'PUT',{remind_at:new Date(f.time+60000).toISOString()});await f.ok(`/calendar/events/${fourth.id}`,owner,'DELETE');f.time+=60000;await f.runtime.calendars.tick();assert.equal(f.delivered.length,1);
 const fifth=await f.create();await f.ok(`/calendar/events/${fifth.id}/reminder`,member,'PUT',{remind_at:new Date(f.time+60000).toISOString()});f.runtime.db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(member.id);f.time+=60000;await f.runtime.calendars.tick();assert.equal(f.delivered.length,1,'disabled device notifications receive no push');
});
test('overdue defaults collapse to one alert and at-start reminders tolerate the polling interval',async t=>{
 const f=await fixture(t);await f.ok('/calendar/notification-settings',f.owner,'PUT',{offsets:[]});await f.ok('/calendar/notification-settings',f.member,'PUT',{offsets:[1440,60,0]});
 const e=await f.create();f.time=Date.parse(e.start)+15000;await f.runtime.calendars.tick();assert.equal(f.delivered.length,1);await f.runtime.calendars.tick();assert.equal(f.delivered.length,1);
 f.time+=6*60000;const late=await f.create();f.time=Date.parse(late.start)+10*60000;await f.runtime.calendars.tick();assert.equal(f.delivered.length,1,'do not deliver reminders after an activity is already underway');
});

test('a modified one-hour default delivers only to its owner and respects an empty default list',async t=>{
 const f=await fixture(t);await f.ok('/calendar/notification-settings',f.owner,'PUT',{offsets:[]});await f.ok('/calendar/notification-settings',f.member,'PUT',{offsets:[60]});
 const e=await f.create({start:new Date(f.time+7200000).toISOString(),end:new Date(f.time+10800000).toISOString()});
 f.time+=3590000;await f.runtime.calendars.tick();assert.equal(f.delivered.length,0);f.time+=20000;await f.runtime.calendars.tick();assert.equal(f.delivered.length,1);assert.equal(f.delivered[0].recipient_id,f.member.id);
 assert.deepEqual((await f.ok('/calendar/notification-settings',f.owner)).offsets,[]);assert.deepEqual((await f.ok('/calendar/notification-settings',f.member)).offsets,[60]);
});

test('calendar alerts retain the event zone and reject invalid time zones',async t=>{
 const f=await fixture(t);await f.ok('/calendar/notification-settings',f.owner,'PUT',{offsets:[]});
 const e=await f.create({time_zone:'America/Denver'});assert.equal((await f.ok(`/calendar/trees/${f.tree.id}`,f.owner)).events[0].time_zone,'America/Denver');
 assert.equal((await f.req('/calendar/events',f.owner,'POST',{...e,time_zone:'Invalid/Zone'})).status,400);
 f.time+=24*3600000;await f.runtime.calendars.tick();assert.equal(f.delivered[0].title,'Private activity');assert.match(f.delivered[0].body,/6:00 AM MDT/);assert.equal(f.delivered[0].calendar_start,e.start);
});
