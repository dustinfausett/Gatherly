import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server/app.js';

const password = 'Google connection browser password!';
async function fixture(browser, info) {
  const dir = mkdtempSync(join(tmpdir(), 'churp-google-browser-')), errors = [];
  let runtime;
  const server = createServer((req, res) => runtime.app(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  runtime = createApp({ dataDir: dir, testing: true, appUrl: base, pushEnabled: false, googleClientId: 'browser-fixture.apps.googleusercontent.com', mailer: null, googleVerifyToken: async value => JSON.parse(value) });
  runtime.app.use(express.static(resolve('dist')));
  runtime.app.get('/{*path}', (req, res) => res.sendFile(resolve('dist/index.html')));
  const context = await browser.newContext({ ...info.project.use, baseURL: base });
  // Only Google's UI/token issuer is simulated. Churp's challenge, password,
  // session, account linking, encryption and sign-in APIs run unchanged.
  await context.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.google={accounts:{id:{initialize(options){this.options=options;},renderButton(host){
      const button=document.createElement('button');button.type='button';button.textContent='Continue with Google';
      const options=this.options;
      button.onclick=()=>options.callback({credential:JSON.stringify({sub:'browser-google-subject',email:'browser@example.com',email_verified:true,name:'Google display name',nonce:options.nonce})});
      host.appendChild(button);
    }}}};
  ` }));
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  return { runtime, context, page, base, errors, close: async () => { await context.close(); runtime.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); } };
}
async function accountSettings(page) {
  await page.getByRole('button', { name: 'Edit your profile', exact: true }).click();
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  return page.getByRole('dialog');
}

for (const custody of ['managed', 'self-managed']) test(`an existing ${custody} account connects Google and signs back into the same encrypted Nest`, async ({ browser }, info) => {
  const f = await fixture(browser, info), { page, context } = f;
  try {
    const registered = await context.request.post('/api/auth/register', { data: { username: 'google_browser_owner', name: 'Original member', password, birth_date: '1990-01-01' } });
    const user = (await registered.json()).user;
    const tree = (await (await context.request.post('/api/communities', { data: { name: 'Original Google Tree' } })).json()).community;
    const nest = (await (await context.request.post(`/api/communities/${tree.id}/circles`, { data: { name: 'History Nest' } })).json()).group;
    const url = `/?community=${tree.id}&group=${nest.id}`;
    await page.goto(url);
    const text = 'My encrypted history stays with my account';
    await page.getByRole('textbox', { name: 'Write a message', exact: true }).fill(text);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.message-bubble').filter({ hasText: text })).toBeVisible();
    let recovery;
    if (custody === 'self-managed') {
      await page.getByRole('button', { name: 'Edit your profile', exact: true }).click();
      await page.getByRole('button', { name: 'Security', exact: true }).click();
      await page.getByRole('button', { name: 'Use self-managed keys', exact: true }).click();
      recovery = await page.getByRole('textbox', { name: 'Your recovery key', exact: true }).inputValue();
      await page.getByRole('checkbox', { name: 'I saved my recovery key somewhere safe.', exact: true }).check();
      await page.getByRole('button', { name: 'Enable self-managed encryption', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    const fingerprint = (await (await context.request.get('/api/e2ee/account')).json()).identity.fingerprint;
    let dialog = await accountSettings(page);
    await dialog.getByLabel('Current Churp password', { exact: true }).fill('wrong');
    await dialog.getByRole('button', { name: 'Connect Google', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('current password is incorrect');
    await dialog.getByLabel('Current Churp password', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: 'Connect Google', exact: true }).click();
    await dialog.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Google connected');
    await expect(dialog).toContainText('browser@example.com');
    expect((await (await context.request.get('/api/me')).json()).user.id).toBe(user.id);
    expect((await (await context.request.get('/api/e2ee/account')).json()).identity.fingerprint).toBe(fingerprint);
    await page.screenshot({ path: info.outputPath('google-account-connected.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Back to your settings', exact: true }).click();
    await dialog.getByRole('button', { name: 'Sign out of Churp', exact: true }).click();
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    if (recovery) {
      await expect(page.getByRole('heading', { name: 'Unlock this device', exact: true })).toBeVisible();
      await page.getByRole('textbox', { name: 'Recovery key', exact: true }).fill(recovery);
      await page.getByRole('button', { name: 'Restore with recovery key', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: 'Edit your profile', exact: true })).toBeVisible();
    await page.goto(url);
    await expect(page.locator('.message-bubble').filter({ hasText: text })).toBeVisible();
    expect((await (await context.request.get('/api/me')).json()).user.id).toBe(user.id);
    expect((await (await context.request.get('/api/e2ee/account')).json()).identity.fingerprint).toBe(fingerprint);
    expect((await (await context.request.get('/api/e2ee/account')).json()).identity.custody).toBe(custody === 'managed' ? 'managed' : 'self');
    expect(f.runtime.db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(1);
    dialog = await accountSettings(page);
    await dialog.locator('summary').filter({ hasText: 'Disconnect Google' }).click();
    await dialog.getByLabel('Current Churp password', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: 'Disconnect Google', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Google disconnected');
    expect((await (await context.request.get('/api/me')).json()).user.has_google).toBe(false);
    expect(f.errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  } finally { await f.close(); }
});

test('Google sign-in does not silently create an account, while explicit signup still requires age setup', async ({ browser }, info) => {
  const f = await fixture(browser, info), { page } = f;
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('not connected to Churp yet');
    expect(f.runtime.db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(0);
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await expect(page.locator('body')).toContainText('connect Google in Account settings');
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A little about you', exact: true })).toBeVisible();
    expect(f.runtime.db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(1);
    expect((await (await f.context.request.get('/api/me')).json()).user.family.needs_setup).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
