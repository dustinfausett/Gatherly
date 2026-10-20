import { test, expect } from '@playwright/test';

test('Home Screen manifest and icons are available', async ({ page }) => {
  await page.goto('/');
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await page.request.get(manifestUrl);
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.scope).toBe('/');
  for (const icon of manifest.icons) {
    const size = Number(icon.sizes.split('x')[0]);
    expect(await page.evaluate(async ({ src }) => {
      const img = new Image(); img.src = src; await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }, icon)).toEqual([size, size]);
  }
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await page.request.get(appleIcon)).ok()).toBeTruthy();
  expect(await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return new URL(registration.active.scriptURL).pathname;
  })).toBe('/sw.js');
});
