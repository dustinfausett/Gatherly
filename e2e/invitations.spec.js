import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

async function register(context,name){const r=await context.request.post('/api/auth/register',{data:{birth_date:'1990-01-01',username:`invite_${randomUUID().slice(0,8)}`,name,password:'Invitation browser password!'}});expect(r.status()).toBe(201);return (await r.json()).user;}
async function navigation(page,info){if(info.project.name!=='desktop')await page.getByRole('button',{name:'Open navigation',exact:true}).click();}

test('Nest member invitations arrive live, require acceptance and preserve private history',async({page,browser},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await register(page.context(),'Tree owner');
 const tree=(await(await page.request.post('/api/communities',{data:{name:'Invitation Tree'}})).json()).community;
 const treeInvite=await(await page.request.post('/api/invitations',{data:{community_id:tree.id}})).json();
 const nest=(await(await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Birthday surprise',private:true}})).json()).group;
 await page.goto('/');const origin=new URL(page.url()).origin;
 const context=await browser.newContext({...info.project.use,baseURL:origin}),other=await browser.newContext({...info.project.use,baseURL:origin});
 try{
  const lynn=await register(context,'Lynn'),rory=await register(other,'Rory');for(const c of [context,other])await c.request.post('/api/invitations/accept',{data:{token:treeInvite.code}});
  const peer=await context.newPage(),decliner=await other.newPage();peer.on('pageerror',e=>errors.push(e.message));await peer.goto('/');await decliner.goto('/');
  await expect(peer.getByRole('button',{name:'Open Nest Birthday surprise',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Open Nest Birthday surprise',exact:true}).click();await page.getByRole('textbox',{name:'Write a message',exact:true}).fill('Earlier birthday secret');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.locator('.message-bubble')).toContainText('Earlier birthday secret');
  await page.getByRole('button',{name:'Nest information',exact:true}).click();await page.getByRole('button',{name:'Invite Tree members',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('checkbox',{name:'Invite Lynn',exact:true}).check();await dialog.getByRole('checkbox',{name:'Invite Rory',exact:true}).check();await dialog.getByRole('button',{name:'Send 2 invitations',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('2 invitations sent');await expect(dialog.getByRole('checkbox',{name:'Invite Lynn',exact:true})).toBeDisabled();
  await navigation(peer,info);await expect(peer.getByRole('button',{name:'Invitations',exact:true})).toHaveAccessibleDescription('1 pending invitations');await peer.getByRole('button',{name:'Invitations',exact:true}).click();
  await expect(peer.getByRole('dialog')).toContainText('Birthday surprise');await expect(peer.getByRole('dialog')).toContainText('Tree owner invited you');await peer.screenshot({path:info.outputPath('nest-invitation-inbox.png'),fullPage:true});
  await navigation(decliner,info);await decliner.getByRole('button',{name:'Invitations',exact:true}).click();await decliner.getByRole('button',{name:'Decline invitation to Birthday surprise',exact:true}).click();await expect(decliner.getByRole('dialog')).toContainText('No pending invitations');
  await peer.getByRole('button',{name:'Accept invitation to Birthday surprise',exact:true}).click();await expect(peer.getByRole('dialog')).toHaveCount(0);await expect(peer.locator('.chat-heading h1')).toHaveText('Birthday surprise');
  if((await(await page.request.get('/api/config')).json()).encryptionRequired){await expect(peer.getByText('Earlier birthday secret',{exact:true})).toHaveCount(0);expect((await(await context.request.get(`/api/groups/${nest.id}/messages`)).json()).messages).toHaveLength(0);}
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('button',{name:'Close Nest information',exact:true}).click();
  await page.getByRole('textbox',{name:'Write a message',exact:true}).fill('Welcome to the birthday Nest');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(peer.locator('.message-bubble').filter({hasText:'Welcome to the birthday Nest'})).toBeVisible();
  await peer.reload();await navigation(peer,info);await expect(peer.getByRole('button',{name:'Invitations',exact:true})).toHaveAccessibleDescription('0 pending invitations');expect(errors).toEqual([]);
 }finally{await context.close();await other.close();}
});

test('Tree sharing provides a scannable QR, short code and compact link on phones and desktop',async({page,browser},info)=>{
 await register(page.context(),'Tree owner');const tree=(await(await page.request.post('/api/communities',{data:{name:'Scan and join'}})).json()).community;await page.goto('/');await navigation(page,info);
 await page.getByRole('button',{name:'Invite someone to this Tree',exact:true}).click();await page.getByRole('button',{name:'Create invitation link',exact:true}).click();
 const d=page.getByRole('dialog');await expect(d.getByRole('img',{name:'Scan to join Scan and join',exact:true})).toBeVisible();await expect.poll(()=>d.locator('.invitation-qr').evaluate(img=>img.naturalWidth)).toBe(300);
 const code=await d.getByRole('textbox',{name:'Invitation code',exact:true}).inputValue(),link=await d.getByRole('textbox',{name:'Invitation link',exact:true}).inputValue();expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);expect(new URL(link).pathname).toBe('/i/'+code.replace('-',''));await expect(d.getByRole('link',{name:'Open invitation & sign in',exact:true})).toHaveAttribute('href',link);
 await page.screenshot({path:info.outputPath('share-tree-qr-and-code.png'),fullPage:true});
 const context=await browser.newContext({...info.project.use,baseURL:new URL(page.url()).origin});try{
  await register(context,'New friend');const peer=await context.newPage();await peer.goto('/');await navigation(peer,info);await peer.getByRole('button',{name:'Invitations',exact:true}).click();await peer.getByRole('textbox',{name:'Invitation link or code',exact:true}).fill(code.toLowerCase().replace('-',' '));await peer.getByRole('button',{name:'Accept invitation',exact:true}).click();await expect(peer.getByRole('dialog')).toHaveCount(0);await expect(peer.locator('.community-banner h1')).toHaveText('Scan and join');expect((await(await context.request.get('/api/communities')).json()).communities[0].id).toBe(tree.id);
  expect(await peer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }finally{await context.close();}
});
