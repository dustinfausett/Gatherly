import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const tab = (page, name) => page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name, exact: true }).click();
async function register(ctx, name) { const r = await ctx.request.post('/api/auth/register', { data: { username: `handoff_${randomUUID().slice(0, 8)}`, name, password: 'Phone handoff fixture!', birth_date: '1990-01-01' } }); expect(r.status()).toBe(201); return (await r.json()).user; }

test('one composition sends privately in Churp and prepares separate personal-phone drafts without provider calls', async ({ page, browser }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.phoneLinks = []; window.copiedPhoneTexts = [];
    document.addEventListener('click', e => { const a = e.target.closest('a[href^="sms:"]'); if (a) { e.preventDefault(); window.phoneLinks.push(a.href); } }, true);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.copiedPhoneTexts.push(text) } });
  });
  await register(page.context(), 'Party planner');
  const tree = (await (await page.request.post('/api/communities', { data: { name: 'Birthday Tree' } })).json()).community;
  const invite = (await (await page.request.post('/api/invitations', { data: { community_id: tree.id } })).json());
  const peerCtx = await browser.newContext({ ...info.project.use, baseURL: 'http://127.0.0.1:3101' });
  try {
    const peer = await register(peerCtx, 'Churp friend'); await peerCtx.request.post('/api/invitations/accept', { data: { token: invite.code } });
    const house = (await (await page.request.post('/api/birdhouses', { data: { name: 'Party people' } })).json()).birdhouse;
    await page.request.post('/api/contacts', { data: { name: 'Churp friend', linked_user_id: peer.id, birdhouse_id: house.id } });
    for (const [name, phone] of [['Phone Avery', '+12025550123'], ['Phone Blake', '+12025550124']]) await page.request.post('/api/contacts', { data: { name, phone, birdhouse_id: house.id } });
    await page.goto('/'); await tab(page, 'Messages'); await page.getByRole('button', { name: 'Compose', exact: true }).click();
    await page.getByRole('button', { name: /Send Many Individually/ }).click(); let d = page.getByRole('dialog');
    await d.getByLabel('Tree', { exact: true }).selectOption(tree.id); await d.getByRole('button', { name: 'Party people', exact: true }).click();
    await expect(d.getByRole('checkbox')).toHaveCount(3); for (const c of await d.getByRole('checkbox').all()) await c.check();
    await d.getByRole('button', { name: 'Next', exact: true }).click();
    const message = 'Picnic tomorrow 🐦\nBring cake & juice?'; await d.getByLabel('Your message', { exact: true }).fill(message);
    await d.getByRole('button', { name: 'Review', exact: true }).click(); await expect(d).toContainText('1 via Churp · 2 drafts for your phone');
    await d.getByRole('button', { name: 'Send Churp messages & prepare phone drafts', exact: true }).click();
    await expect(d).toContainText('Churp friend · Sent'); await expect(d).toContainText('Phone Avery · Phone draft ready');
    const conversation = (await (await page.request.get('/api/private/conversations')).json()).conversations[0];
    const peerPage = await peerCtx.newPage(); await peerPage.goto(`/?conversation=${conversation.id}`); await expect(peerPage.locator('.private-bubble')).toContainText(message);
    await d.getByRole('button', { name: 'Open phone drafts', exact: true }).click(); d = page.getByRole('dialog');
    await d.locator('.phone-draft-recipients article').filter({ hasText: 'Phone Avery' }).getByRole('button', { name: 'Review phone text', exact: true }).click();
    const link = d.getByRole('link', { name: 'Open in Messages', exact: true }), href = await link.getAttribute('href');
    expect(href).toMatch(/^sms:\+12025550123[?&]body=/); expect(href).not.toContain('+12025550124');
    const text = decodeURIComponent(href.split('body=')[1]); expect(text).toContain(message); expect(text).toContain('Party planner · Birthday Tree'); expect(text).toMatch(/Join us on Churp: http:\/\/127\.0\.0\.1:3101\/i\/[A-Z2-9]{10}/); expect(text).not.toContain('Reply STOP');
    if (info.project.name === 'mobile') expect(href).toContain('&body=');
    await page.screenshot({ path: info.outputPath('phone-handoff-preview.png'), fullPage: true });
    await d.getByRole('button', { name: 'Copy message', exact: true }).click(); expect(await page.evaluate(() => window.copiedPhoneTexts.at(-1))).toBe(text);
    await link.click(); await expect.poll(async () => (await (await page.request.get('/api/phone-drafts')).json()).drafts[0].recipients[0].state).toBe('opened');
    expect(await page.evaluate(() => window.phoneLinks)).toHaveLength(1);
    await expect(d.getByText('Marked sent by you', { exact: false })).toHaveCount(0);
    await d.getByRole('button', { name: 'I sent this text', exact: true }).click(); await expect(d).toContainText('Marked sent by you');
    await d.locator('.phone-draft-recipients article').filter({ hasText: 'Phone Blake' }).getByRole('button', { name: 'Review phone text', exact: true }).click();
    await expect(d.getByRole('link', { name: 'Open in Messages', exact: true })).toHaveAttribute('href', /^sms:\+12025550124[?&]body=/);
    await d.getByRole('button', { name: 'Back to recipients', exact: true }).click(); await d.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.reload(); await expect(page.locator('.phone-draft-card')).toContainText('1 marked sent by you');
    expect((await (await page.request.get('/api/sms/config')).json()).mode).toBe('disabled'); expect((await (await page.request.get('/api/sms/threads')).json()).jobs).toHaveLength(0);
    await page.screenshot({ path: info.outputPath('personal-phone-drafts.png'), fullPage: true }); expect(errors).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await peerCtx.close(); }
});

