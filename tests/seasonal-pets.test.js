import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createApp} from '../server/app.js';
import {getBird,birdIsAvailable,christmasInSeason,CHRISTMAS_PREVIEW_ENABLED} from '../shared/birds.js';

test('Christmas season includes November 1 through January 3 in Denver, with an explicit early-test override',()=>{
 for(const value of ['2026-11-01T06:00:00Z','2026-12-25T19:00:00Z','2027-01-01T07:00:00Z','2027-01-04T06:59:59.999Z'])assert.equal(christmasInSeason(new Date(value)),true,value);
 for(const value of ['2026-11-01T05:59:59.999Z','2027-01-04T07:00:00Z','2027-06-01T12:00:00Z','2026-10-27T12:00:00Z'])assert.equal(christmasInSeason(new Date(value)),false,value);
 const date=new Date('2026-10-27T12:00:00Z');assert.equal(CHRISTMAS_PREVIEW_ENABLED,true);assert.equal(birdIsAvailable(getBird('christmas'),date),true);assert.equal(birdIsAvailable(getBird('christmas'),date,false),false);assert.equal(birdIsAvailable(getBird('gold'),date,false),true);
});

test('seasonal selection is enforced by the server, falls back after the season, and is included during early testing',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'churp-seasonal-'));let date=new Date('2026-10-27T12:00:00Z');
 const options={dataDir:dir,testing:true,encryptionRequired:false,pushEnabled:false,googleClientId:'',birdNow:()=>date,christmasPreview:false},runtime=createApp(options),server=createServer(runtime.app);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}/api`;let cookie;
 async function request(path,method='GET',body){const response=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});cookie=response.headers.get('set-cookie')?.split(';')[0]||cookie;return {status:response.status,data:await response.json()};}
 assert.equal((await request('/auth/register','POST',{birth_date:'1990-01-01',username:'seasonal',name:'Seasonal keeper',password:'A seasonal pet test password!'})).status,201);
 assert.deepEqual((await request('/me')).data.user.unlocked_birds,['blue','gold']);assert.equal((await request('/me','PATCH',{bird_id:'christmas'})).status,403);
 await request('/me/birds/unlock','POST',{code:'Churp'});assert.equal((await request('/me')).data.user.unlocked_birds.includes('christmas'),false);
 date=new Date('2026-11-01T06:00:00Z');assert.equal((await request('/me','PATCH',{bird_id:'christmas'})).data.user.bird_id,'christmas');
 date=new Date('2027-01-04T06:59:59.999Z');assert.equal((await request('/me')).data.user.bird_id,'christmas');date=new Date('2027-01-04T07:00:00Z');assert.equal((await request('/me')).data.user.bird_id,'blue');assert.equal((await request('/me','PATCH',{name:'After the season'})).status,200);
 date=new Date('2026-10-27T12:00:00Z');options.christmasPreview=true;assert.equal((await request('/me')).data.user.unlocked_birds.includes('christmas'),true);assert.equal((await request('/me','PATCH',{bird_id:'christmas'})).data.user.bird_id,'christmas');
});
