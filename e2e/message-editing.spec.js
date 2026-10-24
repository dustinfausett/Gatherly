import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('authors edit encrypted messages and replies live, preserving attachments, dates and later-joiner boundaries',async({page,browser},info)=>{
  const errors=[],edits=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='PUT' && /\/api\/messages\/\d+\/content$/.test(r.url()))edits.push(r.postData() || '');});
  async function register(context,name){const r=await context.request.post('/api/auth/register',{data:{username:`editor_${randomUUID().slice(0,8)}`,name,password:'Editing browser fixture!'}});expect(r.status()).toBe(201);return (await r.json()).user;}
  await register(page.context(),'Alice');
  const tree=(await(await page.request.post('/api/communities',{data:{name:'Editing Tree'}})).json()).community;
  const nest=(await(await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Family chat'}})).json()).group;
  const invite=(await(await page.request.post('/api/invitations',{data:{community_id:tree.id}})).json()).path.split('invite=')[1];
  const peer=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'}),later=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'});
  try{
    await register(peer,'Bob');await peer.request.post('/api/invitations/accept',{data:{token:invite}});await peer.request.post(`/api/groups/${nest.id}/join`);
    const bp=await peer.newPage();bp.on('pageerror',e=>errors.push(e.message));
    const url=`/?community=${tree.id}&group=${nest.id}`;await page.goto(url);await bp.goto(url);
    await expect(page.getByRole('textbox',{name:'Write a message',exact:true})).toBeVisible();
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=','base64');
    await page.locator('.composer input[type=file]').first().setInputFiles([{name:'photo.png',mimeType:'image/png',buffer:png},{name:'notes.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nKeep these notes')}]);
    await page.getByRole('textbox',{name:'Write a message',exact:true}).fill('Bring the picinc blanket');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(bp.locator('.message-bubble>p')).toHaveText('Bring the picinc blanket');
    await expect(bp.getByRole('button',{name:'Edit message',exact:true})).toHaveCount(0);
    const original=(await(await page.request.get(`/api/groups/${nest.id}/messages`)).json()).messages[0];
    const own=page.locator('.message').filter({hasText:'Bring the picinc blanket'});
    await own.getByRole('button',{name:'Edit message',exact:true}).click();
    await page.getByRole('textbox',{name:'Message text',exact:true}).fill('Discard this change');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.locator('.message-bubble>p')).toHaveText('Bring the picinc blanket');
    await register(later,'Later joiner');await later.request.post('/api/invitations/accept',{data:{token:invite}});await later.request.post(`/api/groups/${nest.id}/join`);
    await own.getByRole('button',{name:'Edit message',exact:true}).click();
    const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Attachments stay with this message.');
    await dialog.getByRole('textbox',{name:'Message text',exact:true}).fill('Bring the picnic blanket');
    await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(bp.locator('.message-bubble>p')).toHaveText('Bring the picnic blanket');
    await expect(bp.locator('.message-edited')).toHaveText('edited');
    await expect(bp.locator('.file-attachment')).toContainText('notes.pdf');
    await expect.poll(()=>bp.locator('.image-attachment img').evaluate(img=>img.naturalWidth)).toBe(1);
    const edited=(await(await page.request.get(`/api/groups/${nest.id}/messages`)).json()).messages[0];
    expect(edited.id).toBe(original.id);expect(edited.created_at).toBe(original.created_at);expect(edited.user_id).toBe(original.user_id);expect(edited.client_id).toBe(original.client_id);expect(edited.edit_version).toBe(1);expect(edited.body).toBe('');
    expect((await(await later.request.get(`/api/groups/${nest.id}/messages`)).json()).messages).toEqual([]);
    await bp.locator('.message').getByRole('button',{name:'Reply to Alice',exact:true}).click();
    await bp.getByRole('textbox',{name:'Write a message',exact:true}).fill('I will bring it');await bp.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(page.locator('.message-bubble>p').filter({hasText:'I will bring it'})).toBeVisible();
    await page.locator('.message.own').filter({hasText:'Bring the picnic blanket'}).getByRole('button',{name:'Thread',exact:true}).click();
    await expect(page.locator('.thread-messages')).toContainText('I will bring it');
    const bobOwn=bp.locator('.message.own');await bobOwn.getByRole('button',{name:'Edit message',exact:true}).click();
    await bp.getByRole('textbox',{name:'Message text',exact:true}).fill('I will bring two blankets');await bp.getByRole('button',{name:'Save changes',exact:true}).click();
    await expect(page.locator('.thread-messages')).toContainText('I will bring two blankets');
    await page.getByRole('button',{name:'Close thread',exact:true}).click();
    await page.reload();await expect(page.locator('.message-bubble>p').filter({hasText:'Bring the picnic blanket'})).toBeVisible();await expect(page.locator('.message-edited')).toHaveCount(2);
    await page.screenshot({path:info.outputPath('edited-message.png'),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBeTruthy();
    expect(edits.length).toBe(1);expect(edits[0]).not.toContain('Bring the picnic blanket');expect(edits[0]).not.toContain('notes.pdf');expect(errors).toEqual([]);
  }finally{await peer.close();await later.close();}
});
