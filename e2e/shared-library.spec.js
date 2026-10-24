import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('header Nest opens the encrypted shared library with newest-first pictures, downloads and polls', async ({ page }, info) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.request.post('/api/auth/register',{data:{username:`library_${randomUUID().slice(0,8)}`,name:'Library owner',password:'Shared library fixture!'}});
  const tree=(await (await page.request.post('/api/communities',{data:{name:'Our library Tree'}})).json()).community;
  const nest=(await (await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Family memories'}})).json()).group;
  await page.goto(`/?community=${tree.id}&group=${nest.id}`);
  await expect(page.getByRole('textbox',{name:'Write a message',exact:true})).toBeVisible();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=','base64');
  const pdf=Buffer.from('%PDF-1.7\nPrivate library document\n%%EOF');
  const file=(name,mimeType,buffer)=>({name,mimeType,buffer});
  async function share(files,text){
    await page.locator('.composer input[type=file]').first().setInputFiles(files);
    await page.getByRole('textbox',{name:'Write a message',exact:true}).fill(text);
    const response=page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith(`/api/groups/${nest.id}/messages`));
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    const result=await response; expect(result.status()).toBe(201);return (await result.json()).id;
  }
  async function poll(title){
    await page.getByRole('button',{name:'Add to chat',exact:true}).click();await page.getByRole('button',{name:'Poll',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Poll title',exact:true}).fill(title);
    await dialog.getByRole('textbox',{name:'Question 1',exact:true}).fill('Which plan works?');
    await dialog.getByRole('textbox',{name:'Question 1, option 1',exact:true}).fill('Plan one');await dialog.getByRole('textbox',{name:'Question 1, option 2',exact:true}).fill('Plan two');
    await dialog.getByRole('button',{name:'Send poll',exact:true}).click();await expect(dialog).toHaveCount(0);
  }
  const older=await share([file('older.pdf','application/pdf',pdf),file('oldest.png','image/png',png)],'First shared items');
  await poll('Earlier plans');
  const ballot=page.getByRole('button',{name:'Open poll: Earlier plans',exact:true});
  await expect(ballot.locator('img')).toHaveAttribute('src','/brand/activities/poll-ballot.png');
  await ballot.click();await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.envelope-open,.envelope-closed')).toHaveCount(0);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await share([file('newer.pdf','application/pdf',pdf),file('newest.png','image/png',png),file('voice.mp3','audio/mpeg',Buffer.from('audio fixture')),file('movie.mp4','video/mp4',Buffer.from('video fixture')),file('archive.zip','application/zip',Buffer.from('archive fixture'))],'More recent shared items');
  await poll('Latest plans');
  await page.getByRole('button',{name:'Open shared items',exact:true}).click();
  let dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'Shared in this Nest',exact:true})).toBeVisible();
  await expect(dialog.getByText('Loading shared items…',{exact:true})).toHaveCount(0);
  for(const name of ['Pictures','Documents','Polls','Videos','Audio','Other files'])await expect(dialog.getByRole('button',{name:new RegExp(`^${name}`)})).toBeVisible();
  await page.screenshot({path:info.outputPath('shared-categories.png'),fullPage:true});
  await dialog.getByRole('button',{name:/^Documents/}).click();
  await expect(dialog.locator('.shared-download strong')).toHaveText(['newer.pdf','older.pdf']);
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:/newer\.pdf/}).click();const document=await download;
  expect(document.suggestedFilename()).toBe('newer.pdf');expect(readFileSync(await document.path())).toEqual(pdf);
  await dialog.getByRole('button',{name:'All shared items',exact:true}).click();await dialog.getByRole('button',{name:/^Pictures/}).click();
  await expect(dialog.locator('.shared-picture strong')).toHaveText(['newest.png','oldest.png']);
  await expect.poll(()=>dialog.locator('.shared-picture img').first().evaluate(img=>img.naturalWidth)).toBe(1);
  await dialog.locator('.shared-picture').first().click();await expect(dialog.getByRole('img',{name:'newest.png',exact:true})).toBeVisible();
  await expect.poll(()=>dialog.getByRole('img',{name:'newest.png',exact:true}).evaluate(img=>img.naturalWidth)).toBe(1);
  await dialog.getByRole('button',{name:'Back to Pictures',exact:true}).click();await dialog.getByRole('button',{name:'All shared items',exact:true}).click();
  await dialog.getByRole('button',{name:/^Polls/}).click();await expect(dialog.locator('.poll-ballot strong')).toHaveText(['Latest plans','Earlier plans']);
  await dialog.getByRole('button',{name:'Open poll: Latest plans',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.getByRole('dialog').getByRole('heading',{name:'Latest plans',exact:true})).toBeVisible();
  await page.getByRole('radio',{name:'Plan one',exact:true}).check();await page.getByRole('button',{name:'Submit answers',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Your answers are saved.');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'Polls',exact:true})).toBeVisible();await expect(dialog.locator('.poll-ballot')).toHaveCount(2);
  await page.request.delete(`/api/messages/${older}`);
  await dialog.getByRole('button',{name:'All shared items',exact:true}).click();await dialog.getByRole('button',{name:/^Documents/}).click();
  await expect(dialog.locator('.shared-download strong')).toHaveText(['newer.pdf']);
  await page.screenshot({path:info.outputPath('shared-documents.png'),fullPage:true});
  const shared=await (await page.request.get(`/api/groups/${nest.id}/shared`)).json();
  expect(JSON.stringify(shared)).not.toContain('newer.pdf');expect(JSON.stringify(shared)).not.toContain('Latest plans');
  expect(shared.messages.every(m=>m.body==='' && m.message_kind!=='poll_vote')).toBeTruthy();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBeTruthy();expect(errors).toEqual([]);
});
