import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createApp} from '../server/app.js';
import {BIRDS,getBird,birdStatus,birdIsAvailable,seasonalWindow} from '../shared/birds.js';

const noon=value=>new Date(`${value}T19:00:00Z`);
const shift=(value,days)=>new Date(Date.parse(value)+days*86400000).toISOString().slice(0,10);
test('all six calendars have a calendar month of availability, seven preview days and three post-holiday days',()=>{
 const cases=[
  ['christmas','2026-12-25','2026-11-18','2026-11-25','2026-12-28'],
  ['valentine','2026-02-14','2026-01-07','2026-01-14','2026-02-17'],
  ['st-patrick','2026-03-17','2026-02-10','2026-02-17','2026-03-20'],
  ['independence','2026-07-04','2026-05-28','2026-06-04','2026-07-07'],
  ['halloween','2026-10-31','2026-09-23','2026-09-30','2026-11-03'],
  ['thanksgiving','2026-11-26','2026-10-19','2026-10-26','2026-11-29'],
  ['thanksgiving','2027-11-25','2027-10-18','2027-10-25','2027-11-28'],
  ['thanksgiving','2028-11-23','2028-10-16','2028-10-23','2028-11-26'],
 ];
 for(const [id,holiday,preview,start,end] of cases){
  const bird=getBird(id);
  assert.deepEqual(seasonalWindow(bird,noon(preview)),{holiday,preview,start,end},id);
  for(const [date,status] of [[shift(preview,-1),'hidden'],[preview,'preview'],[shift(start,-1),'preview'],[start,'available'],[holiday,'available'],[end,'available'],[shift(end,1),'hidden']])assert.equal(birdStatus(bird,noon(date)),status,`${id} ${date}`);
 }
 // Christmas also observes its calendar outside the holiday window.
 assert.equal(birdStatus(getBird('christmas'),noon('2026-10-27')),'hidden');
 assert.equal(birdStatus(getBird('christmas'),noon('2026-11-18')),'preview');
 assert.equal(birdIsAvailable(getBird('blue')),true);assert.equal(birdStatus(undefined),'hidden');
});

test('Denver midnight controls transitions, including daylight saving and next-year rollover',()=>{
 const bird=getBird('christmas');
 for(const [date,status] of [['2026-11-18T06:59:59.999Z','hidden'],['2026-11-18T07:00:00Z','preview'],['2026-11-25T06:59:59.999Z','preview'],['2026-11-25T07:00:00Z','available'],['2026-12-29T06:59:59.999Z','available'],['2026-12-29T07:00:00Z','hidden'],['2027-01-01T07:00:00Z','hidden']])assert.equal(birdStatus(bird,new Date(date)),status,date);
 const july=getBird('independence');
 assert.equal(birdStatus(july,new Date('2026-06-04T05:59:59Z')),'preview');assert.equal(birdStatus(july,new Date('2026-06-04T06:00:00Z')),'available');
 assert.equal(seasonalWindow(bird,noon('2026-12-29')).start,'2027-11-25');
});

test('all six public seasons enforce preview, selection and expiry equally for ordinary users and dustin',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'churp-seasonal-'));let date=noon('2026-09-20');
 const runtime=createApp({dataDir:dir,testing:true,encryptionRequired:false,pushEnabled:false,googleClientId:'',birdNow:()=>date}),server=createServer(runtime.app);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}/api`;
 function actor(){let cookie;return async(path,method='GET',body)=>{const response=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});cookie=response.headers.get('set-cookie')?.split(';')[0]||cookie;return {status:response.status,data:await response.json()};};}
 const ordinary=actor(),formerTester=actor();
 for(const [request,username] of [[ordinary,'seasonal'],[formerTester,'dustin']]){
  assert.equal((await request('/auth/register','POST',{birth_date:'1990-01-01',username,name:username,password:'A seasonal pet test password!'})).status,201);
  assert.deepEqual((await request('/me')).data.user.unlocked_birds,['blue','gold']);
 }
 assert.equal((await ordinary('/communities','POST',{name:'Owner cannot bypass seasons'})).status,201);
 await ordinary('/me/birds/unlock','POST',{code:'Churp'});
 for(const bird of BIRDS.filter(b=>b.seasonal)){
  const window=seasonalWindow(bird,noon('2026-01-01'));
  for(const request of [ordinary,formerTester]){
   date=noon(shift(window.preview,-1));let user=(await request('/me')).data.user;
   assert.ok(!user.visible_birds.includes(bird.id),`${bird.id} hidden before preview`);
   assert.equal((await request('/me','PATCH',{bird_id:bird.id,earlyAccess:true,username:'dustin',unlocked_birds:[bird.id]})).status,403);
   date=noon(window.preview);user=(await request('/me')).data.user;
   assert.ok(user.visible_birds.includes(bird.id));assert.ok(!user.unlocked_birds.includes(bird.id));assert.equal((await request('/me','PATCH',{bird_id:bird.id})).status,403);
   date=noon(window.start);user=(await request('/me')).data.user;assert.ok(user.unlocked_birds.includes(bird.id));
   assert.equal((await request('/me','PATCH',{bird_id:bird.id})).data.user.bird_id,bird.id);
   date=noon(window.end);assert.equal((await request('/me')).data.user.bird_id,bird.id);
   date=noon(shift(window.end,1));user=(await request('/me')).data.user;
   assert.equal(user.bird_id,'blue');assert.ok(!user.visible_birds.includes(bird.id));assert.ok(!user.unlocked_birds.includes(bird.id));assert.equal((await request('/me','PATCH',{bird_id:bird.id})).status,403);
   assert.equal((await request('/me','PATCH',{name:'After the season'})).status,200);
  }
 }
 date=noon('2026-10-27');for(const request of [ordinary,formerTester]){
  const user=(await request('/me')).data.user;assert.deepEqual(user.unlocked_birds.filter(id=>getBird(id).seasonal),['halloween','thanksgiving']);assert.equal(user.visible_birds.length,14);
 }
 assert.deepEqual(runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
