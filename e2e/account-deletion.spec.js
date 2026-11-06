import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import express from 'express';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createApp} from '../server/app.js';
const password='Delete account browser password!';
async function fixture(browser,info){
 const dir=mkdtempSync(join(tmpdir(),'churp-delete-browser-'));let runtime;
 const server=createServer((req,res)=>runtime.app(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 runtime=createApp({dataDir:dir,testing:true,appUrl:base,pushEnabled:false,mailer:null,googleClientId:'test.apps.googleusercontent.com',googleVerifyToken:async v=>JSON.parse(v)});
 runtime.app.use(express.static(resolve('dist')));runtime.app.get('/{*path}',(req,res)=>res.sendFile(resolve('dist/index.html')));
 const context=await browser.newContext({...info.project.use,baseURL:base}),errors=[];
 await context.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'application/javascript',body:`window.google={accounts:{id:{initialize(o){this.o=o},renderButton(host){const o=this.o,b=document.createElement('button');b.textContent='Continue with Google';b.onclick=()=>o.callback({credential:JSON.stringify({sub:'delete-google',email:'delete@example.com',email_verified:true,nonce:o.nonce})});host.appendChild(b)}}}};`}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const register=async(username,birth_date='1990-01-01')=>(await(await context.request.post('/api/auth/register',{data:{username,name:username,password,birth_date}})).json()).user;
 return {runtime,page,context,register,errors,close:async()=>{await context.close();runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}};
}
async function dialog(page){await page.getByRole('button',{name:'Delete my account',exact:true}).click();return page.getByRole('dialog',{name:'Delete your account',exact:true});}
async function finish(d){await d.getByLabel('Current password to delete account',{exact:true}).fill(password);await d.getByLabel('Type DELETE to confirm',{exact:true}).fill('DELETE');await d.getByRole('button',{name:'Permanently delete account',exact:true}).click();}
test('account settings transfers ownership and leaves the exclusive Unknown crow on retained Nest history',async({browser},info)=>{
 const f=await fixture(browser,info);try{
  const other=await f.register('remaining_member'),owner=await f.register('departing_owner');
  const tree=(await(await f.context.request.post('/api/communities',{data:{name:'Retained Tree'}})).json()).community;
  const nest=(await(await f.context.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Retained Nest'}})).json()).group;
  f.runtime.db.prepare("INSERT INTO community_members VALUES (?,?,'member')").run(tree.id,other.id);
  f.runtime.db.prepare('INSERT INTO group_members (group_id,user_id) VALUES (?,?)').run(nest.id,other.id);
  const url=`/?community=${tree.id}&group=${nest.id}`;await f.page.goto(url);
  await f.page.getByRole('textbox',{name:'Write a message',exact:true}).fill('Shared history remains after account deletion');await f.page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(f.page.locator('.message-bubble').filter({hasText:'Shared history remains after account deletion'})).toBeVisible();
  await f.page.getByRole('button',{name:'Edit your profile',exact:true}).click();await f.page.getByRole('button',{name:'Account settings',exact:true}).click();const d=await dialog(f.page);
  await expect(d.getByRole('img',{name:'Crow profile for deleted accounts'})).toBeVisible();await expect(d.getByRole('button',{name:'Permanently delete account'})).toBeDisabled();
  await d.getByLabel('New owner for Retained Tree',{exact:true}).selectOption(other.id);
  await d.getByLabel('Current password to delete account',{exact:true}).fill('incorrect');await d.getByLabel('Type DELETE to confirm',{exact:true}).fill('DELETE');await d.getByRole('button',{name:'Permanently delete account'}).click();await expect(d.getByRole('alert')).toContainText('incorrect');
  const bounds=await d.boundingBox();for(const button of await d.locator('.form-footer button').all()){const box=await button.boundingBox();expect(box.x).toBeGreaterThanOrEqual(bounds.x);expect(box.x+box.width).toBeLessThanOrEqual(bounds.x+bounds.width+1);}
  await f.page.screenshot({path:info.outputPath('account-deletion-confirmation.png'),fullPage:true});await finish(d);
  await expect(f.page.getByRole('heading',{name:'Welcome home.',exact:true})).toBeVisible();expect(f.runtime.db.prepare('SELECT owner_id FROM communities WHERE id=?').get(tree.id).owner_id).toBe(other.id);
  await f.context.request.post('/api/auth/login',{data:{username:other.username,password}});await f.page.goto(url);
  const message=f.page.locator('.message').filter({hasText:'Shared history remains after account deletion'});await expect(message).toContainText('Unknown');await expect(message.locator('[data-avatar-choice="deleted-crow"]')).toBeVisible();expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('Google-only accounts confirm their linked Google account again before deletion',async({browser},info)=>{
 const f=await fixture(browser,info);try{const u=await f.register('google_delete');f.runtime.db.prepare('UPDATE users SET password=NULL,google_id=? WHERE id=?').run('delete-google',u.id);await f.page.goto('/?delete_account=1');const d=f.page.getByRole('dialog',{name:'Delete your account',exact:true});await expect(d).toBeVisible();await d.getByLabel('Type DELETE to confirm').fill('DELETE');await expect(d.getByRole('button',{name:'Permanently delete account'})).toBeDisabled();await d.getByRole('button',{name:'Confirm with Google',exact:true}).click();await d.getByRole('button',{name:'Continue with Google',exact:true}).click();await expect(d.getByRole('status')).toHaveText('Google account confirmed.');await d.getByRole('button',{name:'Permanently delete account'}).click();await expect(f.page.getByRole('heading',{name:'Welcome home.',exact:true})).toBeVisible();expect(f.runtime.db.prepare('SELECT google_id,deleted_at FROM users WHERE id=?').get(u.id)).toMatchObject({google_id:null,deleted_at:expect.any(Number)});expect(f.errors).toEqual([]);}finally{await f.close();}
});
test('youth can delete during parent setup and the public request page is accessible signed out',async({browser},info)=>{
 const f=await fixture(browser,info);try{await f.register('youth_delete',`${new Date().getUTCFullYear()-15}-01-01`);await f.page.goto('/');await expect(f.page.getByRole('heading',{name:'Link your parent account',exact:true})).toBeVisible();await finish(await dialog(f.page));await expect(f.page.getByRole('heading',{name:'Welcome home.',exact:true})).toBeVisible();await f.page.goto('/delete-account');await expect(f.page.getByRole('heading',{name:'Delete your Churp account',exact:true})).toBeVisible();await expect(f.page.getByRole('link',{name:'Sign in to delete your account',exact:true})).toBeVisible();expect(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(f.errors).toEqual([]);}finally{await f.close();}
});
test('a signed-in account can delete without recovering its self-managed message keys',async({browser},info)=>{
 const f=await fixture(browser,info);try{const u=await f.register('locked_delete');await f.context.request.post('/api/e2ee/managed-device',{data:{deviceId:crypto.randomUUID(),deviceName:'Previous device'}});f.runtime.db.prepare("UPDATE e2ee_identities SET custody='self' WHERE user_id=?").run(u.id);f.runtime.db.prepare('DELETE FROM e2ee_managed_keys WHERE user_id=?').run(u.id);await f.page.goto('/');await expect(f.page.getByRole('heading',{name:'Unlock this device',exact:true})).toBeVisible();await finish(await dialog(f.page));await expect(f.page.getByRole('heading',{name:'Welcome home.',exact:true})).toBeVisible();expect(f.errors).toEqual([]);}finally{await f.close();}
});
