// Run after `docker build -t gatherly:railway-test .`.
// Uses a separate temporary Docker volume; never touches the application's data.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import * as enc from '../shared/encryption.js';
import { validatePoll,encodeVote,parseVote } from '../shared/polls.js';
import { validateRsvp,encodeResponse,parseResponse } from '../shared/rsvps.js';
import { assignmentProof,assignmentSetup,validateAssignments,parseAssignments,encodeAssignmentOperation,operationMetadata,parseAssignmentOperation } from '../shared/assignments.js';
import { mkdtempSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as httpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { chromium,expect } from '@playwright/test';

const image = process.env.GATHERLY_TEST_IMAGE || 'gatherly:railway-test';
const suffix = randomUUID().slice(0, 8);
let container = `gatherly-smoke-${suffix}`;
const containers=[container,`${container}-replacement`];
const volume = `gatherly-smoke-data-${suffix}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let base;
let cookie;
let deviceId;
async function request(path, method = 'GET', body) {
  const form = body instanceof FormData;
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(deviceId ? { 'x-churp-device':deviceId } : {}),
      ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
      Origin: 'https://gatherly-test.up.railway.app',
      'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.45',
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  const contentType=response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : contentType.includes('text/') ? await response.text() : new Uint8Array(await response.arrayBuffer());
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return { response, data };
}
async function start() {
  docker('run', '-d', '--name', container,
    '-e', 'RAILWAY_ENVIRONMENT_ID=smoke-test', '-e', 'SMS_MODE=mock',
    '-e', 'RAILWAY_VOLUME_MOUNT_PATH=/data',
    '-e', 'RAILWAY_PUBLIC_DOMAIN=gatherly-test.up.railway.app',
    '-p', '127.0.0.1::3000', '-v', `${volume}:/data`, image);
  base = `http://${docker('port', container, '3000/tcp').split('\n')[0]}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await request('/health')).data.status === 'ok') {
      const worker=await fetch(`${base}/push-preview.js`,{headers:{'X-Forwarded-Proto':'https'}});
      assert.equal(worker.status,200);assert.match(worker.headers.get('content-type')||'',/javascript/);assert.equal(worker.headers.get('cache-control'),'no-store');assert.match(await worker.text(),/churpPushPreview/);return;
    } } catch(error) { if(error.code==='ERR_ASSERTION')throw error; /* wait for listening */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Container did not become healthy: ${docker('logs', container)}`);
}
async function browserCheck(cid,gid,recovery,managedFixture,privateId){
  const temporary=mkdtempSync(join(tmpdir(),'churp-container-browser-'));let proxy,browser;
  try{
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temporary,'key.pem'),'-out',join(temporary,'cert.pem'),'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
    proxy=httpsServer({key:readFileSync(join(temporary,'key.pem')),cert:readFileSync(join(temporary,'cert.pem'))},(req,res)=>{
      const upstream=httpRequest(new URL(req.url,base),{method:req.method,headers:{...req.headers,origin:'https://gatherly-test.up.railway.app','x-forwarded-proto':'https','x-forwarded-for':'203.0.113.45'}},incoming=>{res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);});
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});res.on('close',()=>upstream.destroy());req.pipe(upstream);
    });
    await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const origin=`https://127.0.0.1:${proxy.address().port}`;
    browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),args:['--no-sandbox']});
    const context=await browser.newContext({ignoreHTTPSErrors:true});const separator=cookie.indexOf('=');
    await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.cspViolations=[];document.addEventListener('securitypolicyviolation',event=>window.cspViolations.push(event.violatedDirective));});
    await page.goto(`${origin}/?community=${cid}&group=${gid}`);
    try { await page.getByRole('textbox',{name:'Recovery key',exact:true}).fill(`CHURP1-${recovery}`); }
    catch(error){await page.screenshot({path:'/tmp/churp-container-recovery-failure.png',fullPage:true});console.error('Recovery screen diagnostic:',JSON.stringify({url:page.url(),errors,body:await page.locator('body').innerText()}));throw error;}
    await page.getByRole('button',{name:'Restore with recovery key',exact:true}).click();
    await expect(page.locator('.message-bubble').filter({hasText:'A durable message.'})).toBeVisible();
    const durable=page.locator('.message').filter({hasText:'A durable message.'});
    await expect(durable.locator('.message-edited')).toHaveText('edited');
    await durable.focus();await durable.press('Enter');
    await page.getByRole('dialog',{name:'Message options',exact:true}).getByRole('button',{name:'Edit message',exact:true}).click();
    await page.getByRole('textbox',{name:'Message text',exact:true}).fill('A corrected durable message.');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.message-bubble').filter({hasText:'A corrected durable message.'})).toBeVisible();
    await page.getByRole('button',{name:'Open poll: Container planning poll',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('Closed');
    await expect(page.getByRole('radio',{name:/^Saturday/})).toBeChecked();
    await expect.poll(()=>page.locator('.poll-choice-egg').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await expect(page.locator('.file-attachment')).toHaveAttribute('href',/^blob:/);
    const picture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=','base64');
    await page.locator('.composer input[type=file]').first().setInputFiles({name:'container-private.png',mimeType:'image/png',buffer:picture});
    await page.getByRole('textbox',{name:'Write a message',exact:true}).fill('Encrypted browser photo under production CSP');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(page.locator('.image-attachment img')).toHaveAttribute('src',/^blob:/);
    await expect.poll(()=>page.locator('.image-attachment img').evaluate(img=>img.naturalWidth)).toBe(1);
    await page.reload();await expect(page.locator('.message-bubble').filter({hasText:'Encrypted browser photo under production CSP'})).toBeVisible();
    await expect.poll(()=>page.locator('.image-attachment img').evaluate(img=>img.naturalWidth)).toBe(1);
    await page.getByRole('button',{name:'Open shared items',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:/^Pictures/}).click();
    await expect.poll(()=>page.locator('.shared-picture img').evaluate(img=>img.naturalWidth)).toBe(1);
    await page.getByRole('button',{name:'All shared items',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:/^Documents/}).click();
    await expect(page.locator('.shared-download strong')).toHaveText('notes.txt');
    const libraryDownload=page.waitForEvent('download');await page.locator('.shared-download button').click();
    assert.equal(readFileSync(await (await libraryDownload).path(),'utf8'),'Survives a Railway redeploy.');
    await page.getByRole('button',{name:'All shared items',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:/^Polls/}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Open poll: Container planning poll',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.getByRole('dialog')).toContainText('Closed');
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('heading',{name:'Polls',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.getByRole('button',{name:'Open RSVP: Container picnic invitation',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('heading',{name:'Container picnic invitation',exact:true})).toBeVisible();
    await expect(page.getByRole('radio',{name:'Going',exact:true})).toBeChecked();
    await expect(page.getByRole('spinbutton',{name:'Additional guests',exact:true})).toHaveValue('2');
    await expect.poll(()=>page.locator('.rsvp-hatch.is-hatched .rsvp-hatchling').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
    await page.getByRole('radio',{name:'Maybe',exact:true}).check();
    await page.getByRole('spinbutton',{name:'Additional guests',exact:true}).fill('1');
    await page.getByRole('button',{name:'Update response',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('Your response is saved: Maybe.');
    await page.getByRole('button',{name:'Responses',exact:true}).click();
    await expect(page.locator('.rsvp-totals section').nth(1).locator('strong')).toHaveText('2');
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.getByRole('button',{name:'Open shared items',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:/^RSVPs/}).click();
    await expect(page.getByRole('dialog').getByRole('button',{name:'Open RSVP: Container picnic invitation',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.getByRole('button',{name:'Open assignments: Container party preparations',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('1 of 1 assignments complete');
    await expect.poll(()=>page.locator('.assignment-card img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
    await page.getByRole('button',{name:'Reopen assignment: Bring the cake',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('0 of 1 assignments complete');
    await page.getByRole('button',{name:'List settings',exact:true}).click();
    await page.getByRole('checkbox',{name:/Allow Nest members/}).uncheck();
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('Only the creator and Nest admins can add assignments.');
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.getByRole('button',{name:'Open shared items',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:/^Assignments/}).click();
    await expect(page.getByRole('dialog').getByRole('button',{name:'Open assignments: Container party preparations',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.goto(`${origin}/?conversation=${privateId}`);
    await expect(page.locator('.private-bubble')).toContainText('A durable private hello.');
    await page.getByRole('textbox',{name:'Write a private message',exact:true}).fill('Private browser reply under production CSP');
    await page.getByRole('button',{name:'Send private message',exact:true}).click();
    await expect(page.locator('.private-bubble').filter({hasText:'Private browser reply under production CSP'})).toBeVisible();
    await page.goto(`${origin}/?community=${cid}&group=${gid}`);
    await page.getByRole('button',{name:'Invite someone to this Tree',exact:true}).click();
    await page.getByRole('button',{name:'Create invitation link',exact:true}).click();
    await expect.poll(()=>page.locator('.invitation-qr').evaluate(img=>img.naturalWidth)).toBe(300);
    await expect(page.getByRole('textbox',{name:'Invitation code',exact:true})).toHaveValue(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.getByRole('button',{name:'Edit your profile',exact:true}).click();
    await expect(page.locator('.settings-menu>button')).toHaveCount(8);
    await page.getByRole('button',{name:'Profile & avatar',exact:true}).click();
    await expect(page.getByRole('radio')).toHaveCount(20);
    await page.getByRole('radio',{name:'Parrot',exact:true}).check();
    await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.profile-button [data-avatar-choice]')).toHaveAttribute('data-avatar-choice','parrot');
    await expect(page.locator('.resident-bird')).toHaveAttribute('data-bird-id','blue');
    assert.equal(await page.evaluate(async()=>{const img=new Image();img.src='/brand/avatars/churp-portraits.png';await img.decode();return img.naturalWidth;}),1254);
    const smsContact=await page.request.post(`${origin}/api/contacts`,{data:{name:'Fictional SMS contact',phone:'+12025550123'}});assert.equal(smsContact.status(),201);
    await page.goto(origin);await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('button',{name:'Messages',exact:true}).click();await page.getByRole('button',{name:'Phone texts',exact:true}).click();await expect(page.getByText(/MOCK MODE — simulations only/)).toBeVisible();await page.getByRole('button',{name:'New phone conversation',exact:true}).click();await page.getByRole('dialog').getByRole('combobox',{name:'Tree',exact:true}).selectOption(cid);await page.getByRole('dialog').getByRole('combobox',{name:'Saved phone contact',exact:true}).selectOption({label:'Fictional SMS contact · +12025550123'});await page.getByRole('dialog').getByRole('button',{name:'Open text conversation',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button',{name:'Recipient simulations',exact:true}).click();await page.getByRole('checkbox',{name:'This is a fictional adult recipient for testing.',exact:true}).check();await page.getByRole('button',{name:'Simulate adult consent',exact:true}).click();await page.getByRole('textbox',{name:'Write an external text',exact:true}).fill('A simulated production SMS.');await page.getByRole('button',{name:'Review text',exact:true}).click();await page.getByRole('button',{name:'Review recipients & text',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Join this Tree:');await page.getByRole('button',{name:'Confirm simulated batch',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('mock sent');await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.locator('.sms-thread-messages')).toContainText('A simulated production SMS.');
    console.log('PASS: mock SMS consent, invitation preview and durable simulated sending work under production HTTPS/CSP without Twilio credentials.');
    await page.goto(`${origin}/?community=${cid}&group=${gid}`);await expect(page.getByRole('textbox',{name:'Write a message',exact:true})).toBeVisible();
    // Production CSP/HTTPS coverage for family setup and read-only supervision.
    await page.getByRole('button',{name:'Edit your profile',exact:true}).click();
    await page.getByRole('button',{name:'Family & youth protection',exact:true}).click();
    await page.getByRole('button',{name:'Create parent invitation code',exact:true}).click();
    await expect(page.locator('.family-code')).toHaveText(/\S{12}/);
    const familyCode=await page.locator('.family-code').innerText();
    const youthContext=await browser.newContext({ignoreHTTPSErrors:true});
    try{
      const response=await youthContext.request.post(`${origin}/api/auth/register`,{data:{birth_date:'2011-01-01',username:`youth_${suffix}`,name:'Protected youth',password:'Temporary youth fixture!'}});
      assert.equal(response.status(),201);const youth=(await response.json()).user,yp=await youthContext.newPage();yp.on('pageerror',error=>errors.push(error.message));
      await yp.goto(origin);await yp.getByLabel('Parent invitation code',{exact:true}).fill(familyCode);await yp.getByRole('button',{name:'Link parent',exact:true}).click();
      await page.getByRole('checkbox',{name:/I am this person’s parent/}).check();await page.getByRole('button',{name:'Confirm parent link',exact:true}).click();
      await expect(yp.getByRole('navigation',{name:'Main navigation',exact:true})).toBeVisible();
      const conversation=await page.request.post(`${origin}/api/private/conversations`,{data:{user_id:youth.id}});assert.equal(conversation.status(),200);const youthConversation=(await conversation.json()).conversation.id;
      await page.goto(`${origin}/?conversation=${youthConversation}`);await expect(page.getByText(/parents linked to either youth account/)).toBeVisible();
      await page.getByRole('textbox',{name:'Write a private message',exact:true}).fill('Protected conversation under production CSP');await page.getByRole('button',{name:'Send private message',exact:true}).click();
      await expect(page.locator('.private-bubble')).toContainText('Protected conversation under production CSP');
      await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'Family & youth protection',exact:true}).click();await page.getByRole('button',{name:'View Protected youth’s direct messages',exact:true}).click();await page.getByRole('button',{name:'Protected youth and Railway smoke test',exact:true}).click();
      await expect(page.locator('.family-message-review .private-bubble')).toContainText('Protected conversation under production CSP');await expect(page.getByRole('dialog').getByRole('textbox',{name:'Write a private message',exact:true})).toHaveCount(0);
      await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    }finally{await youthContext.close();}
    await page.goto(`${origin}/?community=${cid}&group=${gid}`);await expect(page.getByRole('textbox',{name:'Write a message',exact:true})).toBeVisible();
    console.log('PASS: protected youth setup, parent-linked encryption and read-only supervision work under production HTTPS/CSP.');
    const originalIdentity=(await (await page.request.get(`${origin}/api/e2ee/account`)).json()).identity.fingerprint;
    await page.getByRole('button',{name:'Edit your profile',exact:true}).click();await page.getByRole('button',{name:'Security',exact:true}).click();
    await page.getByRole('button',{name:'Use Churp-managed keys',exact:true}).click();
    await page.getByRole('button',{name:'Confirm Churp-managed keys',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.message-bubble').filter({hasText:'A corrected durable message.'})).toBeVisible();
    const custodyBrowser=await browser.newContext({ignoreHTTPSErrors:true});await custodyBrowser.addCookies(await context.cookies());
    const cp=await custodyBrowser.newPage();cp.on('pageerror',error=>errors.push(error.message));await cp.goto(`${origin}/?community=${cid}&group=${gid}`);
    await expect(cp.locator('.message-bubble').filter({hasText:'A corrected durable message.'})).toBeVisible();await expect(cp.locator('.encryption-gate')).toHaveCount(0);
    await cp.getByRole('button',{name:'Edit your profile',exact:true}).click();await cp.getByRole('button',{name:'Security',exact:true}).click();await cp.getByRole('button',{name:'Use self-managed keys',exact:true}).click();
    await cp.getByRole('checkbox',{name:'I saved my recovery key somewhere safe.',exact:true}).check();
    await cp.getByRole('button',{name:'Enable self-managed encryption',exact:true}).click();await expect(cp.getByRole('dialog')).toHaveCount(0);
    await expect(cp.locator('.message-bubble').filter({hasText:'A corrected durable message.'})).toBeVisible();
    const rotated=(await (await cp.request.get(`${origin}/api/e2ee/account`)).json()).identity;
    assert.equal(rotated.custody,'self');assert.notEqual(rotated.fingerprint,originalIdentity);await custodyBrowser.close();
    assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.cspViolations),[]);
    await context.close();console.log('PASS: production browser recovery, local key persistence, encrypted photo rendering and strict CSP over HTTPS.');
    const visitor=await browser.newContext({ignoreHTTPSErrors:true});
    const website=await visitor.newPage();website.on('pageerror',error=>errors.push(error.message));
    await website.addInitScript(()=>{window.cspViolations=[];document.addEventListener('securitypolicyviolation',event=>window.cspViolations.push(event.violatedDirective));});
    await website.goto(`${origin}/website/`);await expect(website.locator('#hero-heading')).toBeVisible();
    await website.getByRole('button',{name:'Our family',exact:false}).click();await expect(website.locator('#demo-tree')).toHaveText('The Fausett Family');
    assert.deepEqual(await website.evaluate(()=>window.cspViolations),[]);await visitor.close();
    console.log('PASS: public website loads independently of sign-in with working interactions under production CSP.');
    const managed=await browser.newContext({ignoreHTTPSErrors:true}),split=managedFixture.cookie.indexOf('=');
    await managed.addCookies([{name:managedFixture.cookie.slice(0,split),value:managedFixture.cookie.slice(split+1),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
    const mp=await managed.newPage();mp.on('pageerror',error=>errors.push(error.message));await mp.goto(origin);
    await expect(mp.getByRole('button',{name:'Edit your profile',exact:true})).toBeVisible();await expect(mp.locator('.recovery-card')).toHaveCount(0);
    const tree=await (await managed.request.post(`${origin}/api/communities`,{data:{name:'Managed restore Tree'}})).json();
    const nest=await (await managed.request.post(`${origin}/api/communities/${tree.community.id}/circles`,{data:{name:'Managed restore Nest'}})).json();
    const target=`${origin}/?community=${tree.community.id}&group=${nest.group.id}`;await mp.goto(target);
    await mp.getByRole('textbox',{name:'Write a message',exact:true}).fill('Restored through ordinary sign-in');await mp.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(mp.locator('.message-bubble')).toContainText('Restored through ordinary sign-in');await expect(mp.locator('.privacy-shield')).toHaveCount(0);
    await managed.close();
    const replacement=await browser.newContext({ignoreHTTPSErrors:true});
    const login=await replacement.request.post(`${origin}/api/auth/login`,{data:{username:'managed_smoke',password:'Temporary managed password!'}});assert.equal(login.status(),200);
    const rp=await replacement.newPage();rp.on('pageerror',error=>errors.push(error.message));await rp.goto(target);
    await expect(rp.locator('.message-bubble')).toContainText('Restored through ordinary sign-in');await expect(rp.locator('.recovery-card')).toHaveCount(0);
    assert.deepEqual(errors,[]);await replacement.close();
    console.log('PASS: managed accounts restore through ordinary sign-in on fresh browsers after container replacement.');
  }finally{if(browser)await browser.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}rmSync(temporary,{recursive:true,force:true});}
}
try {
  const missingVolume = spawnSync('docker', ['run', '--rm', '-e', 'RAILWAY_ENVIRONMENT_ID=smoke-test', '-e', 'SMS_MODE=mock', image], { encoding: 'utf8' });
  assert.notEqual(missingVolume.status, 0);
  assert.match(missingVolume.stderr + missingVolume.stdout, /Attach a Railway Volume/);
  docker('volume', 'create', volume);
  await start();
  const root = await fetch(base);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /id="root"/);
  assert.ok(root.headers.get('content-security-policy'));
  docker('exec', container, 'test', '!', '-f', '/app/.env');
  const registered = await request('/auth/register', 'POST', {birth_date:'1990-01-01', username: 'railway_smoke', name: 'Railway smoke test', password: 'Temporary container password!' });
  cookie = registered.response.headers.get('set-cookie').split(';')[0];
  assert.match(registered.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(registered.response.headers.get('set-cookie'), /Secure/);
  assert.equal((await request('/config')).data.encryptionRequired,true);
  const keys=await enc.generateIdentity(registered.data.user.id),recovery=enc.randomSecret();deviceId=randomUUID();
  const backup=await enc.protectPrivate(keys.privateKey,recovery),enrollment=enc.enrollmentPayload({userId:registered.data.user.id,publicKey:keys.publicKey,backupHash:await enc.digest(backup),deviceId,deviceName:'Container fixture'});
  await request('/e2ee/identity','POST',{...enrollment,backup,signature:await enc.sign(keys.privateKey,'enroll',enrollment)});
  const cid = (await request('/communities', 'POST', { name: 'Container test' })).data.community.id;
  const sid = (await request(`/communities/${cid}/subcommunities`, 'POST', { name: 'Test space' })).data.subcommunity.id;
  const gid = (await request(`/subcommunities/${sid}/groups`, 'POST', { name: 'Test conversation' })).data.group.id;
  const file = new FormData();
  const filePlain=enc.bytes('Survives a Railway redeploy.'),encryptedFile=await enc.encryptFile(filePlain);
  file.append('file', new Blob([encryptedFile.encrypted]), 'attachment.pgp');
  const fileId = (await request('/e2ee/uploads', 'POST', file)).data.file.id;
  const roster=(await request(`/groups/${gid}/e2ee/roster`)).data,clientId=randomUUID();
  const attachment={id:fileId,name:'notes.txt',size:filePlain.length,mime:'application/octet-stream',key:encryptedFile.key,sha256:encryptedFile.sha256};
  const ciphertext=await enc.seal(keys.privateKey,roster.readers.map(r=>r.public_key),{version:1,kind:'nest-message',groupId:gid,clientId,senderId:registered.data.user.id,signerId:registered.data.user.id,rosterHash:roster.roster_hash,replyTo:null,migrated:false,body:'A durbale message.',attachments:[attachment]});
  const send=enc.sendPayload({groupId:gid,clientId,rosterHash:roster.roster_hash,cipherHash:await enc.digest(ciphertext),files:[fileId],replyTo:null});
  const mid = (await request(`/groups/${gid}/messages`, 'POST', {ciphertext,clientId,rosterHash:roster.roster_hash,files:[fileId],signature:await enc.sign(keys.privateKey,'send',send)})).data.id;
  const editRoster=(await request(`/messages/${mid}/e2ee/edit-roster`)).data,editId=randomUUID();
  const editCipher=await enc.seal(keys.privateKey,editRoster.readers.map(r=>r.public_key),{version:1,kind:'nest-message',groupId:gid,clientId,senderId:registered.data.user.id,signerId:registered.data.user.id,rosterHash:editRoster.roster_hash,replyTo:null,migrated:false,selfEncrypted:editRoster.self_encrypted,contentType:'chat',body:'A durable message.',attachments:[attachment],editVersion:1,editMessageId:mid,editClientId:editId});
  const edit=enc.editPayload({messageId:mid,expectedVersion:0,groupId:gid,clientId:editId,rosterHash:editRoster.roster_hash,cipherHash:await enc.digest(editCipher),files:[fileId],replyTo:null});
  await request(`/messages/${mid}/content`,'PUT',{ciphertext:editCipher,clientId:editId,rosterHash:editRoster.roster_hash,reply_to:null,files:[fileId],expectedVersion:0,signature:await enc.sign(keys.privateKey,'edit',edit)});
  const poll=validatePoll({title:'Container planning poll',questions:[{text:'Which day?',type:'single',options:['Saturday','Sunday']}]});
  async function typedWrite(kind,body,replyTo=null){
    const rs=(await request(`/groups/${gid}/e2ee/roster`)).data,clientId=randomUUID();
    const ciphertext=await enc.seal(keys.privateKey,rs.readers.map(r=>r.public_key),{version:1,kind:'nest-message',groupId:gid,clientId,senderId:registered.data.user.id,signerId:registered.data.user.id,rosterHash:rs.roster_hash,replyTo,migrated:false,selfEncrypted:rs.self_encrypted,contentType:kind,body,attachments:[]});
    const payload=enc.sendPayload({groupId:gid,clientId,rosterHash:rs.roster_hash,cipherHash:await enc.digest(ciphertext),files:[],replyTo});
    const message={ciphertext,clientId,rosterHash:rs.roster_hash,reply_to:replyTo,files:[],...(['poll','rsvp','assignments'].includes(kind)?{message_kind:kind}:kind==='rsvp_response'?{eventVersion:0}:{}),signature:await enc.sign(keys.privateKey,'send',payload)};
    if(kind==='assignments' || kind==='assignment_op'){
      const metadata=kind==='assignments'?assignmentSetup(parseAssignments(body)):operationMetadata(JSON.parse(body));
      message.assignmentSignature=await enc.sign(keys.privateKey,kind==='assignments'?'assignment-setup':'assignment-operation',assignmentProof({listId:replyTo,clientId,cipherHash:await enc.digest(ciphertext),metadata}));
      if(kind==='assignments')message.assignment_setup=metadata;else message.operation=metadata;
    }
    const path=['poll','rsvp','assignments'].includes(kind)?`/groups/${gid}/messages`:kind==='assignment_op'?`/messages/${replyTo}/assignments/operations`:kind==='rsvp_response'?`/messages/${replyTo}/rsvp/respond`:`/messages/${replyTo}/poll/vote`;
    return (await request(path,'POST',message)).data.id;
  }
  const pollId=await typedWrite('poll',JSON.stringify(poll));
  await typedWrite('poll_vote',encodeVote(pollId,poll,[[0]]),pollId);
  await request(`/messages/${pollId}/poll`,'PATCH',{closed:true});
  const event=validateRsvp({title:'Container picnic invitation',allDay:true,start:'2027-05-20',timeZone:'UTC',location:'Our park'});
  const eventId=await typedWrite('rsvp',JSON.stringify(event));
  await typedWrite('rsvp_response',encodeResponse(eventId,{choice:'going',guests:2}),eventId);
  const assignments=validateAssignments({title:'Container party preparations',description:'A shared plan.',dueDate:'2027-06-02',allowMemberAdds:true,items:[{id:randomUUID(),title:'Bring the cake',notes:'Chocolate, please.',dueDate:null,assigneeId:registered.data.user.id}]});
  const assignmentId=await typedWrite('assignments',JSON.stringify(assignments));
  await typedWrite('assignment_op',encodeAssignmentOperation(assignmentId,{action:'complete',itemId:assignments.items[0].id,completed:true,expectedVersion:0}),assignmentId);
  const keyBefore = (await request('/config')).data.vapidPublicKey;
  assert.ok(keyBefore);
  assert.deepEqual(await enc.decryptFile((await request(`/files/${fileId}`)).data,attachment),filePlain);
  const shareInvitation=(await request('/invitations','POST',{community_id:cid})).data;
  assert.match(shareInvitation.code,/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);assert.match(shareInvitation.qr_data_url,/^data:image\/png;base64,/);
  const selfCookie=cookie,selfDevice=deviceId;
  const registeredManaged=await request('/auth/register','POST',{birth_date:'1990-01-01',username:'managed_smoke',name:'Managed smoke',password:'Temporary managed password!'});
  const managedCookie=registeredManaged.response.headers.get('set-cookie').split(';')[0];cookie=managedCookie;deviceId=randomUUID();
  const managedAccount=(await request('/e2ee/managed-device','POST',{deviceId,deviceName:'Managed container fixture'})).data;
  const managedFingerprint=managedAccount.identity.fingerprint;assert.equal((await enc.readPrivate(managedAccount.privateKey)).getFingerprint(),managedFingerprint);
  await request('/invitations/accept','POST',{token:shareInvitation.code});
  cookie=selfCookie;deviceId=selfDevice;
  await request(`/groups/${gid}/invitations`,'POST',{user_ids:[registeredManaged.data.user.id]});
  const privateId=(await request('/private/conversations','POST',{user_id:registeredManaged.data.user.id})).data.conversation.id;
  const privateRoster=(await request(`/private/conversations/${privateId}/roster`)).data,privateNonce=randomUUID();
  const privateCipher=await enc.seal(keys.privateKey,privateRoster.readers.map(r=>r.public_key),{version:1,kind:'private-message',conversationId:privateId,clientId:privateNonce,senderId:registered.data.user.id,rosterHash:privateRoster.roster_hash,selfEncrypted:privateRoster.self_encrypted,body:'A durable private hello.',attachments:[]});
  const privateProof={conversationId:privateId,clientId:privateNonce,rosterHash:privateRoster.roster_hash,cipherHash:await enc.digest(privateCipher),files:[],sourceNest:null};
  await request(`/private/conversations/${privateId}/messages`,'POST',{clientId:privateNonce,ciphertext:privateCipher,rosterHash:privateRoster.roster_hash,files:[],signature:await enc.sign(keys.privateKey,'private-send',privateProof)});
  docker('stop', container);
  docker('rm', container);
  container=containers[1];
  await start();
  assert.equal((await request('/me')).data.user.username, 'railway_smoke');
  assert.equal((await request('/me')).data.user.last_community_id, cid);
  const saved=(await request(`/groups/${gid}/messages`)).data.messages.find(m=>m.id===mid);assert.equal(saved.body,'');
  const restored=await enc.recoverPrivate((await request('/e2ee/account')).data.identity.backup,recovery);
  assert.equal((await enc.open(restored,keys.publicKey,saved.ciphertext)).body,'A durable message.');
  assert.equal(saved.edit_version,1);assert.ok(saved.edited_at);
  assert.deepEqual(await enc.decryptFile((await request(`/files/${fileId}`)).data,attachment),filePlain);
  assert.equal((await request('/config')).data.vapidPublicKey, keyBefore);
  const savedPoll=(await request(`/messages/${pollId}/poll`)).data;
  assert.equal(savedPoll.closed,true);assert.equal(savedPoll.votes.length,1);
  assert.deepEqual(parseVote((await enc.open(restored,keys.publicKey,savedPoll.votes[0].ciphertext)).body,pollId,poll),[[0]]);
  const savedEvent=(await request(`/messages/${eventId}/rsvp`)).data;
  assert.equal(savedEvent.responses.length,1);assert.equal(savedEvent.closed,false);
  assert.deepEqual(parseResponse((await enc.open(restored,keys.publicKey,savedEvent.responses[0].ciphertext)).body,eventId),{choice:'going',guests:2});
  const savedAssignments=(await request(`/messages/${assignmentId}/assignments`)).data;
  assert.equal(savedAssignments.revision,1);assert.equal(savedAssignments.items[0].completed,1);assert.equal(savedAssignments.allow_member_adds,true);
  assert.equal(parseAssignments((await enc.open(restored,keys.publicKey,savedAssignments.message.ciphertext)).body).title,'Container party preparations');
  const savedOperations=(await request(`/messages/${assignmentId}/assignments/operations?version=1`)).data.operations;
  assert.equal(parseAssignmentOperation((await enc.open(restored,keys.publicKey,savedOperations[0].message.ciphertext)).body,assignmentId,savedOperations[0].metadata).completed,true);
  cookie=managedCookie;deviceId=randomUUID();
  const savedInvitation=(await request('/invitations')).data.invitations[0];assert.equal(savedInvitation.group_id,gid);
  await request(`/invitations/${savedInvitation.id}/decline`,'POST');assert.equal((await request('/invitations')).data.invitations.length,0);
  const restoredManaged=(await request('/e2ee/managed-device','POST',{deviceId,deviceName:'After replacement'})).data;
  assert.equal(restoredManaged.identity.fingerprint,managedFingerprint);assert.equal((await enc.readPrivate(restoredManaged.privateKey)).getFingerprint(),managedFingerprint);
  cookie=selfCookie;deviceId=selfDevice;
  await browserCheck(cid,gid,recovery,{cookie:managedCookie},privateId);
  console.log('PASS: encrypted private conversations survive replacement and work in the production browser.');
  console.log('PASS: production container, HTTPS proxy headers, secure sessions, encrypted Nest messages/files, recovery backup and volume persistence across replacement.');
  console.log('PASS: push keys persist; local .env is excluded; Railway startup requires a Volume.');
  console.log('PASS: encrypted poll definitions, answers and closure survive replacement; ballot and basket artwork render under production CSP.');
  console.log('PASS: shared library decrypts pictures and documents and opens saved polls under production CSP.');
  console.log('PASS: encrypted RSVP invitations and guest counts survive replacement; envelopes and hatching artwork render under production CSP.');
  console.log('PASS: encrypted assignments, completion and collaboration controls survive replacement and work under production CSP.');
  console.log('PASS: self-managed keys can return to Churp and rotate again, preserving history on a fresh production browser.');
  console.log('PASS: short codes and addressed Nest invitations survive replacement; QR images render under production CSP.');
  console.log('PASS: encrypted edits survive replacement and can be saved in the production browser without losing attachments.');
} finally {
  for(const name of containers)spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', volume], { stdio: 'ignore' });
}
