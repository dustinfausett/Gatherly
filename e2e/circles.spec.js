import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function swipe(page, locator, direction, mobile) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const startX = box.x + box.width * (direction === 'right' ? .28 : .72);
  const endX = startX + (direction === 'right' ? 100 : -100);
  const y = box.y + box.height / 2;
  if (mobile) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x:startX, y }] });
    for (let i=1;i<=6;i++) await session.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:startX+(endX-startX)*i/6,y }] });
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await session.detach();
  } else {
    await page.mouse.move(startX,y); await page.mouse.down();
    await page.mouse.move(endX,y,{steps:6}); await page.mouse.up();
  }
}

test('Nest inbox supports personal pins, unread swipes, urgency, and one-tap muting', async ({ page, browser }, testInfo) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const suffix=randomUUID().slice(0,8);
  const registered=await page.request.post('/api/auth/register',{data:{username:`inbox_${suffix}`,name:'Sam Taylor',password:'test nest password'}});
  expect(registered.ok()).toBeTruthy();
  const community=(await (await page.request.post('/api/communities',{data:{name:'Our Tree'}})).json()).community;
  const create=async name => (await (await page.request.post(`/api/communities/${community.id}/circles`,{data:{name}})).json()).group;
  const alpha=await create('Alpha'), zulu=await create('Zulu'), delta=await create('Delta');
  await page.goto('/');
  await page.getByRole('button',{name:'New Nest',exact:true}).click();
  await page.getByLabel('Nest name',{exact:true}).fill('Beta');
  await expect(page.getByLabel('Branch (optional)',{exact:true})).toHaveValue('');
  await page.getByRole('dialog').getByRole('button',{name:'Create Nest',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Beta',exact:true})).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Our Tree',exact:true})).toBeVisible();
  const row=name=>page.locator('.circle-row').filter({has:page.getByRole('button',{name:`Open Nest ${name}`,exact:true})});
  const options=async name=> { await row(name).getByRole('button',{name:`Options for ${name}`,exact:true}).click(); await expect(page.getByRole('dialog')).toBeVisible(); };
  const names=section=>page.locator(`${section} .circle-name`);
  await expect(names('.joined-circles')).toHaveText(['Alpha','Beta','Delta','Zulu']);
  await options('Zulu');await page.getByRole('button',{name:'Pin Nest',exact:true}).click();
  await expect(names('.pinned-circles')).toHaveText(['Zulu']);
  await options('Alpha');await page.getByRole('button',{name:'Pin Nest',exact:true}).click();
  await expect(names('.pinned-circles')).toHaveText(['Zulu','Alpha']);
  await options('Alpha');await page.getByRole('button',{name:'Move up',exact:true}).click();
  await expect(names('.pinned-circles')).toHaveText(['Alpha','Zulu']);
  await page.reload();await expect(names('.pinned-circles')).toHaveText(['Alpha','Zulu']);
  await swipe(page,row('Delta'),'right',testInfo.project.name!=='desktop');
  await expect(row('Delta')).toHaveAttribute('data-unread','true');
  await expect(row('Delta').locator('.circle-row-content')).toHaveCSS('background-color','rgb(255, 245, 211)');
  await expect(names('.joined-circles')).toHaveText(['Delta','Beta']);
  await expect(row('Delta').locator('.avatar-status-dot')).toHaveCSS('background-color','rgb(224, 174, 32)');
  await expect(page.getByRole('heading',{name:'Our Tree',exact:true})).toBeVisible();
  await swipe(page,row('Delta'),'left',testInfo.project.name!=='desktop');
  await row('Delta').getByRole('button',{name:'Options',exact:true}).click();
  await page.getByRole('button',{name:'Mark as read',exact:true}).click();
  await expect(row('Delta')).toHaveAttribute('data-unread','false');
  await expect(names('.joined-circles')).toHaveText(['Beta','Delta']);
  await row('Delta').getByRole('button',{name:'Mute Delta',exact:true}).click();
  await expect(row('Delta').getByRole('button',{name:'Unmute Delta',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('heading',{name:'Our Tree',exact:true})).toBeVisible();

  const other=await browser.newContext();
  try {
    await other.request.post('http://127.0.0.1:3100/api/auth/register',{data:{username:`guest_${suffix}`,name:'Jamie',password:'test nest password'}});
    const invite=(await (await page.request.post('/api/invitations',{data:{community_id:community.id}})).json()).path.split('invite=')[1];
    await other.request.post('http://127.0.0.1:3100/api/invitations/accept',{data:{token:invite}});
    await other.request.post(`http://127.0.0.1:3100/api/groups/${delta.id}/join`);
    await other.request.post(`http://127.0.0.1:3100/api/groups/${delta.id}/messages`,{data:{body:'Please check this urgent update.',urgent:true}});
    await expect(row('Delta')).toHaveAttribute('data-urgent','true');
    await expect(row('Delta').locator('.avatar-status-dot')).toHaveCSS('background-color','rgb(207, 91, 78)');
    await expect(row('Delta').locator('.circle-row-content')).toHaveCSS('background-color','rgb(255, 235, 232)');
    await expect(names('.pinned-circles')).toHaveText(['Alpha','Zulu']);
    await expect(names('.joined-circles')).toHaveText(['Delta','Beta']);
    await page.screenshot({path:testInfo.outputPath('circle-inbox.png'),fullPage:true});
    await page.reload();
    await expect(row('Delta')).toHaveAttribute('data-urgent','true');
    await expect(row('Delta').getByRole('button',{name:'Unmute Delta',exact:true})).toBeVisible();
    await row('Delta').getByRole('button',{name:'Open Nest Delta',exact:true}).click();
    await expect(page.locator('.urgent-message')).toContainText('Please check this urgent update.');
    await expect(page.locator('.urgent-message')).toHaveCSS('background-color','rgb(191, 227, 237)');
    await page.getByRole('textbox',{name:'Write a message',exact:true}).fill('An urgent response.');
    await page.getByRole('button',{name:'Mark as urgent',exact:true}).click();
    await expect(page.getByRole('button',{name:'Mark as urgent',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(page.locator('.urgent-message').filter({hasText:'An urgent response.'})).toBeVisible();
    await page.goto('/');
    await expect(row('Delta')).toHaveAttribute('data-urgent','false');
    await expect(row('Delta')).toHaveAttribute('data-unread','false');
    await expect(names('.joined-circles')).toHaveText(['Beta','Delta']);
    await options('Alpha');await page.getByRole('button',{name:'Unpin Nest',exact:true}).click();
    await expect(names('.pinned-circles')).toHaveText(['Zulu']);
    await expect(names('.joined-circles')).toHaveText(['Alpha','Beta','Delta']);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
  } finally { await other.close(); }
});
