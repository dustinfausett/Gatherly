import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { hash } from '../server/security.js';

async function fixture(t,email=true){
 const dir=mkdtempSync(join(tmpdir(),'churp-account-security-')),mail=[];
 const runtime=createApp({dataDir:dir,testing:true,googleClientId:'',pushEnabled:false,appUrl:'https://app.churptree.com',mailer:email?async value=>{mail.push(value);}:null});
 const server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 t.after(async()=>{runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 async function req(path,cookie,method='GET',body,headers={}){const r=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function ok(...args){const r=await req(...args);assert.ok(r.status<300,JSON.stringify(r));return r;}
 async function register(username,extra={}){return ok('/auth/register',null,'POST',{username,name:username,password:'Initial account password!',...extra});}
 const link=kind=>new URL(mail.filter(m=>m.subject.includes(kind==='reset'?'Reset':'Verify')).at(-1).text.match(/https:\/\/\S+/)[0]);
 return {runtime,req,ok,register,mail,link};
}
test('password changes require the current password, rotate sessions and keep encryption identities',async t=>{
 const f=await fixture(t),a=await f.register('password_owner'),other=await f.ok('/auth/login',null,'POST',{username:'password_owner',password:'Initial account password!'});
 const device=(await f.ok('/e2ee/managed-device',a.cookie,'POST',{deviceId:'b3e721f6-a10e-4c2e-af32-ed544d5a3d02',deviceName:'Fixture'})).data;
 assert.equal((await f.req('/me/password',a.cookie,'POST',{currentPassword:'wrong',password:'New account password!'})).status,403);
 assert.equal((await f.req('/me/password',a.cookie,'POST',{currentPassword:'Initial account password!',password:'short'})).status,400);
 const changed=await f.ok('/me/password',a.cookie,'POST',{currentPassword:'Initial account password!',password:'New account password!'});
 assert.notEqual(changed.cookie,a.cookie);assert.equal((await f.req('/me',a.cookie)).status,401);assert.equal((await f.req('/me',other.cookie)).status,401);assert.equal((await f.req('/me',changed.cookie)).status,200);
 assert.equal((await f.req('/auth/login',null,'POST',{username:'password_owner',password:'Initial account password!'})).status,401);
 assert.equal((await f.ok('/e2ee/account',changed.cookie)).data.identity.fingerprint,device.identity.fingerprint);
 assert.equal(f.runtime.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(a.data.user.id).n,1);
 f.runtime.db.prepare("UPDATE users SET password=NULL,google_id='google-test' WHERE id=?").run(a.data.user.id);
 assert.equal((await f.req('/me/password',changed.cookie,'POST',{currentPassword:'New account password!',password:'Other account password!'})).status,400);
});
test('verified recovery email, single-use expiring links and password resets do not disclose account existence',async t=>{
 const f=await fixture(t),a=await f.register('recovery_owner'),b=await f.register('recovery_other');
 assert.equal((await f.req('/me/recovery-email',a.cookie,'POST',{email:'owner@example.com',currentPassword:'wrong'})).status,403);
 await f.ok('/me/recovery-email',a.cookie,'POST',{email:'Owner@Example.com',currentPassword:'Initial account password!'});
 assert.equal((await f.ok('/me',a.cookie)).data.user.recovery_email,null);
 await f.ok('/auth/forgot-password',null,'POST',{account:'recovery_owner'});assert.equal(f.mail.length,1);
 let verify=f.link('verify'),verificationToken=verify.searchParams.get('verify_email');assert.equal(verify.origin,'https://app.churptree.com');
 assert.ok(f.runtime.db.prepare('SELECT * FROM account_tokens WHERE token_hash=?').get(hash(verificationToken)));
 assert.ok(!JSON.stringify(f.runtime.db.prepare('SELECT * FROM account_tokens').all()).includes(verificationToken));
 await f.ok('/auth/verify-email',null,'POST',{token:verificationToken});assert.equal((await f.req('/auth/verify-email',null,'POST',{token:verificationToken})).status,400);
 const user=(await f.ok('/me',a.cookie)).data.user;assert.equal(user.recovery_email,'owner@example.com');assert.equal(user.recovery_email_verified,true);
 await f.ok('/me/recovery-email',b.cookie,'POST',{email:'different@example.com',currentPassword:'Initial account password!'});
 const oldVerify=f.link('verify').searchParams.get('verify_email');await f.ok('/me/recovery-email',b.cookie,'POST',{email:'new@example.com',currentPassword:'Initial account password!'});assert.equal((await f.req('/auth/verify-email',null,'POST',{token:oldVerify})).status,400);
 const before=f.mail.length,known=await f.ok('/auth/forgot-password',null,'POST',{account:'owner@example.com'}),unknown=await f.ok('/auth/forgot-password',null,'POST',{account:'nobody@example.com'});assert.deepEqual(known.data,unknown.data);assert.equal(f.mail.length,before+1);
 const resetToken=f.link('reset').searchParams.get('reset_password');assert.equal((await f.req('/auth/reset-password',null,'POST',{token:resetToken,password:'short'})).status,400);
 await f.ok('/auth/reset-password',null,'POST',{token:resetToken,password:'Reset account password!'});
 assert.equal((await f.req('/auth/reset-password',null,'POST',{token:resetToken,password:'Another account password!'})).status,400);assert.equal((await f.req('/me',a.cookie)).status,401);
 const login=await f.ok('/auth/login',null,'POST',{username:'recovery_owner',password:'Reset account password!'});
 await f.ok('/auth/forgot-password',null,'POST',{account:'recovery_owner'});const expired=f.link('reset').searchParams.get('reset_password');f.runtime.db.prepare('UPDATE account_tokens SET expires_at=0 WHERE token_hash=?').run(hash(expired));assert.equal((await f.req('/auth/reset-password',null,'POST',{token:expired,password:'Another account password!'})).status,400);
 await f.ok('/me/recovery-email',login.cookie,'DELETE',{currentPassword:'Reset account password!'});assert.equal((await f.ok('/me',login.cookie)).data.user.recovery_email,null);
 assert.equal((await f.req('/auth/forgot-password',null,'POST',{account:'recovery_owner'},{origin:'https://evil.example'})).status,403);
 assert.deepEqual(f.runtime.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('email recovery stays unavailable without delivery configuration while password changes remain available',async t=>{
 const f=await fixture(t,false),a=await f.register('no_email');assert.equal((await f.ok('/config')).data.recoveryEmailEnabled,false);
 assert.equal((await f.req('/auth/forgot-password',null,'POST',{account:'no_email'})).status,503);
 await f.ok('/me/password',a.cookie,'POST',{currentPassword:'Initial account password!',password:'Changed without an email!'});
});
