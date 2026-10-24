import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('encrypted RSVP invitations hatch eggs, separate guest totals, update live and appear in the shared Nest library', async ({page,browser},info)=>{
  const errors=[],writes=[];
  const listen=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(['POST','PUT'].includes(r.method()) && /\/api\/(groups\/.*\/messages|messages\/.*\/(rsvp\/respond|content))/.test(r.url()))writes.push(r.postData() || '');});};listen(page);
  async function register(context,name){const r=await context.request.post('/api/auth/register',{data:{username:`rsvp_${randomUUID().slice(0,8)}`,name,password:'RSVP browser password!'}});expect(r.status()).toBe(201);return(await r.json()).user;}
  await register(page.context(),'Organizer');
  const tree=(await(await page.request.post('/api/communities',{data:{name:'Picnic Tree'}})).json()).community;
  const nest=(await(await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Picnic Nest',admin_only:true}})).json()).group;
  const invite=(await(await page.request.post('/api/invitations',{data:{community_id:tree.id}})).json()).path.split('invite=')[1];
  const context=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'});
  try{
    await register(context,'Participant');await context.request.post('/api/invitations/accept',{data:{token:invite}});await context.request.post(`/api/groups/${nest.id}/join`);
    const member=await context.newPage();listen(member);
    const url=`/?community=${tree.id}&group=${nest.id}`;await page.goto(url);await member.goto(url);
    await expect(page.getByRole('textbox',{name:'Write a message',exact:true})).toBeVisible();await expect(member.locator('.read-only')).toBeVisible();
    await page.getByRole('button',{name:'Add to chat',exact:true}).click();
    await expect(page.getByRole('button',{name:'Poll',exact:true}).locator('img')).toHaveAttribute('src','/brand/activities/poll-ballot.png');
    await page.getByRole('button',{name:'RSVP',exact:true}).click();let dialog=page.getByRole('dialog');
    await dialog.getByRole('textbox',{name:'Event title',exact:true}).fill('Our spring picnic');
    await dialog.getByLabel('Start date and time',{exact:true}).fill('2027-04-17T11:00');
    await dialog.getByLabel('End date and time (optional)',{exact:true}).fill('2027-04-17T14:00');
    await dialog.getByRole('textbox',{name:'Location or meeting link (optional)',exact:true}).fill('Maple Park');
    await dialog.getByRole('textbox',{name:'Description (optional)',exact:true}).fill('Bring your favorite blanket.');
    await dialog.getByRole('button',{name:'Send invitation',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(member.getByRole('button',{name:'Open RSVP: Our spring picnic',exact:true})).toBeVisible();
    const envelope=member.getByRole('button',{name:'Open RSVP: Our spring picnic',exact:true});
    await expect.poll(()=>envelope.locator('.envelope-open').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
    await envelope.evaluate(button=>{window.envelopeSwap={};window.envelopeObserver=new MutationObserver(()=>{const s=window.envelopeSwap;if(button.classList.contains('is-opening') && !s.start){s.start=performance.now();s.opacity=getComputedStyle(button.querySelector('.envelope-open')).opacity;}if(document.querySelector('[role=dialog]') && s.start && !s.end)s.end=performance.now();});window.envelopeObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});});
    await envelope.click();dialog=member.getByRole('dialog');await expect(dialog.getByText('Maple Park',{exact:true})).toBeVisible();
    const swap=await member.evaluate(()=>{window.envelopeObserver.disconnect();return window.envelopeSwap;});expect(swap.opacity).toBe('1');expect(swap.end-swap.start).toBeGreaterThanOrEqual(190);expect(swap.end-swap.start).toBeLessThan(700);
    await expect(dialog.getByRole('button',{name:'Edit event',exact:true})).toHaveCount(0);
    await expect(dialog.getByRole('spinbutton',{name:'Additional guests',exact:true})).toHaveCount(0);
    await dialog.getByRole('radio',{name:'Going',exact:true}).check();
    await expect(dialog.locator('.rsvp-hatch.is-hatched .rsvp-hatchling')).toHaveAttribute('src','/brand/activities/rsvp-happy.png');
    await expect(dialog.getByRole('spinbutton',{name:'Additional guests',exact:true})).toBeVisible();await dialog.getByRole('spinbutton',{name:'Additional guests',exact:true}).fill('2');
    await dialog.getByRole('button',{name:'Save response',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Your response is saved: Going.');
    await member.screenshot({path:info.outputPath('rsvp-going-hatch.png'),fullPage:true});
    await page.getByRole('button',{name:'Open RSVP: Our spring picnic',exact:true}).click();let ownerDialog=page.getByRole('dialog');
    await ownerDialog.getByRole('radio',{name:'Maybe',exact:true}).check();await ownerDialog.getByRole('spinbutton',{name:'Additional guests',exact:true}).fill('3');await ownerDialog.getByRole('button',{name:'Save response',exact:true}).click();await expect(ownerDialog.getByRole('status')).toContainText('Your response is saved: Maybe.');
    await ownerDialog.getByRole('button',{name:'Responses',exact:true}).click();
    await expect(ownerDialog.locator('.rsvp-totals section').nth(0)).toContainText('1 member + 2 guests');await expect(ownerDialog.locator('.rsvp-totals section').nth(0).locator('strong')).toHaveText('3');
    await expect(ownerDialog.locator('.rsvp-totals section').nth(1)).toContainText('1 member + 3 guests');await expect(ownerDialog.locator('.rsvp-totals section').nth(1).locator('strong')).toHaveText('4');
    await expect(ownerDialog.locator('.rsvp-response-list')).toContainText('Participant');await expect(ownerDialog.locator('.rsvp-response-list')).toContainText('party of 3');
    await ownerDialog.getByRole('button',{name:'No response (0)',exact:true}).click();await expect(ownerDialog).toContainText('No members in this list yet.');
    await member.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(member.locator('.rsvp-card-status')).toHaveText('You’re going');
    await member.reload();await member.getByRole('button',{name:'Open RSVP: Our spring picnic',exact:true}).click();dialog=member.getByRole('dialog');
    await expect(dialog.getByRole('radio',{name:'Going',exact:true})).toBeChecked();await expect(dialog.getByRole('spinbutton',{name:'Additional guests',exact:true})).toHaveValue('2');
    await dialog.getByRole('radio',{name:'Maybe',exact:true}).check();await expect(dialog.locator('.rsvp-hatch.is-hatched .rsvp-hatchling')).toHaveAttribute('src','/brand/activities/rsvp-questioning.png');
    await dialog.getByRole('spinbutton',{name:'Additional guests',exact:true}).fill('1');await dialog.getByRole('button',{name:'Update response',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Your response is saved: Maybe.');
    await expect(ownerDialog.locator('.rsvp-totals section').nth(0).locator('strong')).toHaveText('0');await expect(ownerDialog.locator('.rsvp-totals section').nth(1).locator('strong')).toHaveText('6');
    await dialog.getByRole('button',{name:'Responses',exact:true}).click();await expect(dialog.locator('.rsvp-response-list')).toHaveCount(0);await expect(dialog.locator('.rsvp-totals section').nth(1).locator('strong')).toHaveText('6');
    await dialog.getByRole('button',{name:'Invitation',exact:true}).click();await dialog.getByRole('radio',{name:'Can’t go',exact:true}).check();await expect(dialog.locator('.rsvp-hatch.is-hatched .rsvp-hatchling')).toHaveAttribute('src','/brand/activities/rsvp-sad.png');await expect(dialog.getByRole('spinbutton')).toHaveCount(0);
    await dialog.getByRole('button',{name:'Update response',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Your response is saved: Can’t go.');
    await ownerDialog.getByRole('button',{name:'Edit event',exact:true}).click();ownerDialog=page.getByRole('dialog');await ownerDialog.getByRole('textbox',{name:'Event title',exact:true}).fill('Spring picnic updated');await ownerDialog.getByRole('button',{name:'Save event',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('heading',{name:'Spring picnic updated',exact:true})).toBeVisible();await expect(dialog.getByRole('heading',{name:'Spring picnic updated',exact:true})).toBeVisible();await expect(dialog.getByRole('radio',{name:'Can’t go',exact:true})).toBeChecked();
    ownerDialog=page.getByRole('dialog');await ownerDialog.getByRole('button',{name:'Close responses',exact:true}).click();await expect(dialog.getByRole('radio',{name:'Going',exact:true})).toBeDisabled();
    await ownerDialog.getByRole('button',{name:'Reopen responses',exact:true}).click();await expect(dialog.getByRole('radio',{name:'Going',exact:true})).toBeEnabled();
    await ownerDialog.getByRole('button',{name:'Cancel event',exact:true}).click();await ownerDialog.getByRole('button',{name:'Yes, cancel event',exact:true}).click();await expect(dialog).toContainText('Canceled · This event is no longer happening.');await expect(dialog.getByRole('radio',{name:'Going',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();await member.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(member.locator('.rsvp-card-status')).toHaveText('Canceled');
    await member.getByRole('button',{name:'Open shared items',exact:true}).click();await member.getByRole('dialog').getByRole('button',{name:/^RSVPs/}).click();await expect(member.getByRole('dialog').locator('.rsvp-envelope strong')).toHaveText('Spring picnic updated');
    await member.getByRole('dialog').getByRole('button',{name:'Open RSVP: Spring picnic updated',exact:true}).click();await expect(member.getByRole('dialog').getByRole('heading',{name:'Spring picnic updated',exact:true})).toBeVisible();await expect(member.getByRole('dialog')).toHaveCount(1);await expect(member.getByRole('dialog')).toContainText('Canceled');await member.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(member.getByRole('dialog').getByRole('heading',{name:'RSVPs',exact:true})).toBeVisible();
    const messages=(await(await page.request.get(`/api/groups/${nest.id}/messages`)).json()).messages;expect(messages).toHaveLength(1);expect(messages[0].body).toBe('');expect(messages[0].edit_version).toBe(1);
    for(const w of writes){expect(w).not.toContain('Our spring picnic');expect(w).not.toContain('Spring picnic updated');expect(w).not.toContain('Maple Park');expect(w).not.toContain('"guests"');}expect(writes.length).toBeGreaterThanOrEqual(5);
    expect(await member.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBeTruthy();
    expect(await member.locator('img').evaluateAll(imgs=>imgs.filter(i=>i.complete && !i.naturalWidth).map(i=>i.src))).toEqual([]);expect(errors).toEqual([]);
  } finally {await context.close();}
});

test('admins can edit another member’s all-day invitation and reopen an expired deadline without clearing responses',async({page,browser},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const create=async(ctx,name)=>{const r=await ctx.request.post('/api/auth/register',{data:{username:`rsvp_edit_${randomUUID().slice(0,7)}`,name,password:'RSVP editor password!'}});expect(r.status()).toBe(201);};
  await create(page.context(),'Tree admin');const tree=(await(await page.request.post('/api/communities',{data:{name:'Event Tree'}})).json()).community;
  const nest=(await(await page.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Member events'}})).json()).group;
  const invite=(await(await page.request.post('/api/invitations',{data:{community_id:tree.id}})).json()).path.split('invite=')[1];
  const context=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101',reducedMotion:'reduce'});
  try{
    await create(context,'Event creator');await context.request.post('/api/invitations/accept',{data:{token:invite}});await context.request.post(`/api/groups/${nest.id}/join`);
    const member=await context.newPage();member.on('pageerror',e=>errors.push(e.message));const url=`/?community=${tree.id}&group=${nest.id}`;await page.goto(url);await member.goto(url);
    await expect(page.getByRole('textbox',{name:'Write a message',exact:true})).toBeVisible();
    await member.getByRole('button',{name:'Add to chat',exact:true}).click();await member.getByRole('button',{name:'RSVP',exact:true}).click();
    let d=member.getByRole('dialog');await d.getByRole('textbox',{name:'Event title',exact:true}).fill('All-day family outing');await d.getByRole('checkbox',{name:'All day',exact:true}).check();await d.getByLabel('Start date',{exact:true}).fill('2027-05-20');await d.getByRole('button',{name:'Send invitation',exact:true}).click();await expect(d).toHaveCount(0);
    await member.getByRole('button',{name:'Open RSVP: All-day family outing',exact:true}).click();d=member.getByRole('dialog');await d.getByRole('radio',{name:'Going',exact:true}).check();
    await expect(d.locator('.rsvp-hatch.is-hatched .rsvp-hatchling')).toHaveCSS('animation-name','none');await expect(d.locator('.rsvp-hatch.is-hatched .rsvp-hatchling')).toHaveCSS('opacity','1');
    await d.getByRole('button',{name:'Save response',exact:true}).click();await expect(d.getByRole('status')).toContainText('Your response is saved: Going.');
    await page.getByRole('button',{name:'Open RSVP: All-day family outing',exact:true}).click();let a=page.getByRole('dialog');await expect(a).toContainText('All day');
    await a.getByRole('button',{name:'Edit event',exact:true}).click();a=page.getByRole('dialog');await a.getByRole('textbox',{name:'Event title',exact:true}).fill('Outing updated by admin');await a.getByLabel('Response deadline (optional)',{exact:true}).fill('2020-01-01T12:00');await a.getByRole('button',{name:'Save event',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('heading',{name:'Outing updated by admin',exact:true})).toBeVisible();await expect(d.getByRole('heading',{name:'Outing updated by admin',exact:true})).toBeVisible();await expect(d.getByRole('radio',{name:'Going',exact:true})).toBeChecked();await expect(d.getByRole('radio',{name:'Going',exact:true})).toBeDisabled();await expect(d.getByRole('status')).toContainText('Responses are closed.');
    a=page.getByRole('dialog');await a.getByRole('button',{name:'Edit event',exact:true}).click();await page.getByRole('dialog').getByLabel('Response deadline (optional)',{exact:true}).fill('');await page.getByRole('button',{name:'Save event',exact:true}).click();
    await expect(d.getByRole('radio',{name:'Going',exact:true})).toBeEnabled();await expect(d.getByRole('radio',{name:'Going',exact:true})).toBeChecked();
    await page.getByRole('dialog').getByRole('button',{name:'Responses',exact:true}).click();await expect(page.locator('.rsvp-totals section').first().locator('strong')).toHaveText('1');
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();await member.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.reload();await member.reload();await expect(page.getByRole('button',{name:'Open RSVP: Outing updated by admin',exact:true})).toBeVisible();await expect(member.getByRole('button',{name:'Open RSVP: Outing updated by admin',exact:true})).toBeVisible();
    await member.getByRole('button',{name:'Open RSVP: Outing updated by admin',exact:true}).click();await expect(member.getByRole('radio',{name:'Going',exact:true})).toBeChecked();expect(errors).toEqual([]);
  }finally{await context.close();}
});
