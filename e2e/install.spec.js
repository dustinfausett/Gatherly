import { test, expect } from '@playwright/test';

test('Home Screen manifest and icons are available', async ({ page }) => {
  await page.goto('/');
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await page.request.get(manifestUrl);
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.name).toBe('Churp');
  expect(manifest.short_name).toBe('Churp');
  await expect(page).toHaveTitle(/Churp/);
  await expect(page.locator('.auth-mobile-logo .churp-logo img, .auth-story .churp-logo img').first()).toHaveAttribute('alt','Churp');
  expect(await page.locator('.churp-logo img').evaluateAll(async images => { await Promise.all(images.map(image=>image.decode())); return images.every(image=>image.naturalWidth>0); })).toBeTruthy();
  await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).fontFamily)).toContain('Nunito Sans');
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
