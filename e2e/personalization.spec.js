import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {chooseMessageAction} from './message-options';

const tab=(page,name)=>page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('button',{name,exact:true}).click();
async function register(ctx,name){const r=await ctx.request.post('/api/auth/register',{data:{birth_date:'1990-01-01',username:`names_${randomUUID().slice(0,8)}`,name,password:'Personalization browser fixture!'}});expect(r.status()).toBe(201);return (await r.json()).user;}
async function setup(page,browser,info){
 await register(page.context(),'Sender');
 const tree=(await(await page.request.post('/api/communities',{data:{name:'Personalized Tree'}})).json()).community,invite=(await(await page.request.post('/api/invitations',{data:{community_id:tree.id}})).json());
 const peers=[];
 for(const name of ['Avery Brown','Blake Rivera']){const context=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'});const user=await register(context,name);await context.request.post('/api/invitations/accept',{data:{token:invite.code}});peers.push({context,user});}
 await page.goto('/');await tab(page,'Messages');await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('button',{name:/Send Many Individually/}).click();
 return {tree,peers,close:async()=>{for(const peer of peers)await peer.context.close();}};
}

test('first-name templates preview and deliver different encrypted Churp messages and separate phone texts',async({page,browser},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Prevent the browser from launching a real external messaging app.
 await page.addInitScript(()=>document.addEventListener('click',e=>{if(e.target.closest('a[href^="sms:"]'))e.preventDefault();},true));
 const f=await setup(page,browser,info);
 try{
  // Refresh the chooser after adding the selected phone-only contacts.
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  for(const [name,phone] of [['Cameron Green','+12025550126'],['Devon Blue','+12025550127']])await page.request.post('/api/contacts',{data:{name,phone}});
  await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('button',{name:/Send Many Individually/}).click();let d=page.getByRole('dialog');
  for(const peer of f.peers)await d.getByRole('checkbox',{name:new RegExp(peer.user.name)}).check();
  await d.getByRole('button',{name:'Contacts',exact:true}).click();for(const name of ['Cameron Green','Devon Blue'])await d.getByRole('checkbox',{name:new RegExp(name)}).check();
  await d.getByRole('button',{name:'Next',exact:true}).click();const input=d.getByLabel('Your message',{exact:true});await input.fill('Hi , see you soon!');await input.evaluate(el=>{el.focus();el.setSelectionRange(3,3);});await d.getByRole('button',{name:'Insert first name',exact:true}).click();await expect(input).toHaveValue('Hi [first name], see you soon!');
  await d.getByRole('button',{name:'Review',exact:true}).click();
  for(const name of ['Avery','Blake','Cameron','Devon'])await expect(d.locator('.personalized-recipient-preview').filter({hasText:`Hi ${name}, see you soon!`})).toHaveCount(1);
  await page.screenshot({path:info.outputPath('personalized-recipient-review.png'),fullPage:true});
  await d.getByRole('button',{name:'Send Churp messages & prepare phone drafts',exact:true}).click();await expect(d).toContainText('Avery Brown · Sent');await expect(d).toContainText('Blake Rivera · Sent');
  const conversations=(await(await page.request.get('/api/private/conversations')).json()).conversations;
  for(const peer of f.peers){const conversation=conversations.find(c=>c.peer_id===peer.user.id),p=await peer.context.newPage();await p.goto(`/?conversation=${conversation.id}`);await expect(p.locator('.private-bubble')).toContainText(`Hi ${peer.user.name.split(' ')[0]}, see you soon!`);await expect(p.locator('.private-bubble')).not.toContainText('[first name]');await p.close();}
  await d.getByRole('button',{name:'Open phone drafts',exact:true}).click();
  for(const name of ['Cameron Green','Devon Blue']){await d.locator('.phone-draft-recipients article').filter({hasText:name}).getByRole('button',{name:'Review phone text',exact:true}).click();const href=await d.getByRole('link',{name:'Open in Messages',exact:true}).getAttribute('href');expect(decodeURIComponent(href.split('body=')[1])).toContain(`Hi ${name.split(' ')[0]}, see you soon!`);expect(decodeURIComponent(href)).not.toContain('[first name]');await d.getByRole('button',{name:'Back to recipients',exact:true}).click();}
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.close();}
});

test('editing and rescheduling a mass message preserves each recipient name and the encrypted template',async({page,browser},info)=>{
 const f=await setup(page,browser,info);
 try{
  let d=page.getByRole('dialog');for(const peer of f.peers)await d.getByRole('checkbox',{name:new RegExp(peer.user.name)}).check();await d.getByRole('button',{name:'Next',exact:true}).click();await d.getByLabel('Your message',{exact:true}).fill('Hi [first name], an early plan.');await d.getByRole('checkbox',{name:'Schedule send',exact:true}).check();await d.getByRole('button',{name:'Review',exact:true}).click();await d.getByRole('button',{name:'Schedule 2 private messages',exact:true}).click();await d.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:'Open private conversation with Avery Brown',exact:true}).click();let preview=page.locator('.private-messages .scheduled-inline');await expect(preview).toContainText('Hi Avery, an early plan.');await expect(preview.locator('.message-bubble')).not.toContainText('[first name]');
  await chooseMessageAction(page,preview,'Edit');d=page.getByRole('dialog');await expect(d.getByLabel('Scheduled message',{exact:true})).toHaveValue('Hi [first name], an early plan.');await d.getByLabel('Scheduled message',{exact:true}).fill('Updated for [first name].');await expect(d.locator('.personalized-recipient-preview').filter({hasText:'Updated for Blake.'})).toBeVisible();await d.getByRole('button',{name:'Save scheduled send',exact:true}).click();await expect(preview).toContainText('Updated for Avery.');
  await chooseMessageAction(page,preview,'Reschedule');d=page.getByRole('dialog');const later=await page.evaluate(()=>{const x=new Date(Date.now()+7200000);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}T${String(x.getHours()).padStart(2,'0')}:${String(x.getMinutes()).padStart(2,'0')}`;});await d.getByLabel('Send date and time',{exact:true}).fill(later);await d.getByRole('button',{name:'Save scheduled send',exact:true}).click();await expect(preview).toContainText('Updated for Avery.');
  const sealed=await page.evaluate(async()=>{const {api}=await import('/src/api.js'),{getCurrent}=await import('/src/encryption/client.js'),enc=await import('/shared/encryption.js');const row=(await api('/scheduled')).sends[0],self=getCurrent();const bodies=[];for(const entry of row.entries)bodies.push((await enc.open(self.privateKey,self.publicKey,entry.request.ciphertext)).body);return {bodies,raw:JSON.stringify(row)};});
  expect(sealed.bodies.sort()).toEqual(['Updated for Avery.','Updated for Blake.']);expect(sealed.raw).not.toContain('Updated for Avery.');
  await page.getByRole('button',{name:'Back to private conversations',exact:true}).click();await page.getByRole('button',{name:'Open private conversation with Blake Rivera',exact:true}).click();await expect(page.locator('.private-messages .scheduled-inline')).toContainText('Updated for Blake.');
 }finally{await f.close();}
});
