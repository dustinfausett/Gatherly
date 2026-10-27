import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
import {smsConfiguration,liveReady,twilioSend,twilioSignature} from '../server/sms-provider.js';
import {smsSegments} from '../shared/sms.js';
async function fixture(t,mode='mock',transport){
 const dir=mkdtempSync(join(tmpdir(),'churp-sms-'));let runtime,server,base;const config={...smsConfiguration({SMS_MODE:mode}),accountSid:'AC'+'a'.repeat(32),authToken:'test-fixture-only',serviceSid:'MG'+'b'.repeat(32),from:'+12025550100'};let sends=0;
 async function start(){runtime=createApp({dataDir:dir,testing:true,pushEnabled:false,googleClientId:'',appUrl:'https://app.churptree.test',smsConfig:config,smsAutoProcess:false,smsTransport:async(...args)=>{sends++;if(transport)return transport(...args);throw new Error('Real provider requests are forbidden by this fixture.');}});server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
 async function stop(){runtime.close();await new Promise(r=>server.close(r));}await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 async function req(path,a,method='GET',body,headers={}){const encoded=body instanceof URLSearchParams;const r=await fetch(base+path,{method,headers:{...(a?{cookie:a.cookie}:{}),...(body?{'content-type':encoded?'application/x-www-form-urlencoded':'application/json'}:{}),...headers},body:body?encoded?body.toString():JSON.stringify(body):undefined});const text=await r.text();return {status:r.status,data:r.headers.get('content-type')?.includes('json')?JSON.parse(text):text,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r.data));return r.data;}
 async function actor(name){const r=await req('/api/auth/register',null,'POST',{birth_date:'1990-01-01',username:name,name,password:'SMS integration fixture!'});assert.equal(r.status,201);return {...r.data.user,cookie:r.cookie};}
 const owner=await actor('owner'),other=await actor('other');const tree=(await ok('/api/communities',owner,'POST',{name:'Pilot Tree'})).community,invite=await ok('/api/invitations',owner,'POST',{community_id:tree.id});await ok('/api/invitations/accept',other,'POST',{token:invite.code});
 async function thread(a,phone='+12025550123'){const c=(await ok('/api/contacts',a,'POST',{name:'Fictional adult',phone})).contact;return (await ok('/api/sms/threads',a,'POST',{tree_id:tree.id,contact_id:c.id})).thread;}
 async function draft(a,threads,text='A private external planning text.'){const share=await ok('/api/invitations',a,'POST',{community_id:tree.id});return {tree_id:tree.id,thread_ids:threads.map(t=>t.id),text,source_nest:null,invitation_url:share.url,client_id:randomUUID()};}
 async function simulate(a,th,text){return ok(`/api/sms/threads/${th.id}/simulate`,a,'POST',{action:'inbound',text});}
 async function consent(a,th){return ok(`/api/sms/threads/${th.id}/simulate`,a,'POST',{action:'consent',adult:true});}
 function webhook(path,fields){const f={AccountSid:config.accountSid,...fields};return req(path,null,'POST',new URLSearchParams(f),{'x-twilio-signature':twilioSignature(config.authToken,'https://app.churptree.test'+path,f)});}
 return {req,ok,actor,owner,other,tree,thread,draft,simulate,consent,webhook,config,tick:()=>runtime.sms.tick(),restart:async()=>{await stop();await start();},get db(){return runtime.db;},get sends(){return sends;}};
}
test('segment estimates count GSM extension characters and Unicode code units; disabled/live modes fail closed',async()=>{
 assert.deepEqual(smsSegments('a'.repeat(160)),{encoding:'GSM-7',units:160,segments:1});assert.equal(smsSegments('^'.repeat(81)).segments,2);assert.equal(smsSegments('🐦'.repeat(36)).units,72);assert.equal(smsSegments('🐦'.repeat(36)).segments,2);
 const config=smsConfiguration({SMS_MODE:'live'});assert.equal(liveReady(config,'https://app.churptree.test'),false);assert.equal(smsConfiguration({}).mode,'disabled');assert.equal(smsConfiguration({SMS_MODE:'invalid'}).mode,'disabled');
});
test('mock queue uses zero network requests, authentic invitations, encrypted storage, durable idempotent results and conservative budgets',async t=>{
 const f=await fixture(t),a=await f.thread(f.owner),b=await f.thread(f.owner,'+12025550124');
 let request=await f.draft(f.owner,[a,b]);let preview=await f.ok('/api/sms/preview',f.owner,'POST',request);assert.equal(preview.rows.every(r=>!r.eligible),true);
 await f.consent(f.owner,a);await f.consent(f.owner,b);preview=await f.ok('/api/sms/preview',f.owner,'POST',request);assert.equal(preview.rows.length,2);assert.match(preview.rows[0].text,/Churp \| owner \| Pilot Tree/);assert.match(preview.rows[0].text,/Join this Tree: https:\/\/app.churptree.test\//);assert.match(preview.rows[0].text,/Reply STOP/);
 const job=await f.ok('/api/sms/jobs',f.owner,'POST',request);assert.equal(job.messages[0].state,'queued');assert.equal((await f.ok('/api/sms/jobs',f.owner,'POST',request)).id,job.id);assert.equal((await f.req('/api/sms/jobs',f.owner,'POST',{...request,text:'Changed'})).status,409);
 assert.equal((await f.req(`/api/sms/jobs/${job.id}`,f.other)).status,404);assert.equal((await f.req(`/api/sms/threads/${a.id}/messages`,f.other)).status,404);
 assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM sms_messages').all()).includes(request.text));assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM sms_job_context').all()).includes('invite='));
 await f.tick();await f.restart();await f.tick();const done=await f.ok(`/api/sms/jobs/${job.id}`,f.owner);assert.deepEqual(done.messages.map(m=>m.state),['mock_sent','mock_sent']);assert.equal(f.sends,0);assert.equal((await f.ok('/api/sms/jobs',f.owner,'POST',request)).messages.length,2);
 const wrong=await f.draft(f.owner,[a]);wrong.invitation_url='https://unrelated.example/?invite=x';assert.equal((await f.req('/api/sms/preview',f.owner,'POST',wrong)).status,400);
 f.config.dailyLimit=1;assert.equal((await f.req('/api/sms/jobs',f.owner,'POST',await f.draft(f.owner,[a]))).status,429);assert.equal(f.sends,0);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('shared-number STOP suppresses every owner, START alone grants no consent and replies require the correct sender code',async t=>{
 const f=await fixture(t),a=await f.thread(f.owner),b=await f.thread(f.other);await f.consent(f.owner,a);await f.consent(f.other,b);
 const unknown=await f.simulate(f.owner,a,'yes');assert.match(unknown.reply,/Begin your reply/);assert.equal((await f.ok(`/api/sms/threads/${a.id}/messages`,f.owner)).messages.length,0);
 await f.simulate(f.owner,a,`${b.reply_code} Reply intended for other`);assert.equal((await f.ok(`/api/sms/threads/${a.id}/messages`,f.owner)).messages.length,0);assert.equal((await f.ok(`/api/sms/threads/${b.id}/messages`,f.other)).messages[0].body,'Reply intended for other');assert.equal((await f.ok('/api/sms/unread',f.other)).unread,1);const viewed=(await f.ok(`/api/sms/threads/${b.id}/messages`,f.other)).messages;await f.ok(`/api/sms/threads/${b.id}/read`,f.other,'POST',{through:viewed.at(-1).created_at});assert.equal((await f.ok('/api/sms/unread',f.other)).unread,0);
 const draft=await f.draft(f.other,[b]);const j=await f.ok('/api/sms/jobs',f.other,'POST',draft);await f.simulate(f.owner,a,'STOP');assert.equal((await f.ok(`/api/sms/jobs/${j.id}`,f.other)).messages[0].state,'suppressed');await f.tick();assert.equal(f.sends,0);
 assert.equal((await f.req(`/api/sms/threads/${b.id}/simulate`,f.other,'POST',{action:'consent',adult:true})).status,403);await f.restart();assert.equal((await f.ok('/api/sms/threads',f.other)).threads[0].suppressed,true);
 await f.simulate(f.owner,a,'START');assert.equal((await f.ok('/api/sms/preview',f.other,'POST',await f.draft(f.other,[b]))).rows[0].eligible,false);await f.consent(f.other,b);assert.equal((await f.ok('/api/sms/preview',f.other,'POST',await f.draft(f.other,[b]))).rows[0].eligible,true);
});
test('consent page is public, separate checkboxes are required and web submission alone never activates even simulated consent',async t=>{
 const f=await fixture(t),a=await f.thread(f.owner),link=await f.ok(`/api/sms/threads/${a.id}/enrollment`,f.owner,'POST');const path=new URL(link.url).pathname;
 const page=await f.ok(path,null);assert.match(page,/Mock mode — no real texts/);assert.match(page,/name="sms"/);assert.match(page,/name="marketing"/);assert.match(page,/name="terms"/);assert.doesNotMatch(page,/checked/);assert.match(page,/\/privacy/);
 const form=new URLSearchParams({phone:a.phone,adult:'on',sms:'on',terms:'on'});assert.equal((await f.req(path,null,'POST',form)).status,400);form.set('marketing','on');const submitted=await f.ok(path,null,'POST',form),code=submitted.match(/JOIN ([A-F0-9]{12})/)[1];assert.equal((await f.ok('/api/sms/threads',f.owner)).threads[0].consent,'none');await f.simulate(f.owner,a,`JOIN ${code}`);assert.equal((await f.ok('/api/sms/threads',f.owner)).threads[0].consent,'active');assert.match((await f.simulate(f.owner,a,`JOIN ${code}`)).reply,/invalid or expired/);
});
test('contact ownership, US-only numbers, adult restrictions, revoked invitations and Nest source roles are enforced again at dispatch',async t=>{
 const f=await fixture(t),a=await f.thread(f.owner);await f.consent(f.owner,a);
 const foreign=(await f.ok('/api/contacts',f.other,'POST',{name:'Foreign owner',phone:'+12025550126'})).contact;assert.equal((await f.req('/api/sms/threads',f.owner,'POST',{tree_id:f.tree.id,contact_id:foreign.id})).status,404);
 const canadian=(await f.ok('/api/contacts',f.owner,'POST',{name:'Toronto',phone:'+14165550123'})).contact;assert.equal((await f.req('/api/sms/threads',f.owner,'POST',{tree_id:f.tree.id,contact_id:canadian.id})).status,400);
 const nest=(await f.ok(`/api/communities/${f.tree.id}/circles`,f.owner,'POST',{name:'Private source',private:true})).group;const noRole=await f.draft(f.other,[await f.thread(f.other)]);noRole.source_nest=nest.id;assert.equal((await f.req('/api/sms/preview',f.other,'POST',noRole)).status,403);
 const draft=await f.draft(f.owner,[a]);const j=await f.ok('/api/sms/jobs',f.owner,'POST',draft);f.db.prepare('DELETE FROM invitations WHERE token_hash=?').run((await import('../server/security.js')).hash(new URL(draft.invitation_url).searchParams.get('invite')));await f.tick();assert.equal((await f.ok(`/api/sms/jobs/${j.id}`,f.owner)).messages[0].state,'suppressed');
 f.db.prepare("UPDATE users SET birth_date='2012-01-01' WHERE id=?").run(f.owner.id);assert.equal((await f.req('/api/sms/jobs',f.owner,'POST',await f.draft(f.other,[await f.thread(f.other,'+12025550127')]))).status,403);assert.equal(f.sends,0);
});
test('live adapter is gated, form webhooks require exact Twilio signatures, actual phone confirmation is scoped and status callbacks cannot downgrade delivery',async t=>{
 let count=0;const f=await fixture(t,'live',async()=>({ok:true,status:201,json:async()=>({sid:'SM'+String(++count).padStart(32,'0')})}));assert.equal((await f.req('/api/sms/threads',f.owner,'POST',{})).status,503);
 f.config.liveApproved=true;f.config.treeId=f.tree.id;f.config.senders=[f.owner.id];const a=await f.thread(f.owner);assert.equal((await f.req(`/api/sms/threads/${a.id}/simulate`,f.owner,'POST',{action:'consent',adult:true})).status,403);
 const link=await f.ok(`/api/sms/threads/${a.id}/enrollment`,f.owner,'POST'),path=new URL(link.url).pathname,submitted=await f.ok(path,null,'POST',new URLSearchParams({phone:a.phone,adult:'on',sms:'on',marketing:'on',terms:'on'})),join=submitted.match(/JOIN ([A-F0-9]{12})/)[1];
 const inbound={To:f.config.from,From:a.phone,MessageSid:'SM'+'c'.repeat(32),Body:`JOIN ${join}`};assert.equal((await f.req('/api/sms/webhooks/inbound',null,'POST',new URLSearchParams(inbound))).status,403);assert.equal((await f.webhook('/api/sms/webhooks/inbound',inbound)).status,200);
 assert.equal((await f.ok('/api/sms/threads',f.owner)).threads[0].consent,'active');const j=await f.ok('/api/sms/jobs',f.owner,'POST',await f.draft(f.owner,[a]));await f.tick();let saved=await f.ok(`/api/sms/jobs/${j.id}`,f.owner);assert.equal(saved.messages[0].state,'submitted');assert.equal(f.sends,1);const sid=saved.messages[0].provider_sid;
 await f.webhook('/api/sms/webhooks/status',{MessageSid:sid,MessageStatus:'delivered'});await f.webhook('/api/sms/webhooks/status',{MessageSid:sid,MessageStatus:'sent'});assert.equal((await f.ok(`/api/sms/jobs/${j.id}`,f.owner)).messages[0].state,'delivered');
 const reply={To:f.config.from,From:a.phone,MessageSid:'SM'+'d'.repeat(32),Body:`${a.reply_code} A private reply`};await f.webhook('/api/sms/webhooks/inbound',reply);await f.webhook('/api/sms/webhooks/inbound',reply);assert.equal((await f.ok(`/api/sms/threads/${a.id}/messages`,f.owner)).messages.filter(m=>m.direction==='inbound').length,1);
 const forged={...reply,MessageSid:'SM'+'e'.repeat(32),AccountSid:'AC'+'f'.repeat(32)};assert.equal((await f.webhook('/api/sms/webhooks/inbound',forged)).status,403);
});
test('uncertain acceptance survives restart without resending; definitive 4xx is retryable but network/5xx is unknown',async t=>{
 const f=await fixture(t,'live',async()=>{throw new Error('Network lost after send');});f.config.liveApproved=true;f.config.treeId=f.tree.id;f.config.senders=[f.owner.id];const a=await f.thread(f.owner);f.db.prepare("INSERT INTO sms_consent VALUES (?, 'live','active','fixture evidence',?)").run(a.id,Date.now());const j=await f.ok('/api/sms/jobs',f.owner,'POST',await f.draft(f.owner,[a]));await f.tick();assert.equal((await f.ok(`/api/sms/jobs/${j.id}`,f.owner)).messages[0].state,'unknown');await f.restart();await f.tick();assert.equal(f.sends,1);const m=(await f.ok(`/api/sms/jobs/${j.id}`,f.owner)).messages[0];assert.equal((await f.req(`/api/sms/messages/${m.id}/retry`,f.owner,'POST')).status,409);
 const c=f.config,args={to:a.phone,body:'Fixture only',statusCallback:'https://app.churptree.test/api/sms/webhooks/status'};assert.equal((await twilioSend(c,args,async()=>({ok:false,status:400,json:async()=>({code:21610})}))).state,'failed');assert.equal((await twilioSend(c,args,async()=>({ok:false,status:500,json:async()=>({})}))).state,'unknown');
});

