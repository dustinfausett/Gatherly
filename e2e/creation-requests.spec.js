import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const picture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O2sAAAAASUVORK5CYII=','base64');
async function openRequests(page,project){
  if(project!=='desktop')await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:/^Creation requests/}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
test('members request Branches and Nests; admins review and configure immediate creation',async({page,browser},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const suffix=randomUUID().slice(0,8);
  await page.request.post('/api/auth/register',{data:{username:`reviewer_${suffix}`,name:'Tree admin',password:'approval browser password'}});
  const tree=(await (await page.request.post('/api/communities',{data:{name:'The test Tree'}})).json()).community;
  const branch=(await (await page.request.post(`/api/communities/${tree.id}/subcommunities`,{data:{name:'Family branch'}})).json()).subcommunity;
  const invite=(await (await page.request.post('/api/invitations',{data:{community_id:tree.id}})).json()).path.split('invite=')[1];
  const guest=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3100'});
  try{
    await guest.request.post('/api/auth/register',{data:{username:`requester_${suffix}`,name:'A member',password:'approval browser password'}});
    await guest.request.post('/api/invitations/accept',{data:{token:invite}});
    const gp=await guest.newPage();gp.on('pageerror',e=>errors.push(e.message));await gp.goto('/');await page.goto('/');
    await expect(gp.locator('.topbar').getByRole('button',{name:/^Notifications/})).toHaveCount(0);
    await gp.getByRole('button',{name:'New Branch',exact:true}).click();
    await gp.getByRole('textbox',{name:'Branch name',exact:true}).fill('Member Branch');
    await gp.getByRole('button',{name:'Submit for Approval',exact:true}).click();
    await expect(gp.getByRole('dialog')).toHaveCount(0);
    await expect(gp.getByRole('button',{name:'Open Branch Member Branch',exact:true})).toHaveCount(0);
    await gp.getByRole('button',{name:'Open Branch Family branch',exact:true}).click();
    await gp.getByRole('button',{name:'Add Nest to Family branch',exact:true}).click();
    await expect(gp.getByRole('combobox',{name:'Branch (optional)',exact:true})).toHaveValue(branch.id);
    await gp.getByRole('textbox',{name:'Nest name',exact:true}).fill('Member Nest');
    await gp.getByRole('textbox',{name:'Description',exact:true}).fill('A submitted description');
    await gp.locator('.avatar-editor input[type=file]').setInputFiles({name:'nest.png',mimeType:'image/png',buffer:picture});
    await expect(gp.locator('.avatar-editor img')).toBeVisible();
    await gp.getByRole('button',{name:'Submit for Approval',exact:true}).click();
    await expect(gp.getByRole('dialog')).toHaveCount(0);
    await openRequests(gp,info.project.name);
    await expect(gp.locator('.creation-request')).toHaveCount(2);
    await expect(gp.getByRole('button',{name:'Approve',exact:true})).toHaveCount(0);
    await gp.getByRole('button',{name:'Close dialog',exact:true}).click();
    await openRequests(page,info.project.name);
    const nest=page.locator('.creation-request').filter({has:page.getByRole('heading',{name:'Member Nest',exact:true})});
    await expect(nest).toContainText('A submitted description');
    await expect(nest.locator('img')).toBeVisible();
    await nest.getByRole('button',{name:'Approve',exact:true}).click();
    await expect(nest.locator('.request-status')).toHaveText('approved');
    const requestedBranch=page.locator('.creation-request').filter({has:page.getByRole('heading',{name:'Member Branch',exact:true})});
    await requestedBranch.getByRole('button',{name:'Decline',exact:true}).click();
    await expect(requestedBranch.locator('.request-status')).toHaveText('Declined');
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await expect(gp.getByRole('button',{name:'Open Nest Member Nest',exact:true})).toBeVisible();
    await gp.getByRole('button',{name:'Open Nest Member Nest',exact:true}).click();
    await expect(gp.getByRole('textbox',{name:'Write a message',exact:true})).toBeVisible();
    await gp.getByRole('textbox',{name:'Write a message',exact:true}).fill('Approved and ready');
    await gp.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(gp.locator('.message-bubble')).toContainText('Approved and ready');
    // Tree settings are distinct from a creator's scoped permissions.
    await page.locator('.community-banner').getByRole('button',{name:'Tree settings',exact:true}).click();
    await expect(page.getByRole('checkbox',{name:'Require approval for Branches',exact:true})).toBeChecked();
    await page.getByText('Require approval for Branches',{exact:true}).click();
    await page.getByText('Require approval for Nests',{exact:true}).click();
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    if(info.project.name!=='desktop')await gp.getByRole('button',{name:'Back to Nests',exact:true}).click();
    else await gp.getByRole('button',{name:'Tree home',exact:true}).click();
    await gp.getByRole('button',{name:'New Nest',exact:true}).click();
    await gp.getByRole('textbox',{name:'Nest name',exact:true}).fill('Immediate Nest');
    await expect(gp.getByRole('button',{name:'Create Nest',exact:true})).toBeVisible();
    await gp.getByRole('button',{name:'Create Nest',exact:true}).click();
    await expect(gp.getByRole('heading',{name:'Immediate Nest',exact:true})).toBeVisible();
    expect(errors).toEqual([]);
    expect(await gp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:info.outputPath('tree-with-approvals.png'),fullPage:true});
  }finally{await guest.close();}
});

