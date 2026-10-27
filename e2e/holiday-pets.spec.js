import {randomUUID} from 'node:crypto';
import {test,expect} from '@playwright/test';
import {BIRDS,birdIsVisible,birdIsAvailable} from '../shared/birds.js';
const pets=BIRDS.filter(b=>b.seasonal&&birdIsAvailable(b));

test('ordinary users can select, feed and fly with each in-season holiday pet',async({page},info)=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const credentials={username:`holiday_${randomUUID().slice(0,8)}`,password:'Seasonal birds browser fixture!'};
 const registration=await page.request.post('/api/auth/register',{data:{...credentials,birth_date:'1990-01-01',name:'Holiday keeper'}});
 expect(registration.status()).toBe(201);
 const tree=(await(await page.request.post('/api/communities',{data:{name:`Holiday pets ${info.project.name}`}})).json()).community;
 await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Holiday chat'}});
 // Observe all flight poses so a working perch alone cannot pass this check.
 await page.addInitScript(()=>{
  window.holidayPoses={};addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{
   const bird=document.querySelector('.bird-flight [data-bird-id]'),pose=bird?.querySelector('[data-bird-pose]')?.dataset.birdPose;
   if(pose){window.holidayPoses[bird.dataset.birdId] ||= [];if(!window.holidayPoses[bird.dataset.birdId].includes(pose))window.holidayPoses[bird.dataset.birdId].push(pose);}
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-bird-pose']}));
 });
 await page.goto(`/?community=${tree.id}`);
 const openPets=async()=>{await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'My pet',exact:true}).click();};
 await openPets();for(const bird of BIRDS.filter(b=>b.seasonal&&!birdIsVisible(b)))await expect(page.getByRole('radio',{name:bird.name,exact:true})).toHaveCount(0);for(const bird of pets)await expect(page.getByRole('radio',{name:bird.name,exact:true})).toBeEnabled();
 if(!birdIsVisible(BIRDS.find(b=>b.id==='christmas')))await expect(page.getByRole('radio',{name:'Christmas Bird',exact:true})).toHaveCount(0);
 await page.locator('.bird-picker').screenshot({path:info.outputPath('holiday-collection.png')});
 for(const [index,bird] of pets.entries()){
  if(index)await openPets();await page.getByRole('radio',{name:bird.name,exact:true}).check();await page.getByRole('button',{name:'Save pet',exact:true}).click();
  const feed=page.getByRole('button',{name:`Feed ${bird.name}`,exact:true});await expect(feed).toBeVisible();
  expect(await feed.evaluate(async node=>{const image=new Image();image.src=node.querySelector('image').getAttribute('href');await image.decode();return image.naturalWidth;})).toBe(1254);
  await feed.click();await expect.poll(()=>feed.locator('.pet-feed-bird').evaluate(n=>n.getAnimations().length)).toBe(1);
  const motion=await feed.evaluate(node=>{
   const body=node.querySelector('.pet-feed-bird'),birdMotion=body.getAnimations()[0],duration=birdMotion.effect.getTiming().duration,poses=[];
   for(const t of [.19,.20,.21]){birdMotion.pause();birdMotion.currentTime=duration*t;poses.push(getComputedStyle(body).transform);}
   for(const a of node.getAnimations({subtree:true})){a.pause();a.currentTime=duration*.25;}
   return {poses,duration,dishOpacity:getComputedStyle(node.querySelector('.pet-feed-dish')).opacity,pose:node.querySelector('[data-bird-pose]').dataset.birdPose};
  });
  expect(new Set(motion.poses).size).toBe(3);expect(motion.duration).toBe(3800);expect(motion.pose).toBe('perched');expect(Number(motion.dishOpacity)).toBeGreaterThan(.9);
  await page.locator('.community-banner').screenshot({path:info.outputPath(`feed-${bird.id}.png`)});
  await feed.evaluate(node=>{for(const a of node.getAnimations({subtree:true})){a.currentTime=a.effect.getTiming().duration*.9;a.play();}});await expect(feed).toBeEnabled();
  await expect(feed.locator('.pet-feed-caption')).toHaveCount(0);await expect(feed).not.toHaveAttribute('title');
  await page.getByRole('button',{name:'Open Nest Holiday chat',exact:true}).click();await expect(page.locator('.bird-flight [data-bird-id]')).toHaveAttribute('data-bird-id',bird.id);await expect(page.locator('.bird-flight')).toHaveCount(0);
  expect(await page.evaluate(id=>window.holidayPoses[id],bird.id)).toEqual(expect.arrayContaining(['up','down','landing']));
  await expect(page.locator('.resident-bird')).toHaveAttribute('data-bird-id',bird.id);
  await page.locator('.chat-header').screenshot({path:info.outputPath(`land-${bird.id}.png`)});
  await page.getByRole('button',{name:info.project.name==='desktop'?'Tree home':'Back to Tree',exact:true}).click();
 }
 if(pets.length){await page.reload();await expect(page.getByRole('button',{name:`Feed ${pets.at(-1).name}`,exact:true})).toBeVisible();}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
});
