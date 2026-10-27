import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BIRDS,birdIsAvailable } from '../shared/birds.js';
const availableBirds=BIRDS.filter(b=>birdIsAvailable(b));
const seasonalUnavailable=BIRDS.length-availableBirds.length;

const register = async (request,prefix) => {
  const r=await request.post('/api/auth/register',{data:{birth_date:'1990-01-01',username:`${prefix}_${randomUUID().slice(0,8)}`,name:'Bird watcher',password:'bird and tree browser password'}});
  expect(r.status()).toBe(201);return (await r.json()).user;
};

test('available pets, code redemption and matching flights',async({page},info)=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await register(page.request,'birds');
  const tree=(await (await page.request.post('/api/communities',{data:{name:'Our bird Tree'}})).json()).community;
  const nest=(await (await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Morning songs'}})).json()).group;
  await page.addInitScript(()=>{
    window.flightPoses={};window.flightLandings={};
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(...args){
      const animation=animate.apply(this,args);
      if(this.classList.contains('travelling-bird'))animation.addEventListener('finish',()=>{
        const moving=this.getBoundingClientRect(),resident=document.querySelector('.resident-bird').getBoundingClientRect();
        window.flightLandings[this.querySelector('[data-bird-id]').dataset.birdId]={dx:moving.x-resident.x,dy:moving.y-resident.y,dw:moving.width-resident.width,dh:moving.height-resident.height};
      });
      return animation;
    };
    addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{
      const bird=document.querySelector('.bird-flight [data-bird-id]');
      if(bird){const pose=bird.querySelector('[data-bird-pose]')?.dataset.birdPose;window.flightPoses[bird.dataset.birdId] ||= [];if(pose && !window.flightPoses[bird.dataset.birdId].includes(pose))window.flightPoses[bird.dataset.birdId].push(pose);}
    }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-bird-pose']}));
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'My pet',exact:true}).click();
  await expect(page.getByRole('radio')).toHaveCount(13);
  await expect(page.getByRole('radio',{name:'Bluebird',exact:true})).toBeChecked();
  await expect(page.getByRole('radio',{name:'Goldfinch',exact:true})).toBeEnabled();
  await expect(page.locator('.bird-picker input:disabled')).toHaveCount(10+seasonalUnavailable);
  await expect(page.getByRole('button',{name:'Purchases coming soon',exact:true})).toBeDisabled();
  await page.locator('.bird-choice').filter({has:page.getByRole('radio',{name:'Goldfinch',exact:true})}).click();
  await page.getByRole('button',{name:'Save pet',exact:true}).click();
  await expect(page.locator('.banner-bird [data-bird-id]')).toHaveAttribute('data-bird-id','gold');
  const second=await page.context().newPage();
  try {
    await second.goto('/');
    await expect(second.locator('.banner-bird [data-bird-id]')).toHaveAttribute('data-bird-id','gold');
    await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'My pet',exact:true}).click();
    await page.getByRole('textbox',{name:'Unlock code',exact:true}).fill('wrong');
    await page.getByRole('button',{name:'Redeem code',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('not recognized');
    await expect(page.getByRole('radio',{name:'Parrot',exact:true})).toBeDisabled();
    await page.getByRole('textbox',{name:'Unlock code',exact:true}).fill('Churp');
    await page.getByRole('button',{name:'Redeem code',exact:true}).click();
    await expect(page.locator('.bird-picker input:disabled')).toHaveCount(seasonalUnavailable);
    await expect(page.getByText('Your pet collection is unlocked.',{exact:true})).toBeVisible();
    await page.locator('.bird-choice').filter({has:page.getByRole('radio',{name:'Parrot',exact:true})}).click();
    await page.locator('.bird-picker').screenshot({path:info.outputPath('bird-collection.png')});
    await page.getByRole('button',{name:'Save pet',exact:true}).click();
    await expect(second.locator('.banner-bird [data-bird-id]')).toHaveAttribute('data-bird-id','parrot');
  } finally {await second.close();}
  for(const bird of availableBirds){
    await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'My pet',exact:true}).click();
    await page.locator('.bird-choice').filter({has:page.getByRole('radio',{name:bird.name,exact:true})}).click();
    await page.getByRole('button',{name:'Save pet',exact:true}).click();
    await expect(page.locator('.profile-button [data-avatar-choice]')).toHaveAttribute('data-avatar-choice','blue');
    await expect(page.locator('.banner-bird [data-bird-id]')).toHaveAttribute('data-bird-id',bird.id);
    await page.getByRole('button',{name:'Open Nest Morning songs',exact:true}).click();
    await expect(page.locator('.bird-flight [data-bird-id]')).toHaveAttribute('data-bird-id',bird.id);
    await expect(page.locator('.bird-flight')).toHaveCount(0);
    const poses=await page.evaluate(id=>window.flightPoses[id],bird.id);
    expect(poses).toEqual(expect.arrayContaining(['up','down','landing']));
    await expect(page.locator('.resident-bird')).toHaveAttribute('data-bird-id',bird.id);
    const landing=await page.evaluate(id=>window.flightLandings[id],bird.id);
    for(const difference of Object.values(landing))expect(Math.abs(difference)).toBeLessThan(1);
    const seat=await page.locator('.chat-landing-nest').evaluate(button=>{
      const bird=button.querySelector('.resident-bird>.churp-bird'),nest=button.querySelector('.landing-nest-art');
      const feet=new DOMPoint(256,440).matrixTransform(bird.getScreenCTM()),rim=new DOMPoint(288,350).matrixTransform(nest.getScreenCTM());
      const rect=button.getBoundingClientRect();return {depth:feet.y-rim.y,width:rect.width,height:rect.height};
    });
    expect(seat.depth).toBeGreaterThanOrEqual(0);expect(seat.depth).toBeLessThan(14);
    expect(seat.width).toBeGreaterThanOrEqual(44);expect(seat.height).toBeGreaterThanOrEqual(44);
    if(bird.id==='blue')await page.locator('.chat-header').screenshot({path:info.outputPath('bird-seated-in-nest.png')});
    if(info.project.name==='desktop')await page.getByRole('button',{name:'Tree home',exact:true}).click();
    else await page.getByRole('button',{name:'Back to Tree',exact:true}).click();
  }
  await page.reload();
  await expect(page.locator('.banner-bird [data-bird-id]')).toHaveAttribute('data-bird-id',availableBirds.at(-1).id);
  await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'My pet',exact:true}).click();
  await expect(page.getByRole('radio',{name:availableBirds.at(-1).name,exact:true})).toBeChecked();
  await expect(page.locator('.bird-picker input:disabled')).toHaveCount(seasonalUnavailable);
  for(const collection of ['meadow','canopy','woodland']){
    const size=await page.evaluate(async name=>{const img=new Image();img.src=`/brand/birds/${name}.png`;await img.decode();return img.naturalWidth;},collection);
    expect(size).toBeGreaterThan(1000);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('admin delete shortcuts and owner-only whole Tree deletion update other clients',async({page,browser},info)=>{
  await register(page.request,'delete_owner');
  const tree=(await (await page.request.post('/api/communities',{data:{name:'Tree to remove'}})).json()).community;
  const branch=(await (await page.request.post(`/api/communities/${tree.id}/subcommunities`,{data:{name:'Planning'}})).json()).subcommunity;
  const make=async data=>(await (await page.request.post(`/api/communities/${tree.id}/circles`,{data})).json()).group;
  const keep=await make({name:'Keep until Tree deletion',subcommunity_id:branch.id});
  const remove=await make({name:'Remove this Nest'});
  const guest=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3100'});
  try{
    const member=await register(guest.request,'delete_admin');
    const invitation=(await (await page.request.post('/api/invitations',{data:{community_id:tree.id}})).json()).path.split('invite=')[1];
    await guest.request.post('/api/invitations/accept',{data:{token:invitation}});
    await page.request.patch(`/api/communities/${tree.id}/members/${member.id}`,{data:{role:'admin'}});
    const gp=await guest.newPage();await gp.goto('/');
    await gp.locator('.community-banner').getByRole('button',{name:'Tree settings',exact:true}).click();
    await expect(gp.getByRole('button',{name:'Delete Tree',exact:true})).toHaveCount(0);
    await gp.getByRole('button',{name:'Close dialog',exact:true}).click();
    await gp.getByRole('button',{name:'Open Branch Planning',exact:true}).click();
    await gp.getByRole('button',{name:'Delete Branch Planning',exact:true}).click();
    await expect(gp.getByRole('dialog')).toContainText('Its Nests move to Tree level');
    await gp.locator('.delete-space-confirm input').fill('Planning');
    await gp.getByRole('button',{name:'Delete Branch',exact:true}).click();
    await expect(gp.getByRole('button',{name:`Open Nest ${keep.name}`,exact:true})).toBeVisible();
    await gp.getByRole('button',{name:`Options for ${remove.name}`,exact:true}).click();
    await gp.getByRole('button',{name:'Delete Nest',exact:true}).click();
    await gp.locator('.delete-space-confirm input').fill(remove.name);
    await gp.getByRole('button',{name:'Delete Nest',exact:true}).click();
    await expect(gp.getByRole('button',{name:`Open Nest ${remove.name}`,exact:true})).toHaveCount(0);
    await gp.getByRole('button',{name:`Open Nest ${keep.name}`,exact:true}).click();
    await expect(gp.locator('.chat-heading h1')).toHaveText(keep.name);
    await page.goto('/');
    await page.locator('.community-banner').getByRole('button',{name:'Tree settings',exact:true}).click();
    await page.getByRole('button',{name:'Delete Tree',exact:true}).click();
    const confirm=page.locator('.delete-space-confirm');
    await expect(confirm).toContainText('All Branches, Nests, messages');
    await expect(confirm.getByRole('button',{name:'Delete Tree',exact:true})).toBeDisabled();
    await confirm.locator('input').fill('wrong');
    await expect(confirm.getByRole('button',{name:'Delete Tree',exact:true})).toBeDisabled();
    await confirm.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('Edit Tree');
    await page.getByRole('button',{name:'Delete Tree',exact:true}).click();
    await confirm.locator('input').fill(tree.name);
    await page.screenshot({path:info.outputPath('delete-tree-confirmation.png'),fullPage:true});
    await confirm.getByRole('button',{name:'Delete Tree',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.community-banner')).toHaveCount(0);
    await expect(gp.locator('.chat-heading')).toHaveCount(0);
    await expect(gp.getByRole('button',{name:'Edit your profile',exact:true})).toBeVisible();
    expect((await page.request.get(`/api/communities/${tree.id}`)).status()).toBe(404);
    await page.reload();await expect(page.locator('.community-banner')).toHaveCount(0);
    expect((await page.request.get('/api/me')).status()).toBe(200);
  }finally{await guest.close();}
});