test('phone-only drafts support reminder scheduling, editing, cancellation and durable results', async ({ page }, info) => {
  await register(page.context(), 'Reminder planner'); await page.request.post('/api/contacts', { data: { name: 'Phone friend', phone: '+12025550125' } });
  await page.goto('/'); await tab(page, 'Messages'); await page.getByRole('button', { name: 'Phone drafts', exact: true }).click(); await page.getByRole('button', { name: 'Prepare phone texts', exact: true }).click(); let d = page.getByRole('dialog');
  await d.getByRole('checkbox', { name: /Phone friend/ }).check(); await d.getByRole('button', { name: 'Next', exact: true }).click(); await d.getByLabel('Your message', { exact: true }).fill('A phone reminder for later');
  await d.getByRole('checkbox', { name: 'Schedule send', exact: true }).check(); await expect(d).toContainText('you must open your messaging app and tap Send');
  await d.getByRole('button', { name: 'Review', exact: true }).click(); await d.getByRole('button', { name: 'Schedule messages & phone reminders', exact: true }).click(); await expect(d).toContainText('Phone reminder scheduled');
  await d.getByRole('button', { name: 'Open phone drafts', exact: true }).click(); await expect(d.getByRole('button', { name: 'Review phone text', exact: true })).toBeDisabled();
  await d.getByRole('button', { name: 'Edit or reschedule', exact: true }).click(); await d.getByLabel('Phone draft message', { exact: true }).fill('An updated phone reminder'); await d.getByRole('button', { name: 'Save phone drafts', exact: true }).click(); await expect(d).toContainText('An updated phone reminder');
  await d.getByRole('button', { name: 'Close dialog', exact: true }).click(); await page.getByRole('button', { name: 'Edit your profile', exact: true }).click(); await page.getByRole('button', { name: 'Scheduled messages', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.phone-draft-card')).toContainText('An updated phone reminder'); await page.getByRole('dialog').locator('.phone-draft-card').click(); d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Cancel remaining drafts', exact: true }).click(); await expect(d).toContainText('This draft was cancelled');
  const rows = (await (await page.request.get('/api/phone-drafts')).json()).drafts; expect(rows[0].status).toBe('cancelled'); expect(await page.evaluate(async () => (await (await import('/src/api.js')).api('/scheduled')).sends)).toHaveLength(0);
});
