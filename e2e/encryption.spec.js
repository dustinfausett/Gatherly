import {chooseMessageAction} from './message-options';
import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import * as enc from '../shared/encryption.js';

const password='encrypted browser fixture password';
async function register(context,name){const username=`secure_${randomUUID().slice(0,8)}`;const r=await context.request.post('/api/auth/register',{data:{birth_date:'1990-01-01',username,name,password}});expect(r.status()).toBe(201);return {...(await r.json()).user,username};}
async function setup(page){
  await page.goto('/');await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'Security',exact:true}).click();
  await page.getByRole('button',{name:'Use self-managed keys',exact:true}).click();
  const recovery=await page.getByRole('textbox',{name:'Your recovery key',exact:true}).inputValue();expect(recovery).toMatch(/^CHURP1-/);
  await page.getByRole('checkbox',{name:'I saved my recovery key somewhere safe.',exact:true}).check();
  await page.getByRole('button',{name:'Enable self-managed encryption',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit your profile',exact:true})).toBeVisible();await expect(page.locator('.recovery-card')).toHaveCount(0);return recovery;
}
async function makeTree(context){const tree=(await (await context.request.post('/api/communities',{data:{name:'Private family Tree'}})).json()).community;
  const nest=(await (await context.request.post(`/api/communities/${tree.id}/circles`,{data:{name:'Family chat'}})).json()).group;
  const invite=(await (await context.request.post('/api/invitations',{data:{community_id:tree.id}})).json()).path.split('invite=')[1];return {tree,nest,invite};}
const openNest=async page=>{await page.getByRole('button',{name:'Open Nest Family chat',exact:true}).click();await expect(page.locator('.chat-heading h1')).toHaveText('Family chat');};
async function send(page,text){await page.getByRole('textbox',{name:'Write a message',exact:true}).fill(text);await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.locator('.message-bubble').filter({hasText:text})).toBeVisible();}
function database(){const dir=process.env.GATHERLY_E2E_DATA_DIR;if(!dir?.includes('gatherly-browser-e2ee-'))throw new Error('Refusing to open non-test storage.');const db=new DatabaseSync(join(dir,'gatherly.sqlite'));db.exec('PRAGMA busy_timeout=5000');return db;}

 test('browser encrypts messages and files; join floors, replies and removal hold',async({page,browser},info)=>{
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST' && /\/api\/(e2ee|groups\/.*\/messages)/.test(r.url()))requests.push(r.postDataBuffer() || Buffer.alloc(0));});
  const alice=await register(page.context(),'Alice'),recovery=await setup(page),{tree,nest,invite}=await makeTree(page.context());
  await page.reload();await openNest(page);
  const secret=`Only before joining ${randomUUID()}`,attachment=Buffer.from(`PRIVATE ATTACHMENT ${randomUUID()}`),filename='family-secret-notes.txt';
  const picture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=','base64');
  await page.locator('.composer input[type=file]').first().setInputFiles([{name:filename,mimeType:'text/plain',buffer:attachment},{name:'private-photo.png',mimeType:'image/png',buffer:picture}]);
  await expect(page.locator('.pending-files')).toContainText(filename);await send(page,secret);
  await expect(page.locator('.file-attachment')).toHaveAttribute('href',/^blob:/);
  await expect(page.locator('.image-attachment img')).toHaveAttribute('src',/^blob:/);
  await expect.poll(()=>page.locator('.image-attachment img').evaluate(img=>img.naturalWidth)).toBe(1);
  const downloadPromise=page.waitForEvent('download');await page.locator('.file-attachment').click();const download=await downloadPromise;
  expect(readFileSync(await download.path())).toEqual(attachment);expect(download.suggestedFilename()).toBe(filename);
  const messages=(await (await page.request.get(`/api/groups/${nest.id}/messages`)).json()).messages;
  expect(messages[0].body).toBe('');expect(JSON.stringify(messages)).not.toContain(secret);expect(JSON.stringify(messages)).not.toContain(filename);
  const db=database();try{expect(db.prepare('SELECT body FROM messages WHERE id=?').get(messages[0].id).body).toBe('');}finally{db.close();}
  for(const request of requests){expect(request.includes(Buffer.from(secret))).toBeFalsy();expect(request.includes(attachment)).toBeFalsy();expect(request.includes(Buffer.from(filename))).toBeFalsy();expect(request.includes(Buffer.from(recovery))).toBeFalsy();}
  const second=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'});
  try{
    const bob=await register(second,'Bob'),bp=await second.newPage();bp.on('pageerror',e=>errors.push(e.message));await setup(bp);
    await second.request.post('/api/invitations/accept',{data:{token:invite}});await bp.reload();await openNest(bp);
    await expect(bp.getByText(secret,{exact:true})).toHaveCount(0);
    await expect(bp.getByText('Join this Nest to receive messages from that point onward. Earlier messages are not shared with new members.',{exact:true})).toBeVisible();
    expect((await second.request.get(`/api/groups/${nest.id}/messages`)).status()).toBe(403);
    await bp.getByRole('button',{name:'Join Nest',exact:true}).click();await expect(bp.getByRole('textbox',{name:'Write a message',exact:true})).toBeVisible();
    await expect(bp.locator('.message-bubble')).toHaveCount(0);
    expect((await second.request.get(`/api/files/${messages[0].files[0].id}`)).status()).toBe(404);
    const later=`Both members can read ${randomUUID()}`;await send(page,later);await expect(bp.locator('.message-bubble').filter({hasText:later})).toBeVisible();
    const target=bp.locator('.message').filter({has:bp.locator('.message-bubble>p').filter({hasText:later})});await chooseMessageAction(bp,target,'Reply to Alice');await send(bp,'An encrypted reply');
    await expect(page.locator('.message-bubble').filter({hasText:'An encrypted reply'})).toBeVisible();
    await chooseMessageAction(bp,target,'Thread');await expect(bp.locator('.thread-messages')).toContainText('An encrypted reply');
    await page.request.delete(`/api/communities/${tree.id}/members/${bob.id}`);await expect(bp.locator('.chat-heading')).toHaveCount(0);
    await send(page,'Sent after removal');expect((await second.request.get(`/api/groups/${nest.id}/messages`)).status()).toBe(403);
    await page.screenshot({path:info.outputPath('encrypted-chat.png'),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
  }finally{await second.close();}
});

test('new devices need recovery or two-device approval; sign-out removes local keys',async({page,browser},info)=>{
  const user=await register(page.context(),'Owner'),recovery=await setup(page),{nest}=await makeTree(page.context());await page.reload();await openNest(page);await send(page,'History survives a verified device recovery');
  const recoveryContext=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'}),transferContext=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'});
  try{
    await recoveryContext.request.post('/api/auth/login',{data:{username:user.username,password}});const recovered=await recoveryContext.newPage();await recovered.goto('/');
    await expect(recovered.getByRole('heading',{name:'Unlock this device',exact:true})).toBeVisible();
    await recovered.getByRole('textbox',{name:'Recovery key',exact:true}).fill('CHURP1-'+'0'.repeat(64));await recovered.getByRole('button',{name:'Restore with recovery key',exact:true}).click();await expect(recovered.getByRole('alert')).toContainText('could not unlock');
    await recovered.getByRole('textbox',{name:'Recovery key',exact:true}).fill(recovery);await recovered.getByRole('button',{name:'Restore with recovery key',exact:true}).click();await expect(recovered.locator('.encryption-gate')).toHaveCount(0);await openNest(recovered);
    await expect(recovered.locator('.message-bubble')).toContainText('History survives a verified device recovery');
    await recovered.getByRole('button',{name:'Edit your profile',exact:true}).click();await recovered.getByRole('button',{name:'Sign out of Churp',exact:true}).click();
    await recoveryContext.request.post('/api/auth/login',{data:{username:user.username,password}});await recovered.goto('/');await expect(recovered.getByRole('heading',{name:'Unlock this device',exact:true})).toBeVisible();
    await transferContext.request.post('/api/auth/login',{data:{username:user.username,password}});const fresh=await transferContext.newPage();await fresh.goto('/');await fresh.getByRole('button',{name:'Request device approval',exact:true}).click();
    const requestField=fresh.getByRole('textbox',{name:'Device request code',exact:true});await expect(requestField).toHaveValue(/^[A-F0-9]{8}(-[A-F0-9]{8}){2}$/);
    const request=await requestField.inputValue();expect(request.replaceAll('-','')).toHaveLength(24);
    await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'Security',exact:true}).click();await page.getByRole('textbox',{name:'Request code from new device',exact:true}).fill(request);await page.getByRole('button',{name:'Approve device',exact:true}).click();
    const finish=await page.getByRole('textbox',{name:'Device approval finish code',exact:true}).inputValue();expect(finish.replaceAll('-','')).toHaveLength(32);
    await fresh.getByRole('textbox',{name:'Finish code from approved device',exact:true}).fill('wrong');await fresh.getByRole('button',{name:'Finish device approval',exact:true}).click();await expect(fresh.getByRole('alert')).toContainText('does not match');
    await fresh.getByRole('textbox',{name:'Finish code from approved device',exact:true}).fill(finish);await fresh.getByRole('button',{name:'Finish device approval',exact:true}).click();await expect(fresh.locator('.encryption-gate')).toHaveCount(0);await openNest(fresh);
    await expect(fresh.locator('.message-bubble')).toContainText('History survives a verified device recovery');
    const records=(await (await fresh.request.get(`/api/groups/${nest.id}/messages`)).json()).messages;expect(records[0].body).toBe('');
  }finally{await recoveryContext.close();await transferContext.close();}
});

