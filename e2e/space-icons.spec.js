import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('Tree, Branch and Nest artwork keeps privacy locks and hidden Nest access', async ({ page, browser }, info) => {
  const suffix = randomUUID().slice(0, 8);
  await page.request.post('/api/auth/register', { data: { username: `icons_${suffix}`, name: 'Tree admin', password: 'test artwork password' } });
  const tree = (await (await page.request.post('/api/communities', { data: { name: 'Our family' } })).json()).community;
  const branch = (await (await page.request.post(`/api/communities/${tree.id}/subcommunities`, { data: { name: 'Family life' } })).json()).subcommunity;
  const create = async data => (await (await page.request.post(`/api/communities/${tree.id}/circles`, { data })).json()).group;
  const root = await create({ name: 'Private plans', private: true });
  const nested = await create({ name: 'Hidden family plans', private: true, subcommunity_id: branch.id });
  await create({ name: 'Daily news' });
  for (const nest of [root, nested]) await page.request.patch(`/api/groups/${nest.id}/membership`, { data: { marked_unread: true } });
  const artwork = page.waitForResponse(r => r.url().endsWith('/brand/previews/churp-tree-nest-icons.png'));
  await page.goto('/');
  expect((await artwork).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Open Branch Family life', exact: true }).click();
  const assertLockBeforeNest = async icon => {
    await expect(icon.locator('.space-lock')).toBeVisible();
    await expect(icon.locator('.space-art-nest')).toBeVisible();
    const lock = await icon.locator('.space-lock').boundingBox();
    const nest = await icon.locator('.space-art-nest').boundingBox();
    expect(lock.x + lock.width).toBeLessThanOrEqual(nest.x);
  };
  for (const nest of [root, nested]) {
    const row = page.locator(`[data-circle-id="${nest.id}"]`);
    await expect(row.locator('.nest-privacy-lock')).toBeVisible();
    await expect(row.locator('.nest-row-art .space-art-nest')).toBeVisible();
    const badge = await row.locator('.nest-privacy-lock').boundingBox();
    const egg = await row.locator('.avatar-status-egg').boundingBox();
    expect(badge.y + badge.height).toBeLessThanOrEqual(egg.y);
    await expect(row.getByRole('button', { name: `Open Nest ${nest.name}`, exact: true })).toHaveAccessibleDescription('Private Nest · Unread · Marked unread');
  }
  await expect(page.getByRole('button', { name: 'Open Nest Daily news', exact: true }).locator('.space-lock')).toHaveCount(0);
  await expect(page.locator('.group-row .row-art .space-art-branch')).toBeVisible();
  await expect(page.locator('.circle-list .nest-avatar-symbol, .circle-list .group-avatar-symbol, .circle-list .row-kind')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('nest-icons-home.png'), fullPage: true });

  if (info.project.name !== 'desktop') await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.locator('.sidebar-search,.space-tree')).toHaveCount(0);
  await expect(page.locator('.sidebar').getByRole('button',{name:'Invite someone to this Tree',exact:true})).toBeVisible();
  await page.locator('.sidebar').getByRole('button',{name:'Invite someone to this Tree',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('heading',{name:'Invite to Tree',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Create invitation link',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Invitation link',exact:true})).toHaveValue(/invite=/);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:`Open Nest ${root.name}`,exact:true}).click();
  await expect(page.locator('.chat-heading h1')).toHaveText(root.name);
  await assertLockBeforeNest(page.locator('.chat-heading .space-icon'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();

  const guest = await browser.newContext({ viewport: info.project.use.viewport, baseURL: 'http://127.0.0.1:3100' });
  try {
    await guest.request.post('/api/auth/register', { data: { username: `icon_guest_${suffix}`, name: 'Member', password: 'test artwork password' } });
    const invite = (await (await page.request.post('/api/invitations', { data: { community_id: tree.id } })).json()).path.split('invite=')[1];
    await guest.request.post('/api/invitations/accept', { data: { token: invite } });
    const member = await guest.newPage();
    await member.goto('/');
    await member.getByRole('button', { name: 'Open Branch Family life', exact: true }).click();
    await expect(member.getByRole('button', { name: `Open Nest ${root.name}`, exact: true })).toHaveCount(0);
    await expect(member.getByRole('button', { name: `Open Nest ${nested.name}`, exact: true })).toHaveCount(0);
    await expect(member.locator('.space-tree')).toHaveCount(0);
    await expect(member.locator('.sidebar-invitations').getByRole('button',{name:'Invite someone to this Tree',exact:true})).toHaveCount(0);
    await expect(member.getByRole('button', { name: 'Open Nest Daily news', exact: true })).toBeVisible();
  } finally { await guest.close(); }
});
