import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
const tab=(page,name)=>page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('button',{name,exact:true}).click();
async function register(context,name){const response=await context.request.post('/api/auth/register',{data:{birth_date:'1990-01-01',username:`badge_${randomUUID().slice(0,8)}`,name,password:'Badge browser fixture!'}});expect(response.status()).toBe(201);return (await response.json()).user;}
test('Home Screen badge follows private message reads, logout without disrupting chat',async({page,browser},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await register(page.context(),'Badge reader');
 await page.addInitScript(()=>{window.badgeFixture={sets:[],clears:0};Object.defineProperty(navigator,'setAppBadge',{configurable:true,value:async count=>window.badgeFixture.sets.push(count)});Object.defineProperty(navigator,'clearAppBadge',{configurable:true,value:async()=>{window.badgeFixture.clears++;}});});
 const tree=(await(await page.request.post('/api/communities',{data:{name:'Badge Tree'}})).json()).community,share=(await(await page.request.post('/api/invitations',{data:{community_id:tree.id}})).json());
 const senderContext=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'});
 try{
  const sender=await register(senderContext,'Badge sender');await senderContext.request.post('/api/invitations/accept',{data:{token:share.code}});const peer=await senderContext.newPage();await peer.goto('/');await page.goto('/');await expect.poll(()=>page.evaluate(()=>window.badgeFixture.clears)).toBeGreaterThan(0);
  await tab(peer,'Messages');await peer.getByRole('button',{name:'Compose',exact:true}).click();await peer.getByRole('button',{name:/New Message/}).click();await peer.getByRole('dialog').getByRole('button').filter({has:peer.getByText('Badge reader',{exact:true})}).click();await peer.getByRole('textbox',{name:'Write a private message',exact:true}).fill('A new message for your Home Screen badge.');await peer.getByRole('button',{name:'Send private message',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.badgeFixture.sets.at(-1))).toBe(1);
  const cleared=await page.evaluate(()=>window.badgeFixture.clears);await tab(page,'Messages');await page.getByRole('button',{name:'Open private conversation with Badge sender',exact:true}).click();await expect(page.locator('.private-bubble')).toContainText('A new message for your Home Screen badge.');await expect.poll(()=>page.evaluate(()=>window.badgeFixture.clears)).toBeGreaterThan(cleared);
  const before=await page.evaluate(()=>window.badgeFixture.clears);await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'Sign out of Churp',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.badgeFixture.clears)).toBeGreaterThan(before);expect(sender.id).toBeTruthy();expect(errors).toEqual([]);
 }finally{await senderContext.close();}
});
test('the manifest and iPhone touch icon point to the new green bird-and-nest artwork',async({page})=>{
 await page.goto('/');await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href','/icons/churp-home-apple.png');
 const manifest=await(await page.request.get('/manifest.webmanifest')).json();expect(manifest.id).toBe('/');expect(manifest.icons.map(i=>i.src)).toEqual(['/icons/churp-home-192.png','/icons/churp-home-512.png','/icons/churp-home-maskable-512.png']);
 for(const [path,size] of [['/icons/churp-home-192.png',192],['/icons/churp-home-512.png',512],['/icons/churp-home-apple.png',180]])expect(await page.evaluate(async({path})=>{const image=new Image();image.src=path;await image.decode();return image.naturalWidth;},{path})).toBe(size);
});