test('a changed contact identity is blocked rather than silently trusted',async({page,browser},info)=>{
  const alice=await register(page.context(),'Alice'),recovery=await setup(page),{tree,nest,invite}=await makeTree(page.context());await page.reload();await openNest(page);
  const other=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'});
  try{
    await register(other,'Bob');const bp=await other.newPage();await setup(bp);await other.request.post('/api/invitations/accept',{data:{token:invite}});await other.request.post(`/api/groups/${nest.id}/join`);await bp.reload();await openNest(bp);
    await send(page,'Pin the original sender identity');await expect(bp.locator('.message-bubble')).toContainText('Pin the original sender identity');
    const account=await (await page.request.get('/api/e2ee/account')).json(),fake=await enc.generateIdentity(alice.id),db=database();
    try{db.prepare('UPDATE e2ee_identities SET public_key=?,fingerprint=? WHERE user_id=?').run(fake.publicKey,fake.fingerprint,alice.id);}finally{db.close();}
    const headers={'x-churp-device':account.devices[0].id},rs=await (await page.request.get(`/api/groups/${nest.id}/e2ee/roster`,{headers})).json(),clientId=randomUUID();
    const cipher=await enc.seal(fake.privateKey,rs.readers.map(r=>r.public_key),{version:1,kind:'nest-message',groupId:nest.id,clientId,senderId:alice.id,signerId:alice.id,rosterHash:rs.roster_hash,replyTo:null,migrated:false,body:'Forged identity must never be displayed',attachments:[]});
    const payload=enc.sendPayload({groupId:nest.id,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(cipher),files:[],replyTo:null});
    expect((await page.request.post(`/api/groups/${nest.id}/messages`,{headers,data:{ciphertext:cipher,clientId,rosterHash:rs.roster_hash,files:[],reply_to:null,signature:await enc.sign(fake.privateKey,'send',payload)}})).status()).toBe(201);
    await expect(bp.getByText('Forged identity must never be displayed',{exact:true})).toHaveCount(0);await expect(bp.getByText('This message could not be decrypted or verified.',{exact:true}).first()).toBeVisible();
    await expect(bp.locator('.message').filter({has:bp.getByText('This message could not be decrypted or verified.',{exact:true})}).locator('.message-protection')).toHaveCount(0);
    await page.getByRole('textbox',{name:'Write a message',exact:true}).fill('Do not encrypt to a changed identity');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('alert')).toContainText(/identity changed|key settings changed/);
    // Restore the fixture so cleanup of this account does not leave an artificial key change.
    const restored=await enc.recoverPrivate(account.identity.backup,recovery.replace(/^CHURP1-/,'').replaceAll('-','').toLowerCase()),restoreDb=database();try{restoreDb.prepare('UPDATE e2ee_identities SET public_key=?,fingerprint=? WHERE user_id=?').run(restored.toPublic().armor(),restored.getFingerprint(),alice.id);}finally{restoreDb.close();}
  }finally{await other.close();}
});

