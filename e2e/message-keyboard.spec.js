import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {chooseMessageAction} from './message-options';

async function register(ctx,name){const r=await ctx.request.post('/api/auth/register',{data:{birth_date:'1990-01-01',username:`keys_${randomUUID().slice(0,8)}`,name,password:'Message keyboard fixture!'}});expect(r.status()).toBe(201);return (await r.json()).user;}
async function setup(page,browser,info){
 await register(page.context(),'Keyboard owner');const tree=(await(await page.request.post('/api/communities',{data:{name:'Keyboard Tree'}})).json()).community,nest=(await(await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Keyboard Nest'}})).json()).group,invite=(await(await page.request.post('/api/invitations',{data:{community_id:tree.id}})).json());
 const peerContext=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'}),peer=await register(peerContext,'Avery Brown');await peerContext.request.post('/api/invitations/accept',{data:{token:invite.code}});
 return {tree,nest,peer,peerContext,close:()=>peerContext.close()};
}
test('Nest, thread and private composers use desktop Enter to send and phone Enter for new lines',async({page,browser},info)=>{
 const f=await setup(page,browser,info),mobile=info.project.name!=='desktop',errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`/?community=${f.tree.id}&group=${f.nest.id}`);const input=page.getByRole('textbox',{name:'Write a message',exact:true});await expect(input).toBeVisible();
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/messages'))writes++;});
  await input.fill('Nest first line');await input.press('Shift+Enter');await input.press('End');await input.press('N');await expect(input).toHaveValue('Nest first line\nN');expect(writes).toBe(0);
  await input.press('Enter');
  if(mobile){await expect(input).toHaveValue('Nest first line\nN\n');expect(writes).toBe(0);await page.locator('.chat-bottom .composer').getByRole('button',{name:'Send message',exact:true}).click();}
  await expect(page.locator('.conversation .message-bubble').filter({hasText:'Nest first line'})).toBeVisible();await expect(input).toHaveValue('');expect(writes).toBe(1);
  await chooseMessageAction(page,page.locator('.conversation .message').filter({hasText:'Nest first line'}),'Thread');const reply=page.getByRole('textbox',{name:'Write a reply',exact:true});await expect(reply).toBeVisible();
  await reply.fill('Thread first line');await reply.press('Shift+Enter');await reply.press('X');await reply.press('Enter');
  if(mobile){await expect(reply).toHaveValue('Thread first line\nX\n');expect(writes).toBe(1);await page.locator('.thread-panel').getByRole('button',{name:'Send message',exact:true}).click();}
  await expect(page.locator('.thread-messages .message-bubble').filter({hasText:'Thread first line'})).toBeVisible();await expect(reply).toHaveValue('');expect(writes).toBe(2);
  const conversation=(await(await page.request.post('/api/private/conversations',{data:{user_id:f.peer.id}})).json()).conversation;await page.goto(`/?conversation=${conversation.id}`);
  const privateInput=page.getByRole('textbox',{name:'Write a private message',exact:true});await privateInput.fill('Private first line');await privateInput.press('Shift+Enter');await privateInput.press('P');await privateInput.press('Enter');
  if(mobile){await expect(privateInput).toHaveValue('Private first line\nP\n');expect(writes).toBe(2);await page.getByRole('button',{name:'Send private message',exact:true}).click();}
  await expect(page.locator('.private-bubble').filter({hasText:'Private first line'})).toBeVisible();await expect(privateInput).toHaveValue('');expect(writes).toBe(3);
  // A narrow desktop window must retain the computer keyboard behavior.
  if(!mobile){await page.setViewportSize({width:390,height:844});await privateInput.fill('A narrow computer window');await privateInput.press('Enter');await expect(page.locator('.private-bubble').filter({hasText:'A narrow computer window'})).toBeVisible();expect(writes).toBe(4);}
  await privateInput.focus();await privateInput.press('Enter');expect(writes).toBe(mobile?3:4);
  expect(errors).toEqual([]);
 }finally{await f.close();}
});

test('mass-message Enter opens review then confirms on desktop, while phones require buttons',async({page,browser},info)=>{
 const f=await setup(page,browser,info),mobile=info.project.name!=='desktop';
 try{
  await page.goto('/');await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('button',{name:'Messages',exact:true}).click();await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('button',{name:/Send Many Individually/}).click();let d=page.getByRole('dialog');await d.getByRole('checkbox',{name:/Avery Brown/}).check();await d.getByRole('button',{name:'Next',exact:true}).click();
  const input=d.getByLabel('Your message',{exact:true});await input.fill('Hi [first name],');await input.press('Shift+Enter');await input.press('B');
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/messages'))writes++;});
  if(mobile){await input.press('Enter');await expect(input).toHaveValue('Hi [first name],\nB\n');await expect(d.getByRole('heading',{name:'Write your message',exact:true})).toBeVisible();expect(writes).toBe(0);await d.getByRole('button',{name:'Review',exact:true}).click();}
  else{await input.focus();await page.keyboard.down('Enter');await expect(d.getByRole('heading',{name:'Review & send',exact:true})).toBeVisible();await page.keyboard.down('Enter');await page.keyboard.up('Enter');expect(writes).toBe(0);}
  await expect(d.locator('.personalized-recipient-preview')).toContainText('Hi Avery,');expect(writes).toBe(0);
  const confirm=d.getByRole('button',{name:'Send 1 private messages',exact:true});
  if(mobile)await confirm.click();else{await expect(confirm).toBeFocused();await page.keyboard.press('Enter');}
  await expect(d).toContainText('Avery Brown · Sent');expect(writes).toBe(1);
  const conversation=(await(await page.request.get('/api/private/conversations')).json()).conversations[0],peerPage=await f.peerContext.newPage();await peerPage.goto(`/?conversation=${conversation.id}`);await expect(peerPage.locator('.private-bubble')).toContainText('Hi Avery,');await expect(peerPage.locator('.private-bubble')).not.toContainText('[first name]');await peerPage.close();
 }finally{await f.close();}
});
