import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createApp} from '../server/app.js';
import * as enc from '../shared/encryption.js';
import {scheduleProof} from '../shared/scheduling.js';
import {approveRequest} from './helpers/approve-request.js';
import {deletedAccountAvatar} from '../shared/deleted-account.js';
import {AVATARS,getAvatar} from '../shared/avatars.js';
import {BIRDS} from '../shared/birds.js';
const password='Delete account fixture password!';
async function fixture(t,options={}){
 const dir=mkdtempSync(join(tmpdir(),'churp-native-auth-'));let runtime,server,base;
 async function start(){runtime=createApp({dataDir:dir,testing:true,googleClientId:'fixture.apps.googleusercontent.com',googleVerifyToken:async value=>JSON.parse(value),pushEnabled:false,mailer:null,schedulingAutoProcess:false,...options});server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api`;}
 async function stop(){runtime.close();await new Promise(r=>server.close(r));}await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 async function req(path,a,method='GET',body,headers={}){const form=body instanceof FormData,r=await fetch(base+path,{method,headers:{...(a?{cookie:a.cookie,...(a.device?{'x-churp-device':a.device}:{})}:{}),...(body&&!form?{'content-type':'application/json'}:{}),...headers},body:body?form?body:JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer()),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r));return r.data;}
 async function actor(username,youth=false){const r=await req('/auth/register',null,'POST',{username,name:username,password,birth_date:youth?'2012-01-01':'1990-01-01'});assert.equal(r.status,201);const a={...r.data.user,cookie:r.cookie,device:randomUUID()},keys=await ok('/e2ee/managed-device',a,'POST',{deviceId:a.device,deviceName:username});a.privateKey=await enc.readPrivate(keys.privateKey);return a;}
 async function link(parent,child){const {code}=await ok('/family/codes',parent,'POST');await ok('/family/claim',child,'POST',{code});const l=(await ok('/family',parent)).links.find(l=>l.child_id===child.id);await ok(`/family/links/${l.id}/confirm`,parent,'POST',{confirm_parent:true});}
 async function chat(a,b){return (await ok('/private/conversations',a,'POST',a===b?{self:true}:{username:b.username})).conversation;}
 async function privateRequest(a,id,body,attachments=[]){const rs=await ok(`/private/conversations/${id}/roster`,a),clientId=randomUUID(),files=attachments.map(f=>f.id),ciphertext=await enc.seal(a.privateKey,rs.readers.map(r=>r.public_key),{version:1,kind:'private-message',conversationId:id,clientId,senderId:a.id,rosterHash:rs.roster_hash,selfEncrypted:rs.self_encrypted,body,attachments}),payload={conversationId:id,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files,sourceNest:null};return {...payload,ciphertext,signature:await enc.sign(a.privateKey,'private-send',payload)};}
 async function nestRequest(a,gid,body){const rs=await ok(`/groups/${gid}/e2ee/roster`,a),clientId=randomUUID(),ciphertext=await enc.seal(a.privateKey,rs.readers.map(r=>r.public_key),{version:1,kind:'nest-message',groupId:gid,clientId,senderId:a.id,signerId:a.id,rosterHash:rs.roster_hash,replyTo:null,migrated:false,selfEncrypted:rs.self_encrypted,contentType:'chat',body,attachments:[]}),proof=enc.sendPayload({groupId:gid,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files:[],replyTo:null});return {clientId,ciphertext,rosterHash:rs.roster_hash,files:[],reply_to:null,message_kind:'chat',signature:await enc.sign(a.privateKey,'send',proof)};}
 async function attachment(a){const raw=enc.bytes('Retained encrypted upload'),encrypted=await enc.encryptFile(raw),form=new FormData();form.append('file',new Blob([encrypted.encrypted]),'shared.pgp');const file=(await ok('/e2ee/uploads',a,'POST',form)).file;return {id:file.id,name:'shared.txt',mime:'text/plain',size:raw.length,key:encrypted.key,sha256:encrypted.sha256};}
 return {ok,req,actor,link,chat,privateRequest,nestRequest,attachment,dir,restart:async()=>{await stop();await start();},get db(){return runtime.db;}};
}
import {createHash,randomBytes} from 'node:crypto';
import {mobileScheme,nativeRoute,nativeCallback,backendPath,validateAppOrigin} from '../shared/mobile.js';
function pkce(){const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url');return {verifier,state,code_challenge:createHash('sha256').update(verifier).digest('base64url')};}
async function start(f,user,purpose='login',proof_nonce){const keys=pkce(),r=await f.ok('/native-auth/start',user,'POST',{purpose,platform:'ios',code_challenge:keys.code_challenge,state:keys.state,proof_nonce}),id=new URL(r.browser_url).pathname.split('/').at(-1),info=await f.ok(`/native-auth/browser/${id}`,null);return {...keys,id,info};}
async function browser(f,flow,sub='native-google-subject'){const r=await f.req(`/native-auth/browser/${flow.id}`,null,'POST',{credential:JSON.stringify({sub,email:sub+'@example.com',email_verified:true,nonce:flow.info.nonce,name:'Native Google member'})});if(r.status>=300)return r;return {...r,code:new URL(r.data.return_url).searchParams.get('code')};}
async function exchange(f,flow,completed,user=null,extra={}){return f.req('/native-auth/exchange',user,'POST',{code:completed.code,state:flow.state,verifier:flow.verifier,...extra},{origin:'capacitor://localhost','x-churp-client':'native'});}
test('native Google uses the system browser with PKCE; returning signs into the same account and existing keys',async t=>{
 const f=await fixture(t),a=await f.actor('native_existing');f.db.prepare('UPDATE users SET google_id=? WHERE id=?').run('native-google-subject',a.id);const before=(await f.ok('/e2ee/account',a)).identity.fingerprint;
 const flow=await start(f,null),completed=await browser(f,flow);assert.equal(completed.status,200);assert.equal(new URL(completed.data.return_url).protocol,mobileScheme+':');
 assert.equal((await exchange(f,flow,completed,null,{verifier:randomBytes(32).toString('base64url')})).status,403);assert.equal((await exchange(f,flow,completed,null,{state:randomBytes(32).toString('base64url')})).status,403);
 const result=await exchange(f,flow,completed);assert.equal(result.status,200);assert.equal(result.data.user.id,a.id);const logged={...a,cookie:result.cookie};assert.equal((await f.ok('/e2ee/account',logged)).identity.fingerprint,before);assert.equal((await exchange(f,flow,completed)).status,403);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
 assert.equal((await f.req('/auth/login',null,'POST',{username:a.username,password},{origin:'capacitor://localhost'})).status,403);assert.equal((await f.req('/auth/login',null,'POST',{username:a.username,password},{origin:'capacitor://localhost','x-churp-client':'native'})).status,200);assert.equal((await f.req('/auth/login',null,'POST',{username:a.username,password},{origin:'https://outside.invalid','x-churp-client':'native'})).status,403);
});
test('native Google signup is explicit and still requires private age and parent setup',async t=>{
 const f=await fixture(t),flow=await start(f,null),completed=await browser(f,flow);assert.equal((await exchange(f,flow,completed)).status,409);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
 const signup=await start(f,null,'signup'),proof=await browser(f,signup),r=await exchange(f,signup,proof);assert.equal(r.status,200);assert.equal(r.data.user.family.needs_setup,true);assert.equal((await f.req('/communities',{cookie:r.cookie})).status,403);
});
test('native linking and Google-only deletion remain bound to password proof, the requesting session and the same Google account',async t=>{
 const f=await fixture(t),a=await f.actor('native_link'),other=await f.actor('native_other');const proof=await f.ok('/me/google/challenge',a,'POST',{currentPassword:password}),flow=await start(f,a,'connect',proof.nonce),completed=await browser(f,flow);
 assert.equal((await exchange(f,flow,completed,other)).status,401);const r=await exchange(f,flow,completed,a);assert.equal(r.status,200);assert.equal(r.data.user.id,a.id);assert.equal(r.data.user.has_google,true);assert.equal((await f.req('/me',a)).status,401);a.cookie=r.cookie;
 f.db.prepare('UPDATE users SET password=NULL WHERE id=?').run(a.id);const deleteProof=await f.ok('/me/deletion/challenge',a,'POST'),del=await start(f,a,'delete',deleteProof.nonce);assert.equal((await browser(f,del,'wrong-google')).status,403);
 const next=await start(f,a,'delete',deleteProof.nonce),confirmed=await browser(f,next),result=await exchange(f,next,confirmed,a);assert.equal(result.status,200);assert.ok(result.data.deletion_token);assert.equal((await f.req('/me/deletion',other,'DELETE',{confirmation:'DELETE',deletion_token:result.data.deletion_token})).status,403);
 await f.ok('/me/deletion',a,'DELETE',{confirmation:'DELETE',deletion_token:result.data.deletion_token});assert.equal((await f.req('/me',a)).status,401);
});
test('native confirmation cannot survive logout during verification; Google nonces and completed callbacks are single-use',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),f=await fixture(t,{googleVerifyToken:async value=>{entered();await gate;return JSON.parse(value);}}),a=await f.actor('native_logout'),proof=await f.ok('/me/google/challenge',a,'POST',{currentPassword:password}),flow=await start(f,a,'connect',proof.nonce),pending=browser(f,flow);await started;await f.ok('/auth/logout',a,'POST');release();assert.equal((await pending).status,401);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM native_auth_requests').get().n,0);
 const next=await start(f,null,'signup'),completed=await browser(f,next);assert.equal(completed.status,200);assert.equal((await browser(f,next)).status,400);assert.equal((await f.req(`/native-auth/browser/${next.id}`,null,'POST',{credential:'{}'})).status,400);
});
test('native push honors foreground presence, unread badges, privacy, blocks, user ownership and session revocation',async t=>{
 const sent=[],providers={configured:{ios:true,android:true},send:async(sub,payload)=>sent.push({sub,payload})},f=await fixture(t,{nativePushProviders:providers}),a=await f.actor('native_sender'),b=await f.actor('native_recipient'),c=await f.chat(a,b),install=randomUUID(),token='ab'.repeat(32);
 await f.ok('/native-push/subscribe',b,'POST',{install_id:install,platform:'ios',token});await f.ok(`/private/conversations/${c.id}/messages`,a,'POST',await f.privateRequest(a,c.id,'Do not send plaintext to providers'));assert.equal(sent.length,0);
 await f.ok('/native-push/presence',b,'POST',{install_id:install,visible:false});await f.ok(`/private/conversations/${c.id}/messages`,a,'POST',await f.privateRequest(a,c.id,'Second encrypted private message'));assert.equal(sent.length,1);assert.equal(sent[0].payload.title,a.name);assert.equal(sent[0].payload.recipient_id,b.id);assert.equal(sent[0].payload.badge,2);assert.ok(!JSON.stringify(sent).includes('Second encrypted'));
 await f.ok('/me/notification-privacy',b,'PATCH',{show_previews:false});await f.ok(`/private/conversations/${c.id}/messages`,a,'POST',await f.privateRequest(a,c.id,'Private preview preference'));assert.equal(sent.at(-1).payload.title,'New message on Churp');
 assert.equal((await f.ok('/native-push/presence',a,'POST',{install_id:install,visible:false})).subscribed,false);await f.ok('/native-push/subscribe',a,'POST',{install_id:install,platform:'ios',token});assert.equal(f.db.prepare('SELECT user_id FROM native_push_subscriptions WHERE install_id=?').get(install).user_id,a.id);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM native_push_subscriptions WHERE user_id=?').get(b.id).n,0);
 await f.ok('/auth/logout',a,'POST');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM native_push_subscriptions WHERE install_id=?').get(install).n,0);
});
test('native links cannot navigate to foreign origins or inject network paths, and sync versions change after messages',async t=>{
 assert.equal(nativeRoute('https://outside.invalid/?conversation=secret'),null);assert.equal(nativeRoute('com.churptree.app://auth/callback?code=not-real'),null);assert.equal(nativeCallback('https://outside.invalid/auth/callback?state=x'),null);assert.equal(nativeRoute('https://app.churptree.com/i/ABCD2345EF'),'/?invite=ABCD2345EF');assert.throws(()=>backendPath('//outside.invalid'));assert.throws(()=>backendPath('/\\outside'));assert.throws(()=>validateAppOrigin('http://app.churptree.com'));assert.throws(()=>validateAppOrigin('https://name:password@app.churptree.com'));
 const f=await fixture(t),a=await f.actor('native_sync'),before=(await f.ok('/sync',a)).version;await f.ok('/communities',a,'POST',{name:'Sync Tree'});assert.notEqual((await f.ok('/sync',a)).version,before);assert.equal((await f.req('/sync',null)).status,401);
});