test('browser converts earlier history and attachments without exposing it to a later joiner',async({page,browser},info)=>{
  const alice=await register(page.context(),'Alice');await setup(page);const {tree,nest,invite}=await makeTree(page.context());await page.reload();
  const secret=`EARLIER HISTORY ${randomUUID()}`,oldFile=Buffer.from(`EARLIER FILE ${randomUUID()}`),fileId=randomUUID(),diskName=randomUUID();let messageId;
  const db=database();try{
    writeFileSync(join(process.env.GATHERLY_E2E_DATA_DIR,'uploads',diskName),oldFile);
    db.prepare('INSERT INTO files(id,user_id,name,disk_name,mime,size,created_at) VALUES (?,?,?,?,?,?,?)').run(fileId,alice.id,'earlier.txt',diskName,'application/octet-stream',oldFile.length,Date.now());
    messageId=Number(db.prepare('INSERT INTO messages(group_id,user_id,body) VALUES (?,?,?)').run(nest.id,alice.id,secret).lastInsertRowid);
    db.prepare('INSERT INTO message_files VALUES (?,?)').run(messageId,fileId);db.prepare('INSERT INTO e2ee_legacy_readers VALUES (?,?)').run(messageId,alice.id);
  }finally{db.close();}
  const other=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'});
  try{
    await register(other,'Later member');const bp=await other.newPage();await setup(bp);await other.request.post('/api/invitations/accept',{data:{token:invite}});await other.request.post(`/api/groups/${nest.id}/join`);await bp.reload();await openNest(bp);
    await expect(bp.locator('.message-bubble')).toHaveCount(0);await openNest(page);await expect(page.locator('.message-bubble')).toContainText(secret);await expect(page.getByText('Converted by Alice',{exact:true})).toBeVisible();
    await expect(page.locator('.file-attachment')).toHaveAttribute('href',/^blob:/);
    const check=database();try{const row=check.prepare('SELECT body,e2ee_version FROM messages WHERE id=?').get(messageId);expect(row.body).toBe('');expect(row.e2ee_version).toBe(1);}finally{check.close();}
    expect(existsSync(join(process.env.GATHERLY_E2E_DATA_DIR,'uploads',diskName))).toBeFalsy();
    await expect(bp.getByText(secret,{exact:true})).toHaveCount(0);expect((await (await other.request.get(`/api/groups/${nest.id}/messages`)).json()).messages).toEqual([]);
  }finally{await other.close();}
});