test('Nest feedback, bird flight, keyboard return and reduced motion',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const suffix=randomUUID().slice(0,8);
  await page.request.post('/api/auth/register',{data:{username:`motion_${suffix}`,name:'Bird watcher',password:'bird journey password'}});
  const tree=(await (await page.request.post('/api/communities',{data:{name:'The Birdwatchers'}})).json()).community;
  await page.request.post(`/api/communities/${tree.id}/subcommunities`,{data:{name:'Planning'}});
  const nest=(await (await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Morning songs'}})).json()).group;
  await page.goto('/');
  await expect(page.locator('.banner-bird')).toBeVisible();
  await expect(page.locator('.banner-bird image')).toHaveAttribute('href','/brand/previews/churp-bird-poses.png');
  await expect(page.locator('.banner-bird [data-bird-pose]')).toHaveAttribute('data-bird-pose','perched');
  const title=await page.locator('.tree-banner-title h1').boundingBox();
  const perch=await page.locator('.banner-perch').boundingBox();
  expect(perch.x-title.x-title.width).toBeGreaterThanOrEqual(6);
  expect(perch.x-title.x-title.width).toBeLessThanOrEqual(14);
  // The perch moves with short/long names and responsive layout, keeping text clear.
  for(const name of ['Oak','The Birdwatchers and Their Extended Family Tree']) {
    await page.request.patch(`/api/communities/${tree.id}`,{data:{name}});
    await expect(page.locator('.tree-banner-title h1')).toHaveText(name);
    const bounds=await page.locator('.tree-banner-title h1').boundingBox();
    const branch=await page.locator('.banner-perch').boundingBox();
    expect(branch.x-bounds.x-bounds.width).toBeGreaterThanOrEqual(6);
    expect(branch.x-bounds.x-bounds.width).toBeLessThanOrEqual(14);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
  await page.request.patch(`/api/communities/${tree.id}`,{data:{name:'The Birdwatchers'}});
  await expect(page.locator('.tree-banner-title h1')).toHaveText('The Birdwatchers');
  await expect(page.locator('.branch-row-art')).toHaveCount(1);
  await expect(page.locator('.group-row .row-kind')).toHaveCount(0);
  await expect(page.locator('.group-row .circle-row-content')).toHaveCSS('background-color','rgb(233, 238, 219)');
  await expect(page.locator('.circle-row:not(.group-row) .circle-row-content')).toHaveCSS('background-color','rgb(238, 227, 211)');
  await expect(page.locator('.banner-branch-art')).toHaveCSS('background-image',/churp-branch/);
  const naturalWidth=await page.evaluate(async()=>{const img=new Image();img.src='/brand/churp-branch.png';await img.decode();return img.naturalWidth;});expect(naturalWidth).toBeGreaterThan(1000);
  await page.screenshot({path:info.outputPath('branch-and-bird-home.png'),fullPage:true});
  // Observe short feedback phases without depending on a test runner's click latency.
  await page.evaluate(()=>{
    window.motionPhases={pressed:false,flight:false};
    window.motionObserver=new MutationObserver(()=>{
      if(document.querySelector('.circle-row.is-opening'))window.motionPhases.pressed=true;
      if(document.querySelector('.bird-flight'))window.motionPhases.flight=true;
    });window.motionObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  });
  const row=page.locator(`[data-circle-id="${nest.id}"]`);
  await row.getByRole('button',{name:'Open Nest Morning songs',exact:true}).click();
  await expect(page.locator('.chat-landing-nest')).toBeVisible();
  await expect(page.locator('.chat-layout')).toHaveCSS('animation-duration','1.4s');
  // The flight remains visible long enough for multiple approved wing poses.
  await expect(page.locator('.bird-flight')).toBeVisible();
  const duration=await page.locator('.travelling-bird').evaluate(el=>el.getAnimations()[0].effect.getTiming().duration);
  expect(duration).toBeGreaterThanOrEqual(2000);
  await expect(page.locator('.travelling-bird [data-bird-pose]')).not.toHaveAttribute('data-bird-pose','takeoff');
  await page.screenshot({path:info.outputPath('bird-in-flight.png'),fullPage:true});
  await expect.poll(()=>page.evaluate(()=>window.motionPhases)).toEqual({pressed:true,flight:true});
  await expect(page.locator('.bird-flight')).toHaveCount(0);
  await expect(page.locator('.chat-heading h1')).toBeFocused();
  await expect(page.locator('.resident-bird')).toHaveCSS('opacity','1');
  await expect(page.locator('.resident-bird image')).toHaveAttribute('href','/brand/previews/churp-bird-poses.png');
  await page.screenshot({path:info.outputPath('bird-at-nest.png'),fullPage:true});
  if(info.project.name!=='desktop')await page.getByRole('button',{name:'Back to Nests',exact:true}).click();
  else await page.getByRole('button',{name:'Tree home',exact:true}).click();
  await expect(row.getByRole('button',{name:'Open Nest Morning songs',exact:true})).toBeFocused();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{window.motionPhases={pressed:false,flight:false};});
  await row.getByRole('button',{name:'Open Nest Morning songs',exact:true}).press('Enter');
  await expect(page.locator('.chat-landing-nest')).toBeVisible();
  await expect(page.locator('.chat-layout')).toHaveCSS('animation-name','none');
  expect((await page.evaluate(()=>window.motionPhases)).flight).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});
