import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import express from 'express';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createApp} from '../server/app.js';
const password='Delete account browser password!';
async function fixture(browser,info){
 const dir=mkdtempSync(join(tmpdir(),'churp-backup-browser-'));let runtime;
 const server=createServer((req,res)=>runtime.app(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 runtime=createApp({dataDir:dir,testing:true,appUrl:base,pushEnabled:false,mailer:null,googleClientId:'test.apps.googleusercontent.com',googleVerifyToken:async v=>JSON.parse(v)});
 runtime.app.use(express.static(resolve('dist')));runtime.app.get('/{*path}',(req,res)=>res.sendFile(resolve('dist/index.html')));
 const context=await browser.newContext({...info.project.use,baseURL:base}),errors=[];
 await context.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'application/javascript',body:`window.google={accounts:{id:{initialize(o){this.o=o},renderButton(host){const o=this.o,b=document.createElement('button');b.textContent='Continue with Google';b.onclick=()=>o.callback({credential:JSON.stringify({sub:'delete-google',email:'delete@example.com',email_verified:true,nonce:o.nonce})});host.appendChild(b)}}}};`}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const register=async(username,birth_date='1990-01-01')=>(await(await context.request.post('/api/auth/register',{data:{username,name:username,password,birth_date}})).json()).user;
 return {runtime,page,context,register,errors,close:async()=>{await context.close();runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}};
}
async function settings(page){await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'Account settings',exact:true}).click();return page.getByRole('dialog',{name:'Account settings',exact:true});}
test('only the platform admin sees backup setup, verified status and the manual backup action',async({browser},info)=>{
 const f=await fixture(browser,info);try{
  const admin=await f.register('dustin');f.runtime.db.prepare('INSERT INTO report_reviewers VALUES (?)').run(admin.id);await f.page.goto('/');let d=await settings(f.page);await expect(d.getByRole('heading',{name:'Backups & recovery',exact:true})).toBeVisible();await expect(d).toContainText('Off-site backups aren’t connected yet.');await expect(d.getByRole('button',{name:'Back up now',exact:true})).toHaveCount(0);
  let state={enabled:true,configured:true,running:false,schedule:{hour:2,time_zone:'America/Denver',retention_days:30},last_verified_at:Date.now(),last_files:3,last_bytes:1048576,overdue:false};let runs=0;
  f.runtime.app.locals.backups={snapshot:()=>state,run:()=>{runs++;state={...state,running:true,phase:'uploading'};return state;}};
  await f.page.reload();d=await settings(f.page);await expect(d).toContainText('Backup verified');await expect(d).toContainText('Last downloaded and verified:');await expect(d).toContainText('3 uploads · 1.0 MB encrypted');await d.getByRole('heading',{name:'Backups & recovery',exact:true}).scrollIntoViewIfNeeded();await f.page.screenshot({path:info.outputPath('backup-verified.png'),fullPage:true});await d.getByRole('button',{name:'Back up now',exact:true}).click();await expect(d).toContainText('Backup in progress');await expect(d.getByRole('button',{name:'Back up now',exact:true})).toBeDisabled();expect(runs).toBe(1);
  await f.register('tree_admin');await f.context.request.post('/api/communities',{data:{name:'Tree Admin Scope'}});await f.page.goto('/');d=await settings(f.page);await expect(d.getByRole('heading',{name:'Backups & recovery',exact:true})).toHaveCount(0);expect((await f.context.request.get('/api/backups/status')).status()).toBe(404);expect(f.errors).toEqual([]);expect(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }finally{await f.close();}
});
