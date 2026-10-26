import { test,expect } from '@playwright/test';
import { createServer } from 'node:http';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createApp } from '../server/app.js';

test('verified recovery email and password changes/reset work through real account screens',async({browser},info)=>{
 const dir=mkdtempSync(join(tmpdir(),'churp-account-browser-')),mail=[],errors=[];let runtime;
 const server=createServer((req,res)=>runtime.app(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 runtime=createApp({dataDir:dir,testing:true,appUrl:base,pushEnabled:false,googleClientId:'',mailer:async message=>{mail.push(message);}});
 runtime.app.use(express.static(resolve('dist')));runtime.app.get('/{*path}',(req,res)=>res.sendFile(resolve('dist/index.html')));
 const context=await browser.newContext({...info.project.use,baseURL:base}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const username=`recover_${randomUUID().slice(0,8)}`,first='First browser password!',changed='Changed browser password!',reset='Reset browser password!';
 try{
  await context.request.post('/api/auth/register',{data:{birth_date:'1990-01-01',username,name:'Account owner',password:first}});await page.goto('/');await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'Account settings',exact:true}).click();
  let dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Recovery email',exact:true}).fill('owner@example.com');await dialog.getByLabel('Current password for email changes',{exact:true}).fill(first);await dialog.getByRole('button',{name:'Verify recovery email',exact:true}).click();await expect(dialog).toContainText('Check your inbox');
  const verify=mail.find(m=>m.subject.includes('Verify')).text.match(/http:\/\/\S+/)[0];await page.goto(verify);await expect(page.getByRole('heading',{name:'Verify your recovery email',exact:true})).toBeVisible();expect(page.url()).not.toContain('verify_email=');await page.getByRole('button',{name:'Verify email',exact:true}).click();await expect(page.getByRole('status')).toContainText('recovery email is verified');await page.getByRole('button',{name:'Continue to Churp',exact:true}).click();
  await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'Account settings',exact:true}).click();dialog=page.getByRole('dialog');await expect(dialog).toContainText('owner@example.com');await dialog.locator('summary').filter({hasText:'Change password'}).click();
  await dialog.getByLabel('Current password',{exact:true}).fill('wrong');await dialog.getByLabel('New password',{exact:true}).fill(changed);await dialog.getByLabel('Confirm new password',{exact:true}).fill(changed);await dialog.getByRole('button',{name:'Change password',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('current password is incorrect');await dialog.getByLabel('Current password',{exact:true}).fill(first);await dialog.getByRole('button',{name:'Change password',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Password changed');
  await page.screenshot({path:info.outputPath('password-and-recovery-settings.png'),fullPage:true});
  await dialog.getByRole('button',{name:'Back to your settings',exact:true}).click();await dialog.getByRole('button',{name:'Sign out of Churp',exact:true}).click();await expect(page.getByRole('button',{name:'Forgot password?',exact:true})).toBeVisible();await page.getByRole('button',{name:'Forgot password?',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Username or recovery email',exact:true}).fill(username);await dialog.getByRole('button',{name:'Send reset link',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('If this account');await expect.poll(()=>mail.filter(m=>m.subject.includes('Reset')).length).toBe(1);
  const link=mail.find(m=>m.subject.includes('Reset')).text.match(/http:\/\/\S+/)[0];await page.goto(link);await expect(page.getByRole('heading',{name:'Choose a new password',exact:true})).toBeVisible();expect(page.url()).not.toContain('reset_password=');await page.getByLabel('New password',{exact:true}).fill(reset);await page.getByLabel('Confirm new password',{exact:true}).fill(reset);await page.getByRole('button',{name:'Reset password',exact:true}).click();await expect(page.getByRole('status')).toContainText('password has been reset');await page.getByRole('button',{name:'Back to sign in',exact:true}).click();
  await page.getByRole('textbox',{name:'Username',exact:true}).fill(username);await page.getByLabel('Password',{exact:true}).fill(reset);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('button',{name:'Edit your profile',exact:true})).toBeVisible();
  expect((await context.request.post('/api/auth/login',{data:{username,password:changed}})).status()).toBe(401);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBeTruthy();
 }finally{await context.close();runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
