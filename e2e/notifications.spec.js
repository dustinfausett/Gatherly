import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
async function setup(page,permission='default',off=false){
 const r=await page.request.post('/api/auth/register',{data:{birth_date:'1990-01-01',username:`push_${randomUUID().slice(0,8)}`,name:'Notification fixture',password:'Device notification fixture!'}});expect(r.status()).toBe(201);const user=(await r.json()).user;
 await page.addInitScript(({permission,off,id})=>{
  window.pushFixture={requests:0,subscriptions:0,posts:0,deletes:0};let allowed=permission,subscription=null;
  Object.defineProperty(window,'Notification',{configurable:true,value:{get permission(){return allowed;},requestPermission:async()=>{window.pushFixture.requests++;allowed='granted';return allowed;}}});
  Object.defineProperty(window,'PushManager',{configurable:true,value:function(){}});
  const reg={active:{},pushManager:{getSubscription:async()=>subscription,subscribe:async()=>{window.pushFixture.subscriptions++;subscription={endpoint:'https://fcm.googleapis.com/fake-churp-device',toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'fixture',auth:'fixture'}};},unsubscribe:async()=>{subscription=null;return true;}};return subscription;}}};
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>reg,getRegistration:async()=>reg,ready:Promise.resolve(reg)}});
  if(off)localStorage.setItem(`churp:device-notifications:${id}`,JSON.stringify({enabled:false}));
 },{permission,off,id:user.id});
 await page.route('**/api/config',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({response,json:{...body,vapidPublicKey:'B'.repeat(87)}});});
 await page.route('**/api/push/subscribe',async route=>{await page.evaluate(method=>{window.pushFixture[method==='DELETE'?'deletes':'posts']++;},route.request().method());await route.fulfill({json:{ok:true}});});
 await page.goto('/');await expect(page.getByRole('button',{name:'Edit your profile',exact:true})).toBeVisible();return user;
}
async function settings(page){await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'Notifications',exact:true}).click();}
test('default-on notifications require a permission tap, and turning them off persists on this device',async({page})=>{
 const user=await setup(page);await expect(page.getByRole('complementary',{name:'Enable device notifications',exact:true})).toBeVisible();expect(await page.evaluate(()=>window.pushFixture)).toMatchObject({requests:0,subscriptions:0,posts:0});
 await page.getByRole('button',{name:'Enable notifications',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.pushFixture.posts)).toBe(1);expect(await page.evaluate(()=>window.pushFixture)).toMatchObject({requests:1,subscriptions:1});await expect(page.getByRole('complementary',{name:'Enable device notifications',exact:true})).toHaveCount(0);
 await settings(page);await page.getByRole('button',{name:'Turn off device notifications',exact:true}).click();await expect(page.getByRole('status')).toContainText('off for this browser');expect(await page.evaluate(id=>JSON.parse(localStorage.getItem(`churp:device-notifications:${id}`)).enabled,user.id)).toBe(false);expect(await page.evaluate(()=>window.pushFixture.deletes)).toBe(1);
});
test('already-approved devices connect automatically; explicit device opt-out prevents reconnection',async({page})=>{
 await setup(page,'granted');await expect.poll(()=>page.evaluate(()=>window.pushFixture.posts)).toBe(1);expect(await page.evaluate(()=>window.pushFixture.requests)).toBe(0);
});
test('a saved opt-out is respected even with browser permission granted',async({page})=>{
 await setup(page,'granted',true);await settings(page);await expect(page.getByRole('button',{name:'Enable device notifications',exact:true})).toBeVisible();expect(await page.evaluate(()=>window.pushFixture)).toMatchObject({requests:0,subscriptions:0,posts:0});
});
test('a subscribed device reports visible, hidden and visible-again presence without changing other devices',async({page})=>{
 const updates=[];await page.route('**/api/push/presence',async route=>{updates.push(route.request().postDataJSON());await route.fulfill({json:{ok:true}});});
 await setup(page,'granted');await expect.poll(()=>updates.at(-1)?.visible).toBe(true);expect(updates[0].endpoint).toBe('https://fcm.googleapis.com/fake-churp-device');
 const client=updates[0].client_id;await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>updates.at(-1)?.visible).toBe(false);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>updates.at(-1)?.visible).toBe(true);expect(updates.every(x=>x.client_id===client)).toBe(true);
});
