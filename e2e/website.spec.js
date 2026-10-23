import { test,expect } from '@playwright/test';

test('public website presents the brand, previews communities and links into real signup',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/website/');
  await expect(page).toHaveTitle('Churp — A little closer, together');
  await expect(page.locator('#hero-heading')).toBeVisible();
  await page.getByRole('button',{name:'Our church',exact:false}).click();await expect(page.locator('#audience-title')).toContainText('Sunday gathering');await expect(page.locator('#demo-tree')).toHaveText('Maple Meadow Church');
  await page.getByRole('button',{name:'Our family',exact:false}).click();await expect(page.locator('#demo-tree')).toHaveText('The Fausett Family');
  await expect(page.locator('[data-scene="families"]')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('link',{name:'Privacy basics',exact:true}).click();await expect(page.locator('#privacy')).toHaveAttribute('open','');
  await expect(page.locator('#privacy')).toContainText('Churp can recover messages addressed to managed-key members');
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);await expect(page.locator('form')).toHaveCount(0);
  if(info.project.name!=='desktop'){
    await page.getByRole('button',{name:'Open menu',exact:true}).click();await expect(page.getByRole('button',{name:'Close menu',exact:true})).toHaveAttribute('aria-expanded','true');
    await page.locator('#site-navigation').getByRole('link',{name:'How it works',exact:true}).click();await expect(page.getByRole('button',{name:'Open menu',exact:true})).toHaveAttribute('aria-expanded','false');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBeTruthy();
  const broken=await page.locator('img').evaluateAll(images=>images.filter(img=>img.complete && !img.naturalWidth).map(img=>img.src));expect(broken).toEqual([]);
  await page.goto('/website/');await page.screenshot({path:info.outputPath('churp-website.png'),fullPage:true});
  await expect(page.locator('[data-signup-link]').first()).toHaveAttribute('href',/\?signup=1$/);
  await page.getByRole('link',{name:'Make room for your people',exact:false}).click();await expect(page.getByRole('heading',{name:'Find your people.',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
