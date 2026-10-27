import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {BIRDS} from '../shared/birds.js';

async function setup(page){
 const result=await page.request.post('/api/auth/register',{data:{birth_date:'1990-01-01',name:'Pet keeper',username:`feed_${randomUUID().slice(0,8)}`,password:'A happy Churp feeding fixture!'}});expect(result.status()).toBe(201);
 const tree=(await(await page.request.post('/api/communities',{data:{name:'Our birds and friends'}})).json()).community,nest=(await(await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Pet chat'}})).json()).group;
 await page.goto(`/?community=${tree.id}`);await expect(page.getByRole('button',{name:'Feed Bluebird',exact:true})).toBeVisible();return {tree,nest};
}
test('all 13 pets eat generated food with continuously interpolated motion and can be fed again',async({page},info)=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);
 expect((await page.request.post('/api/me/birds/unlock',{data:{code:'Churp'}})).ok()).toBeTruthy();
 for(const bird of BIRDS){
  expect((await page.request.patch('/api/me',{data:{bird_id:bird.id}})).ok()).toBeTruthy();const button=page.getByRole('button',{name:`Feed ${bird.name}`,exact:true});await expect(button).toBeVisible();await expect(button.locator('[data-bird-id]')).toHaveAttribute('data-bird-id',bird.id);
  const box=await button.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);await button.click();await expect(button).toHaveAttribute('aria-busy','true');await expect(button).toBeDisabled();
  await expect.poll(()=>button.locator('.pet-feed-bird').evaluate(node=>node.getAnimations().length)).toBe(1);
  const motion=await button.evaluate(node=>{
   const body=node.querySelector('.pet-feed-bird'),animation=body.getAnimations()[0],frames=animation.effect.getKeyframes(),duration=animation.effect.getTiming().duration,matrices=[];
   for(const at of [.19,.20,.21]){animation.pause();animation.currentTime=duration*at;matrices.push(getComputedStyle(body).transform);}
   for(const animation of node.getAnimations({subtree:true})){animation.pause();animation.currentTime=duration*.25;}
   return {matrices,frames:frames.map(f=>f.easing),pose:node.querySelector('[data-bird-pose]').dataset.birdPose,duration,dishOpacity:Number(getComputedStyle(node.querySelector('.pet-feed-dish')).opacity)};
  });
  expect(new Set(motion.matrices).size).toBe(3);expect(motion.frames.every(e=>!e.includes('steps'))).toBeTruthy();expect(motion.pose).toBe('perched');expect(motion.duration).toBeGreaterThanOrEqual(3500);expect(motion.dishOpacity).toBeGreaterThan(.9);
  if(['blue','parrot','owl','hummingbird','christmas'].includes(bird.id))await page.locator('.community-banner').screenshot({path:info.outputPath(`feeding-${bird.id}.png`)});
  await expect(button.locator('.pet-feed-caption')).toHaveCount(0);await expect(button).not.toHaveAttribute('title');if(bird.id==='christmas')await expect(button).toHaveAttribute('data-food','candycanes');if(bird.id==='parrot')await expect(button).toHaveAttribute('data-food','fruit');if(bird.id==='hummingbird')await expect(button).toHaveAttribute('data-food','nectar');
  await button.evaluate(node=>{for(const animation of node.getAnimations({subtree:true})){animation.currentTime=animation.effect.getTiming().duration*.9;animation.play();}});
  await expect(button).toHaveAttribute('aria-busy','false');await expect(button).toBeEnabled();expect(await button.locator('.pet-feed-bird').evaluate(n=>getComputedStyle(n).transform)).toBe('none');await expect(page.getByRole('status').filter({hasText:`${bird.name} enjoyed`})).toBeAttached();
 }
 const again=page.getByRole('button',{name:'Feed Christmas Bird',exact:true});await again.focus();await page.keyboard.press('Enter');await expect(again).toHaveAttribute('aria-busy','true');await expect(again).toHaveAttribute('aria-busy','false',{timeout:8000});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
});

test('feeding respects reduced motion and leaving for a Nest cancels the snack cleanly',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});await setup(page);let button=page.getByRole('button',{name:'Feed Bluebird',exact:true});await button.click();await expect(button).toHaveAttribute('aria-busy','true');expect(await button.locator('.pet-feed-bird').evaluate(n=>n.getAnimations().length)).toBe(0);await expect(button.locator('.pet-feed-dish')).toHaveCSS('opacity','1');await expect(button).toHaveAttribute('aria-busy','false');
 await page.emulateMedia({reducedMotion:'no-preference'});await button.click();await expect.poll(()=>button.locator('.pet-feed-bird').evaluate(n=>n.getAnimations().length)).toBe(1);await page.getByRole('button',{name:'Open Nest Pet chat',exact:true}).click();await expect(page.getByRole('textbox',{name:'Write a message',exact:true})).toBeVisible();await expect(page.locator('.pet-feed-dish')).toHaveCount(0);await expect(page.locator('.bird-flight')).toHaveCount(0,{timeout:5000});await expect(page.locator('.resident-bird')).toHaveAttribute('data-bird-id','blue');
 await page.getByRole('button',{name:page.viewportSize().width>640?'Tree home':'Back to Tree',exact:true}).click();button=page.getByRole('button',{name:'Feed Bluebird',exact:true});await expect(button).toBeEnabled();expect(await button.locator('.pet-feed-bird').evaluate(n=>n.getAnimations().length)).toBe(0);expect(errors).toEqual([]);
});
