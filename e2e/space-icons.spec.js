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
    await assertLockBeforeNest(row.locator('.nest-avatar-symbol .space-icon'));
    const badge = await row.locator('.nest-avatar-symbol').boundingBox();
    const egg = await row.locator('.avatar-status-egg').boundingBox();
    expect(badge.y + badge.height).toBeLessThanOrEqual(egg.y);
    await expect(row.getByRole('button', { name: `Open Nest ${nest.name}`, exact: true })).toHaveAccessibleDescription('Private Nest · Unread · Marked unread');
  }
  await expect(page.getByRole('button', { name: 'Open Nest Daily news', exact: true }).locator('.space-lock')).toHaveCount(0);
  await expect(page.locator('.group-avatar-symbol .space-art-branch')).toBeVisible();
  await page.screenshot({ path: info.outputPath('nest-icons-home.png'), fullPage: true });

  if (info.project.name !== 'desktop') await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.locator('.tree-label .space-art-branch')).toBeVisible();
  for (const name of [root.name, nested.name]) {
    const entry = page.locator('.tree-group').filter({ hasText: name });
    await assertLockBeforeNest(entry.locator('.space-icon'));
    expect((await entry.locator('.space-icon').boundingBox()).width).toBeLessThan(40);
  }
  await expect(page.locator('.space-tree .lucide-hash, .space-tree .lucide-message-circle, .space-tree .lucide-bird, .space-tree .lucide-tree-deciduous')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('nest-icons-sidebar.png'), fullPage: true });
  await page.locator('.tree-group').filter({ hasText: root.name }).click();
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
    await expect(member.locator('.space-tree')).not.toContainText(root.name);
    await expect(member.locator('.space-tree')).not.toContainText(nested.name);
    await expect(member.getByRole('button', { name: 'Open Nest Daily news', exact: true })).toBeVisible();
  } finally { await guest.close(); }
});