test('managed sign-in is automatic; shields follow member custody and preserve earlier history',async({page,browser},info)=>{
  const user=await register(page.context(),'Alice'),{tree,nest,invite}=await makeTree(page.context());
  await page.goto('/');await expect(page.getByRole('button',{name:'Edit your profile',exact:true})).toBeVisible();
  await expect(page.locator('.recovery-card')).toHaveCount(0);
  const row=page.locator(`[data-circle-id="${nest.id}"]`),shield=()=>page.getByRole('img',{name:'End-to-end encrypted for new messages',exact:true});
  await expect(row.locator('.privacy-shield')).toHaveCount(0);await openNest(page);await send(page,'Standard history remains readable');
  const other=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'}),third=await browser.newContext({...info.project.use,baseURL:'http://127.0.0.1:3101'});
  try{
    await other.request.post('/api/auth/login',{data:{username:user.username,password}});const fresh=await other.newPage();await fresh.goto('/');await openNest(fresh);
    await expect(fresh.locator('.message-bubble')).toContainText('Standard history remains readable');await expect(fresh.locator('.recovery-card')).toHaveCount(0);
    await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'Security',exact:true}).click();await page.getByRole('button',{name:'Use self-managed keys',exact:true}).click();
    const code=await page.getByRole('textbox',{name:'Your recovery key',exact:true}).inputValue();
    await expect(page.getByRole('button',{name:'Enable self-managed encryption',exact:true})).toBeDisabled();
    await page.getByRole('checkbox',{name:'I saved my recovery key somewhere safe.',exact:true}).check();
    await page.getByRole('button',{name:'Enable self-managed encryption',exact:true}).click();
    await expect(page.locator('.recovery-card')).toHaveCount(0);await expect(row.locator('.privacy-shield')).toBeVisible();await openNest(page);await expect(page.locator('.chat-heading .privacy-shield')).toBeVisible();
    await expect(page.locator('.message-bubble')).toContainText('Standard history remains readable');
    await fresh.reload();await expect(fresh.getByRole('heading',{name:'Unlock this device',exact:true})).toBeVisible();
    await fresh.getByRole('textbox',{name:'Recovery key',exact:true}).fill(code);await fresh.getByRole('button',{name:'Restore with recovery key',exact:true}).click();await openNest(fresh);
    await expect(fresh.locator('.message-bubble')).toContainText('Standard history remains readable');
    await send(page,'Shielded message after opting in');await expect(fresh.locator('.message-bubble').filter({hasText:'Shielded message after opting in'})).toBeVisible();
    await expect(page.getByText('E2EE when sent',{exact:true})).toHaveCount(1);
    await register(third,'Bob');const bobPage=await third.newPage();await bobPage.goto('/');await expect(bobPage.getByRole('button',{name:'Edit your profile',exact:true})).toBeVisible();
    await third.request.post('/api/invitations/accept',{data:{token:invite}});await third.request.post(`/api/groups/${nest.id}/join`);
    await expect(page.locator('.chat-heading .privacy-shield')).toHaveCount(0);
    await page.request.patch(`/api/groups/${nest.id}/membership`,{data:{muted:true}});await expect(shield()).toHaveCount(0);
    await send(page,'Mixed-key conversation');await bobPage.reload();await openNest(bobPage);await expect(bobPage.locator('.message-bubble')).toHaveCount(1);
    await expect(bobPage.locator('.message-bubble')).toContainText('Mixed-key conversation');
    await bobPage.getByRole('button',{name:'Edit your profile',exact:true}).click();await bobPage.getByRole('button',{name:'Security',exact:true}).click();await bobPage.getByRole('button',{name:'Use self-managed keys',exact:true}).click();
    await bobPage.getByRole('checkbox',{name:'I saved my recovery key somewhere safe.',exact:true}).check();await bobPage.getByRole('button',{name:'Enable self-managed encryption',exact:true}).click();
    await expect(page.locator('.chat-heading .privacy-shield')).toBeVisible();await expect(bobPage.getByRole('button',{name:'Edit your profile',exact:true})).toBeVisible();await openNest(bobPage);
    await send(page,'Everyone self-manages now');await expect(bobPage.locator('.message-bubble').filter({hasText:'Everyone self-manages now'})).toBeVisible();
    const records=(await (await page.request.get(`/api/groups/${nest.id}/messages`)).json()).messages;
    expect(records.map(m=>m.self_encrypted)).toEqual([0,1,0,1]);
    await page.screenshot({path:info.outputPath('automatic-nest-shield.png'),fullPage:true});
  }finally{await other.close();await third.close();}
});
