import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {openMessageOptions,chooseMessageAction,messageOptions} from './message-options';
async function register(request,name){const r=await request.post('/api/auth/register',{data:{birth_date:'1990-01-01',username:`react_${randomUUID().slice(0,8)}`,name,password:'Reaction browser fixture!'}});expect(r.status()).toBe(201);return (await r.json()).user;}
test('focused reactions retain five-per-user replacement, live counts, and private/thread support',async({page,browser},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const owner=await register(page.request,'Alex'),tree=(await(await page.request.post('/api/communities',{data:{name:'Reaction Tree'}})).json()).community;
 const nest=(await(await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Reaction Nest'}})).json()).group;
 const invite=await(await page.request.post('/api/invitations',{data:{community_id:tree.id}})).json();
 const other=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'});
 try{
  const peerUser=await register(other.request,'Sam');await other.request.post('/api/invitations/accept',{data:{token:invite.code}});await other.request.post(`/api/groups/${nest.id}/join`);
  const peer=await other.newPage();peer.on('pageerror',error=>errors.push(error.message));
  for(const p of [page,peer]){await p.goto(`/?community=${tree.id}&group=${nest.id}`);await expect(p.getByRole('textbox',{name:'Write a message',exact:true})).toBeVisible();}
  await page.getByRole('textbox',{name:'Write a message',exact:true}).fill('A message worth reacting to');await page.getByRole('button',{name:'Send message',exact:true}).click();
  const item=page.locator('.conversation .message').filter({hasText:'A message worth reacting to'}),peerItem=peer.locator('.conversation .message').filter({hasText:'A message worth reacting to'});await expect(peerItem).toBeVisible();
  await expect(item.getByRole('group',{name:'Quick reactions',exact:true})).toHaveCount(0);
  const id=await item.locator('.message-reactions').getAttribute('data-message-id'),row=await openMessageOptions(page,item);
  await expect(row.getByRole('group',{name:'Quick reactions',exact:true}).getByRole('button')).toHaveCount(4);
  const quick=(r,name)=>r.getByRole('button',{name:`React with ${name}`,exact:true});
  await quick(row,'Thumbs up').click();await expect(row.locator('.reaction-chip')).toHaveText('👍1');await expect(peerItem.locator('.reaction-chip')).toHaveText('👍1');
  const peerRow=await openMessageOptions(peer,peerItem);await quick(peerRow,'Thumbs up').click();await expect(row.locator('.reaction-chip')).toHaveText('👍2');
  await quick(row,'Thumbs up').click();await expect(row.locator('.reaction-chip')).toHaveText('👍1');await expect(quick(row,'Thumbs up')).toHaveAttribute('aria-pressed','false');
  for(const label of ['Thumbs up','Heart','Laughing']){await quick(row,label).click();await expect(quick(row,label)).toHaveAttribute('aria-pressed','true');}
  async function choose(label){await row.getByRole('button',{name:'More reactions',exact:true}).click();const picker=row.getByRole('dialog',{name:'Choose a reaction',exact:true});expect(await picker.getByRole('button').count()).toBeGreaterThan(50);await picker.getByRole('searchbox',{name:'Find an emoji',exact:true}).fill(label);await picker.getByRole('button',{name:label,exact:true}).click();}
  await choose('Party');await expect(row.locator('.reaction-chip[aria-pressed=true]')).toHaveCount(4);await choose('Bird');await expect(row.locator('.reaction-chip[aria-pressed=true]')).toHaveCount(5);
  await choose('Egg');await expect(row.locator('.reaction-chip[aria-pressed=true]')).toHaveCount(5);await expect(quick(row,'Thumbs up')).toHaveAttribute('aria-pressed','false');await expect(row.getByRole('button',{name:/^👍: 1 reaction from Sam$/})).toBeVisible();
  const state=(await(await page.request.get(`/api/reactions/nest/${id}`)).json()).states;expect(state.find(r=>r.user_id===owner.id).reaction_count).toBe(5);expect(state.find(r=>r.user_id===peerUser.id).reaction_count).toBe(1);expect(state.every(r=>r.body===null)).toBeTruthy();
  await quick(row,'Heart').click();await expect(row.locator('.reaction-chip[aria-pressed=true]')).toHaveCount(4);await quick(row,'Heart').click();await expect(row.locator('.reaction-chip[aria-pressed=true]')).toHaveCount(5);
  await row.getByRole('button',{name:'More reactions',exact:true}).click();await row.getByRole('dialog',{name:'Choose a reaction',exact:true}).screenshot({path:info.outputPath('emoji-reactions.png')});await row.getByRole('dialog',{name:'Choose a reaction',exact:true}).press('Escape');await expect(messageOptions(page)).toBeVisible();await expect(row.getByRole('dialog',{name:'Choose a reaction',exact:true})).toHaveCount(0);await row.screenshot({path:info.outputPath('message-options.png')});
  await row.getByRole('button',{name:'Close message options',exact:true}).click();await peerRow.getByRole('button',{name:'Close message options',exact:true}).click();
  await page.reload();await expect(item.locator('.reaction-chip[aria-pressed=true]')).toHaveCount(5);
  for(const p of [page,peer])await chooseMessageAction(p,p.locator('.conversation .message').filter({hasText:'A message worth reacting to'}),'Thread');
  await page.getByRole('textbox',{name:'Write a reply',exact:true}).fill('A reply with a reaction');await page.locator('.thread-panel').getByRole('button',{name:'Send message',exact:true}).click();
  const threadDialog=await openMessageOptions(page,page.locator('.thread-panel .message').filter({hasText:'A reply with a reaction'}));await quick(threadDialog,'Heart').click();await expect(peer.locator('.thread-panel .message').filter({hasText:'A reply with a reaction'}).locator('.reaction-chip')).toHaveText('❤️1');await threadDialog.getByRole('button',{name:'Close message options',exact:true}).click();
  const conversation=(await(await page.request.post('/api/private/conversations',{data:{user_id:peerUser.id}})).json()).conversation;
  for(const p of [page,peer]){await p.goto(`/?conversation=${conversation.id}`);await expect(p.getByRole('textbox',{name:'Write a private message',exact:true})).toBeVisible();}
  await page.getByRole('textbox',{name:'Write a private message',exact:true}).fill('Private reactions stay private');await page.getByRole('button',{name:'Send private message',exact:true}).click();
  const privateItem=page.locator('.private-message-item').filter({hasText:'Private reactions stay private'}),peerPrivate=peer.locator('.private-message-item').filter({hasText:'Private reactions stay private'});
  const privateDialog=await openMessageOptions(page,privateItem);await quick(privateDialog,'Heart').click();await expect(peerPrivate.locator('.reaction-chip')).toHaveText('❤️1');await expect(privateDialog.getByRole('button',{name:'Copy text',exact:true})).toBeVisible();await privateDialog.getByRole('button',{name:'Close message options',exact:true}).click();
  await page.reload();await expect(page.locator('.private-message-item .reaction-chip')).toHaveText('❤️1');await page.locator('.private-chat').screenshot({path:info.outputPath('private-reaction.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
 }finally{await other.close();}
});
