import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('encrypted multi-question poll opens a ballot and saves eggs in choice baskets', async ({ page, browser }, info) => {
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  const listen = p => p.on('request', r => { if (r.method() === 'POST' && /\/api\/(groups\/.*\/messages|messages\/.*\/poll\/vote)/.test(r.url())) writes.push(r.postData() || ''); });
  listen(page);
  async function register(context, name) {
    const response = await context.request.post('/api/auth/register', { data: { username: `poll_${randomUUID().slice(0, 8)}`, name, password: 'Poll browser password!' } });
    expect(response.status()).toBe(201); return (await response.json()).user;
  }
  await register(page.context(), 'Organizer');
  const tree = (await (await page.request.post('/api/communities', { data: { name: 'Weekend Tree' } })).json()).community;
  const nest = (await (await page.request.post(`/api/communities/${tree.id}/circles`, { data: { name: 'Weekend plans', admin_only: true } })).json()).group;
  const invite = (await (await page.request.post('/api/invitations', { data: { community_id: tree.id } })).json()).path.split('invite=')[1];
  const context = await browser.newContext({ ...info.project.use, baseURL: 'http://127.0.0.1:3101' });
  try {
    await register(context, 'Participant'); await context.request.post('/api/invitations/accept', { data: { token: invite } }); await context.request.post(`/api/groups/${nest.id}/join`);
    const member = await context.newPage(); member.on('pageerror', e => errors.push(e.message)); listen(member);
    const url = `/?community=${tree.id}&group=${nest.id}`;
    await page.goto(url); await member.goto(url);
    await expect(page.getByRole('textbox', { name: 'Write a message', exact: true })).toBeVisible();
    await expect(member.locator('.read-only')).toBeVisible();
    await page.getByRole('button', { name: 'Add to chat', exact: true }).click();
    await page.getByRole('button', { name: 'Poll', exact: true }).click();
    const builder = page.getByRole('dialog');
    await expect(builder.locator('.poll-question-editor')).toHaveCount(1);
    await builder.getByRole('textbox', { name: 'Poll title', exact: true }).fill('Family weekend');
    await builder.getByRole('textbox', { name: 'Question 1', exact: true }).fill('What day works?');
    await builder.getByRole('textbox', { name: 'Question 1, option 1', exact: true }).fill('Saturday');
    await builder.getByRole('textbox', { name: 'Question 1, option 2', exact: true }).fill('Sunday');
    await builder.getByRole('button', { name: 'Add another question', exact: true }).click();
    await builder.getByRole('textbox', { name: 'Question 2', exact: true }).fill('What sounds fun?');
    await builder.getByRole('combobox', { name: 'Answer type for question 2', exact: true }).selectOption('multiple');
    await builder.getByRole('textbox', { name: 'Question 2, option 1', exact: true }).fill('Picnic');
    await builder.getByRole('textbox', { name: 'Question 2, option 2', exact: true }).fill('Games');
    await builder.locator('.poll-question-editor').nth(1).getByRole('button', { name: 'Add answer', exact: true }).click();
    await builder.getByRole('textbox', { name: 'Question 2, option 3', exact: true }).fill('Walk');
    await builder.getByRole('button', { name: 'Send poll', exact: true }).click();
    await expect(builder).toHaveCount(0);
    for (const p of [page, member]) {
      await expect(p.getByRole('button', { name: 'Open poll: Family weekend', exact: true })).toBeVisible();
      await expect(p.getByText('What day works?', { exact: true })).toHaveCount(0);
      await expect(p.locator('.message-bubble.poll-message')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    await page.screenshot({ path: info.outputPath('poll-ballot-chat.png'), fullPage: true });
    await member.getByRole('button', { name: 'Open poll: Family weekend', exact: true }).click();
    const view = member.getByRole('dialog');
    await expect(view.getByRole('heading', { name: 'What day works?', exact: true })).toBeVisible();
    await expect(view.getByRole('button', { name: 'Close poll', exact: true })).toHaveCount(0);
    await view.getByRole('radio', { name: 'Saturday', exact: true }).check();
    await expect(view.locator('.poll-choice-egg')).toHaveCount(1);
    await expect(view.locator('.poll-choice-egg')).toHaveCSS('animation-name', 'poll-egg-drop');
    await member.screenshot({ path: info.outputPath('poll-basket-selection.png'), fullPage: true });
    await view.getByRole('button', { name: 'Next question', exact: true }).click();
    await view.getByRole('checkbox', { name: 'Picnic', exact: true }).check(); await view.getByRole('checkbox', { name: 'Games', exact: true }).check();
    await expect(view.locator('.poll-choice-egg')).toHaveCount(2);
    await view.getByRole('button', { name: 'Submit answers', exact: true }).click();
    await expect(view.getByRole('status')).toContainText('Your answers are saved.');
    await expect(view).toContainText('1 member has responded.');
    await view.getByRole('checkbox', { name: /^Games/ }).uncheck(); await view.getByRole('checkbox', { name: /^Walk/ }).check();
    await view.getByRole('button', { name: 'Update answers', exact: true }).click();
    await expect(view.getByRole('button', { name: 'Update answers', exact: true })).toBeEnabled();
    await expect(view).toContainText('1 member has responded.');
    await expect.poll(async () => (await (await context.request.get(`/api/groups/${nest.id}/messages`)).json()).messages.length).toBe(1);
    await member.reload(); await member.getByRole('button', { name: 'Open poll: Family weekend', exact: true }).click();
    await expect(member.getByRole('radio', { name: /^Saturday/ })).toBeChecked();
    await member.getByRole('button', { name: 'Next question', exact: true }).click();
    await expect(member.getByRole('checkbox', { name: /^Picnic/ })).toBeChecked(); await expect(member.getByRole('checkbox', { name: /^Walk/ })).toBeChecked(); await expect(member.getByRole('checkbox', { name: /^Games/ })).not.toBeChecked();
    await page.getByRole('button', { name: 'Open poll: Family weekend', exact: true }).click();
    await page.getByRole('button', { name: 'Close poll', exact: true }).click();
    await expect(member.getByRole('dialog')).toContainText('Closed');
    await expect(member.getByRole('checkbox', { name: /^Picnic/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Reopen poll', exact: true }).click();
    await expect(member.getByRole('checkbox', { name: /^Picnic/ })).toBeEnabled();
    const broken = await member.locator('img').evaluateAll(images => images.filter(img => img.complete && !img.naturalWidth).map(img => img.src)); expect(broken).toEqual([]);
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
    for (const write of writes) { expect(write).not.toContain('Family weekend'); expect(write).not.toContain('Saturday'); expect(write).not.toContain('Picnic'); }
    expect(writes.length).toBeGreaterThanOrEqual(3); expect(errors).toEqual([]);
  } finally { await context.close(); }
});
