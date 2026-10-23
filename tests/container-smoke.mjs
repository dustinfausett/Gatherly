// Run after `docker build -t gatherly:railway-test .`.
// Uses a separate temporary Docker volume; never touches the application's data.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import * as enc from '../shared/encryption.js';
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
    '-e', 'RAILWAY_ENVIRONMENT_ID=smoke-test',
    '-e', 'RAILWAY_VOLUME_MOUNT_PATH=/data',
    '-e', 'RAILWAY_PUBLIC_DOMAIN=gatherly-test.up.railway.app',
    '-p', '127.0.0.1::3000', '-v', `${volume}:/data`, image);
  base = `http://${docker('port', container, '3000/tcp').split('\n')[0]}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await request('/health')).data.status === 'ok') return; } catch { /* wait for listening */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Container did not become healthy: ${docker('logs', container)}`);
}
async function browserCheck(cid,gid,recovery){
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
    await page.getByRole('textbox',{name:'Recovery key',exact:true}).fill(`CHURP1-${recovery}`);
    await page.getByRole('button',{name:'Restore with recovery key',exact:true}).click();
    await expect(page.locator('.message-bubble')).toContainText('A durable message.');
    await expect(page.locator('.file-attachment')).toHaveAttribute('href',/^blob:/);
    const picture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=','base64');
    await page.locator('.composer input[type=file]').first().setInputFiles({name:'container-private.png',mimeType:'image/png',buffer:picture});
    await page.getByRole('textbox',{name:'Write a message',exact:true}).fill('Encrypted browser photo under production CSP');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(page.locator('.image-attachment img')).toHaveAttribute('src',/^blob:/);
    await expect.poll(()=>page.locator('.image-attachment img').evaluate(img=>img.naturalWidth)).toBe(1);
    await page.reload();await expect(page.locator('.message-bubble').filter({hasText:'Encrypted browser photo under production CSP'})).toBeVisible();
    await expect.poll(()=>page.locator('.image-attachment img').evaluate(img=>img.naturalWidth)).toBe(1);
    assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.cspViolations),[]);
    await context.close();console.log('PASS: production browser recovery, local key persistence, encrypted photo rendering and strict CSP over HTTPS.');
  }finally{if(browser)await browser.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}rmSync(temporary,{recursive:true,force:true});}
}
try {
  const missingVolume = spawnSync('docker', ['run', '--rm', '-e', 'RAILWAY_ENVIRONMENT_ID=smoke-test', image], { encoding: 'utf8' });
  assert.notEqual(missingVolume.status, 0);
  assert.match(missingVolume.stderr + missingVolume.stdout, /Attach a Railway Volume/);
  docker('volume', 'create', volume);
  await start();
  const root = await fetch(base);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /id="root"/);
  assert.ok(root.headers.get('content-security-policy'));
  docker('exec', container, 'test', '!', '-f', '/app/.env');
  const registered = await request('/auth/register', 'POST', { username: 'railway_smoke', name: 'Railway smoke test', password: 'Temporary container password!' });
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
  const ciphertext=await enc.seal(keys.privateKey,roster.readers.map(r=>r.public_key),{version:1,kind:'nest-message',groupId:gid,clientId,senderId:registered.data.user.id,signerId:registered.data.user.id,rosterHash:roster.roster_hash,replyTo:null,migrated:false,body:'A durable message.',attachments:[attachment]});
  const send=enc.sendPayload({groupId:gid,clientId,rosterHash:roster.roster_hash,cipherHash:await enc.digest(ciphertext),files:[fileId],replyTo:null});
  const mid = (await request(`/groups/${gid}/messages`, 'POST', {ciphertext,clientId,rosterHash:roster.roster_hash,files:[fileId],signature:await enc.sign(keys.privateKey,'send',send)})).data.id;
  const keyBefore = (await request('/config')).data.vapidPublicKey;
  assert.ok(keyBefore);
  assert.deepEqual(await enc.decryptFile((await request(`/files/${fileId}`)).data,attachment),filePlain);
  docker('stop', container);
  docker('rm', container);
  container=containers[1];
  await start();
  assert.equal((await request('/me')).data.user.username, 'railway_smoke');
  assert.equal((await request('/me')).data.user.last_community_id, cid);
  const saved=(await request(`/groups/${gid}/messages`)).data.messages.find(m=>m.id===mid);assert.equal(saved.body,'');
  const restored=await enc.recoverPrivate((await request('/e2ee/account')).data.identity.backup,recovery);
  assert.equal((await enc.open(restored,keys.publicKey,saved.ciphertext)).body,'A durable message.');
  assert.deepEqual(await enc.decryptFile((await request(`/files/${fileId}`)).data,attachment),filePlain);
  assert.equal((await request('/config')).data.vapidPublicKey, keyBefore);
  await browserCheck(cid,gid,recovery);
  console.log('PASS: production container, HTTPS proxy headers, secure sessions, encrypted Nest messages/files, recovery backup and volume persistence across replacement.');
  console.log('PASS: push keys persist; local .env is excluded; Railway startup requires a Volume.');
} finally {
  for(const name of containers)spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', volume], { stdio: 'ignore' });
}
