// Run after `docker build -t gatherly:railway-test .`.
// Uses a separate temporary Docker volume; never touches the application's data.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const image = process.env.GATHERLY_TEST_IMAGE || 'gatherly:railway-test';
const suffix = randomUUID().slice(0, 8);
const container = `gatherly-smoke-${suffix}`;
const volume = `gatherly-smoke-data-${suffix}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let base;
let cookie;
async function request(path, method = 'GET', body) {
  const form = body instanceof FormData;
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
      Origin: 'https://gatherly-test.up.railway.app',
      'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.45',
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
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
  const cid = (await request('/communities', 'POST', { name: 'Container test' })).data.community.id;
  const sid = (await request(`/communities/${cid}/subcommunities`, 'POST', { name: 'Test space' })).data.subcommunity.id;
  const gid = (await request(`/subcommunities/${sid}/groups`, 'POST', { name: 'Test conversation' })).data.group.id;
  const file = new FormData();
  file.append('file', new Blob(['Survives a Railway redeploy.']), 'notes.txt');
  const fileId = (await request('/uploads', 'POST', file)).data.file.id;
  const mid = (await request(`/groups/${gid}/messages`, 'POST', { body: 'A durable message.', files: [fileId] })).data.id;
  const keyBefore = (await request('/config')).data.vapidPublicKey;
  assert.ok(keyBefore);
  assert.equal((await request(`/files/${fileId}`)).data, 'Survives a Railway redeploy.');
  docker('stop', container);
  docker('rm', container);
  await start();
  assert.equal((await request('/me')).data.user.username, 'railway_smoke');
  assert.equal((await request('/me')).data.user.last_community_id, cid);
  assert.ok((await request(`/groups/${gid}/messages`)).data.messages.some(m => m.id === mid && m.body === 'A durable message.'));
  assert.equal((await request(`/files/${fileId}`)).data, 'Survives a Railway redeploy.');
  assert.equal((await request('/config')).data.vapidPublicKey, keyBefore);
  console.log('PASS: production container, HTTPS proxy headers, secure sessions, Group messaging, file uploads, and volume persistence across replacement.');
  console.log('PASS: push keys persist; local .env is excluded; Railway startup requires a Volume.');
} finally {
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', volume], { stdio: 'ignore' });
}
