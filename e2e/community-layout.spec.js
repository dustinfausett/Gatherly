import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const picture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O2sAAAAASUVORK5CYII=','base64');

test('compact Community home, Group navigation, photos, and menu details', async ({ page, browser }, testInfo) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const suffix=randomUUID().slice(0,8);
  expect((await page.request.post('/api/auth/register',{data:{username:`layout_${suffix}`,name:'Dustin',password:'test layout password'}})).ok()).toBeTruthy();
  const community=(await (await page.request.post('/api/communities',{data:{name:'Fausett Family',description:'The whole of the Fausett clan'}})).json()).community;
  const collection=(await (await page.request.post(`/api/communities/${community.id}/subcommunities`,{data:{name:'Family life'}})).json()).subcommunity;
  const nested=(await (await page.request.post(`/api/communities/${community.id}/circles`,{data:{name:'Family plans',subcommunity_id:collection.id,description:'This description should never appear in a chat row.'}})).json()).group;
  await page.request.post(`/api/communities/${community.id}/circles`,{data:{name:'Private planning',subcommunity_id:collection.id,private:true}});
  const direct=(await (await page.request.post(`/api/communities/${community.id}/circles`,{data:{name:'Announcements'}})).json()).group;
  await page.goto('/');
  const circle=name=>page.locator('.circle-row').filter({has:page.getByRole('button',{name:`Open Circle ${name}`,exact:true})});
  const group=name=>page.locator('.group-row').filter({has:page.getByRole('button',{name:`Open Group ${name}`,exact:true})});
  const home=page.locator('.compact-home');
  await expect(home.locator('h1')).toHaveText('Fausett Family');
  expect((await home.locator('.community-banner').boundingBox()).height).toBeLessThanOrEqual(135);
  await expect(home.locator('section>h2')).toHaveText(['Pinned Circles','Groups & Circles you’ve joined','Explore Groups & Circles']);
  await expect(home.locator('.circle-preview,.circle-location,.home-hero,.community-stats')).toHaveCount(0);
  await expect(home).not.toContainText('Your shared space');
  await expect(home).not.toContainText('Subcommunities');
  await expect(circle('Announcements').locator('.circle-row-content')).toHaveCSS('background-color','rgb(237, 243, 230)');
  if(testInfo.project.name!=='desktop') {
    const box=await circle('Announcements').boundingBox();
    expect(box.x).toBeLessThanOrEqual(12);
    expect(box.x+box.width).toBeGreaterThanOrEqual(testInfo.project.use.viewport.width-12);
  }
  await expect(circle('Family plans')).toHaveCount(0);
  await group('Family life').getByRole('button').click();
  await expect(home.locator('h1')).toHaveText('Family life');
  await expect(circle('Family plans')).toBeVisible();
  await expect(circle('Family plans')).not.toContainText('This description');
  await circle('Family plans').getByRole('button',{name:'Options for Family plans',exact:true}).click();
  await page.getByRole('button',{name:'Circle settings',exact:true}).click();
  await page.locator('.avatar-editor input[type=file]').setInputFiles({name:'circle.png',mimeType:'image/png',buffer:picture});
  await expect(page.locator('.avatar-editor img')).toBeVisible();
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(circle('Family plans').locator('.row-avatar img')).toBeVisible();
  await circle('Family plans').getByRole('button',{name:'Options for Family plans',exact:true}).click();
  await page.getByRole('button',{name:'Pin Circle',exact:true}).click();
  await expect(page.locator('.pinned-circles .circle-name')).toHaveText(['Family plans']);
  await page.getByRole('button',{name:'Group settings',exact:true}).click();
  await page.locator('.avatar-editor input[type=file]').setInputFiles({name:'group.png',mimeType:'image/png',buffer:picture});
  await expect(page.locator('.avatar-editor img')).toBeVisible();
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByRole('button',{name:'Back to Community',exact:true}).click();
  await expect(group('Family life').locator('.row-avatar img')).toBeVisible();
  await expect(page.locator('.pinned-circles .circle-name')).toHaveText(['Family plans']);
  await expect(page.locator('.joined-circles .circle-name')).toHaveText(['Announcements','Family life']);
  const first=await home.locator('section').first().getAttribute('aria-label');expect(first).toBe('Pinned Circles');
  await page.screenshot({path:testInfo.outputPath('community-redesign.png'),fullPage:true});

  if(testInfo.project.name!=='desktop') await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:'Community details',exact:true}).click();
  await expect(page.locator('.community-details h1')).toHaveText('Fausett Family');
  await expect(page.locator('.community-details-stats dt')).toHaveText(['Members','Groups','Circles to explore','Circles you’ve joined']);
  await expect(page.locator('.community-description')).toHaveText('The whole of the Fausett clan');
  await page.getByRole('button',{name:'Back to Community',exact:true}).click();

  const guest=await browser.newContext({viewport:testInfo.project.use.viewport});
  try {
    await guest.request.post('http://127.0.0.1:3100/api/auth/register',{data:{username:`member_${suffix}`,name:'Member',password:'test layout password'}});
    const invite=(await (await page.request.post('/api/invitations',{data:{community_id:community.id}})).json()).path.split('invite=')[1];
    await guest.request.post('http://127.0.0.1:3100/api/invitations/accept',{data:{token:invite}});
    const gp=await guest.newPage();await gp.goto('http://127.0.0.1:3100/');
    await expect(gp.locator('.explore-circles .circle-name')).toHaveText(['Announcements','Family life']);
    await gp.getByRole('button',{name:'Open Group Family life',exact:true}).click();
    await expect(gp.getByRole('button',{name:'Open Circle Private planning',exact:true})).toHaveCount(0);
    await gp.getByRole('button',{name:'Join Group',exact:true}).click();
    await expect(gp.getByRole('button',{name:'Leave Group',exact:true})).toBeVisible();
    await expect(gp.getByRole('button',{name:'Open Circle Private planning',exact:true})).toHaveCount(0);
    await gp.getByRole('button',{name:'Open Circle Family plans',exact:true}).click();
    await expect(gp.getByRole('button',{name:'Join Circle',exact:true})).toBeVisible();
    await gp.getByRole('button',{name:'Join Circle',exact:true}).click();
    await gp.getByRole('textbox',{name:'Write a message',exact:true}).fill('An urgent family update.');
    await gp.getByRole('button',{name:'Mark as urgent',exact:true}).click();
    await gp.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(group('Family life')).toHaveAttribute('data-urgent','true');
    await expect(group('Family life').locator('.avatar-status-dot.urgent')).toBeVisible();
    await expect(group('Family life').locator('.circle-row-content')).toHaveCSS('background-color','rgb(255, 235, 232)');
    await expect(circle('Family plans').locator('.avatar-status-dot.urgent')).toBeVisible();
    await expect(page.locator('.joined-circles .circle-name')).toHaveText(['Family life','Announcements']);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
  } finally {await guest.close();}
});