test('only the job owner can cancel queued work; canceled messages cannot reach a provider',async t=>{
 const f=await fixture(t),a=await f.thread(f.owner);await f.consent(f.owner,a);const j=await f.ok('/api/sms/jobs',f.owner,'POST',await f.draft(f.owner,[a]));assert.equal((await f.req(`/api/sms/jobs/${j.id}/cancel`,f.other,'POST')).status,404);await f.ok(`/api/sms/jobs/${j.id}/cancel`,f.owner,'POST');await f.tick();assert.equal((await f.ok(`/api/sms/jobs/${j.id}`,f.owner)).messages[0].state,'canceled');assert.equal(f.sends,0);
});

test('an internal block on an explicitly linked phone contact also stops queued SMS',async t=>{
 const f=await fixture(t);const contact=(await f.ok('/api/contacts',f.owner,'POST',{name:'Linked adult',phone:'+12025550128',linked_user_id:f.other.id})).contact;const a=(await f.ok('/api/sms/threads',f.owner,'POST',{contact_id:contact.id,tree_id:f.tree.id})).thread;await f.consent(f.owner,a);const j=await f.ok('/api/sms/jobs',f.owner,'POST',await f.draft(f.owner,[a]));const c=(await f.ok('/api/private/conversations',f.owner,'POST',{user_id:f.other.id})).conversation;await f.ok(`/api/private/conversations/${c.id}/block`,f.other,'PATCH',{blocked:true});await f.tick();assert.equal((await f.ok(`/api/sms/jobs/${j.id}`,f.owner)).messages[0].state,'suppressed');assert.equal(f.sends,0);
});

test('Twilio opt-out rejection synchronizes global local suppression and cannot be retried',async t=>{
 const f=await fixture(t,'live',async()=>({ok:false,status:400,json:async()=>({code:21610})}));f.config.liveApproved=true;f.config.treeId=f.tree.id;f.config.senders=[f.owner.id];const a=await f.thread(f.owner);f.db.prepare("INSERT INTO sms_consent VALUES (?, 'live','active','fixture evidence',?)").run(a.id,Date.now());const j=await f.ok('/api/sms/jobs',f.owner,'POST',await f.draft(f.owner,[a]));await f.tick();const m=(await f.ok(`/api/sms/jobs/${j.id}`,f.owner)).messages[0];assert.equal(m.state,'suppressed');assert.equal((await f.ok('/api/sms/threads',f.owner)).threads[0].suppressed,true);assert.equal((await f.req(`/api/sms/messages/${m.id}/retry`,f.owner,'POST')).status,409);
});
