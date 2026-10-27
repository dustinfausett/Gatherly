import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {holdMessage,messageOptions,openMessageOptions} from './message-options';
async function setup(page){
 await page.request.post('/api/auth/register',{data:{birth_date:'1990-01-01',username:`hold_${randomUUID().slice(0,8)}`,name:'Message keeper',password:'Hold message browser fixture!'}});
 const tree=(await(await page.request.post('/api/communities',{data:{name:'Message Tree'}})).json()).community,nest=(await(await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Quiet chat'}})).json()).group;
 await page.goto(`/?community=${tree.id}&group=${nest.id}`);await page.getByRole('textbox',{name:'Write a message',exact:true}).fill('Hold this message to see its options.');await page.getByRole('button',{name:'Send message',exact:true}).click();
 const message=page.locator('.conversation .message').filter({hasText:'Hold this message to see its options.'});await expect(message).toBeVisible();return {message,tree,nest};
}
test('chat stays uncluttered; a 750ms hold isolates one message with reactions above and actions below',async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));const {message}=await setup(page);
 await expect(page.getByRole('group',{name:'Quick reactions',exact:true})).toHaveCount(0);await expect(message.getByRole('button',{name:'Edit message',exact:true})).toHaveCount(0);await expect(message.locator('.message-meta strong')).toHaveText('You');await expect(message.locator('time')).toBeVisible();
 // Measure real mouse/touch timing instead of relying on a snapshot of the timer constant.
 await page.evaluate(()=>{window.holdStarted=0;window.holdElapsed=0;document.addEventListener('pointerdown',()=>{window.holdStarted=performance.now();},{once:true,capture:true});new MutationObserver((_,observer)=>{if(document.querySelector('.message-focus-card')){window.holdElapsed=performance.now()-window.holdStarted;observer.disconnect();}}).observe(document.body,{childList:true,subtree:true});});
 let dialog=await holdMessage(page,message.locator('.message-bubble'),info.project.name!=='desktop');
 expect(await page.evaluate(()=>window.holdElapsed)).toBeGreaterThanOrEqual(740);
 await expect(dialog.locator('.message-focus-preview .message-bubble')).toHaveText('Hold this message to see its options.');await expect(dialog.getByRole('group',{name:'Quick reactions',exact:true}).getByRole('button')).toHaveCount(4);
 const top=await dialog.locator('.reaction-quick').boundingBox(),body=await dialog.locator('.message-focus-preview').boundingBox(),bottom=await dialog.locator('.message-focus-actions').boundingBox();expect(top.y+top.height).toBeLessThanOrEqual(body.y);expect(bottom.y).toBeGreaterThanOrEqual(body.y+body.height);
 expect(await page.locator('#root').evaluate(root=>root.inert)).toBeTruthy();await dialog.getByRole('button',{name:'React with Heart',exact:true}).click();await expect(dialog.locator('.reaction-chip')).toHaveText('❤️1');await dialog.screenshot({path:info.outputPath('held-message.png')});
 await dialog.getByRole('button',{name:'Close message options',exact:true}).click();await expect(messageOptions(page)).toHaveCount(0);await expect(message.locator('.reaction-chip')).toHaveText('❤️1');await expect(message.getByRole('group',{name:'Quick reactions',exact:true})).toHaveCount(0);expect(await page.locator('#root').evaluate(root=>root.inert)).toBeFalsy();
 // Keyboard and desktop context-menu access use the same view. Editing dismisses it.
 dialog=await openMessageOptions(page,message);await dialog.getByRole('button',{name:'Edit message',exact:true}).click();await expect(messageOptions(page)).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Edit message',exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 dialog=await openMessageOptions(page,message);await dialog.press('Escape');await expect(messageOptions(page)).toHaveCount(0);await expect(message).toBeFocused();
 dialog=await openMessageOptions(page,message);await page.locator('.message-focus-backdrop').click({position:{x:3,y:3}});await expect(messageOptions(page)).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
});
test('short taps and moving to scroll do not open message actions',async({page})=>{
 const {message}=await setup(page);const bubble=message.locator('.message-bubble');await bubble.click();await expect(messageOptions(page)).toHaveCount(0);
 await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
 await bubble.dispatchEvent('pointerdown',{pointerId:7,pointerType:'touch',isPrimary:true,button:0,clientX:50,clientY:50});await page.clock.runFor(749);await expect(messageOptions(page)).toHaveCount(0);
 await bubble.dispatchEvent('pointermove',{pointerId:7,pointerType:'touch',isPrimary:true,clientX:50,clientY:75});await page.clock.runFor(1000);await expect(messageOptions(page)).toHaveCount(0);
 await bubble.dispatchEvent('pointerdown',{pointerId:8,pointerType:'touch',isPrimary:true,button:0,clientX:50,clientY:50});await bubble.dispatchEvent('pointerup',{pointerId:8,pointerType:'touch',isPrimary:true,button:0});await page.clock.runFor(1000);await expect(messageOptions(page)).toHaveCount(0);
 await bubble.dispatchEvent('pointerdown',{pointerId:9,pointerType:'touch',isPrimary:true,button:0,clientX:50,clientY:50});await bubble.dispatchEvent('pointercancel',{pointerId:9,pointerType:'touch',isPrimary:true});await page.clock.runFor(1000);await expect(messageOptions(page)).toHaveCount(0);
});
test('activity cards keep normal taps and open correctly from a held message',async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await setup(page);
 await page.getByRole('button',{name:'Add to chat',exact:true}).click();await page.getByRole('button',{name:'Poll',exact:true}).click();let poll=page.getByRole('dialog',{name:'Create a poll',exact:true});
 await poll.getByRole('textbox',{name:'Poll title',exact:true}).fill('A held poll');await poll.getByRole('textbox',{name:'Question 1',exact:true}).fill('Which day?');await poll.getByRole('textbox',{name:'Question 1, option 1',exact:true}).fill('Saturday');await poll.getByRole('textbox',{name:'Question 1, option 2',exact:true}).fill('Sunday');await poll.getByRole('button',{name:'Send poll',exact:true}).click();
 const message=page.locator('.conversation .message').filter({hasText:'A held poll'}),ballot=message.getByRole('button',{name:'Open poll: A held poll',exact:true});await ballot.click();poll=page.getByRole('dialog',{name:'A held poll',exact:true});await expect(poll).toBeVisible();await poll.getByRole('button',{name:'Close dialog',exact:true}).click();
 let dialog=await holdMessage(page,ballot,info.project.name!=='desktop');await expect(poll).toHaveCount(0);await dialog.getByRole('button',{name:'Open poll',exact:true}).click();await expect(messageOptions(page)).toHaveCount(0);await expect(poll).toBeVisible();expect(await page.locator('#root').evaluate(root=>root.inert)).toBeFalsy();await poll.getByRole('button',{name:'Close dialog',exact:true}).click();
 dialog=await openMessageOptions(page,message);await dialog.getByRole('button',{name:'Open poll: A held poll',exact:true}).click();await expect(messageOptions(page)).toHaveCount(0);await expect(poll).toBeVisible();expect(errors).toEqual([]);
});
