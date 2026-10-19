import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareDeployment } from '../server/deployment.js';

test('Railway refuses ephemeral or incorrectly mounted data storage', () => {
  assert.throws(() => prepareDeployment({ RAILWAY_ENVIRONMENT_ID: 'test' }), /Attach a Railway Volume/);
  assert.throws(() => prepareDeployment({ RAILWAY_ENVIRONMENT_ID: 'test', RAILWAY_VOLUME_MOUNT_PATH: '/data', DATA_DIR: '/somewhere-else' }), /must match/);
});

test('Railway configures its public origin and preserves private push keys across redeploys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gatherly-deployment-'));
  try {
    const env = { RAILWAY_ENVIRONMENT_ID: 'test', RAILWAY_VOLUME_MOUNT_PATH: dir, RAILWAY_PUBLIC_DOMAIN: 'gatherly-test.up.railway.app' };
    prepareDeployment(env);
    assert.equal(env.DATA_DIR, dir);
    assert.equal(env.APP_URL, 'https://gatherly-test.up.railway.app');
    assert.ok(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
    const original = readFileSync(join(dir, 'push-keys.json'), 'utf8');
    assert.equal(statSync(join(dir, 'push-keys.json')).mode & 0o777, 0o600);
    const next = { RAILWAY_ENVIRONMENT_ID: 'test', RAILWAY_VOLUME_MOUNT_PATH: dir, RAILWAY_PUBLIC_DOMAIN: 'gatherly-test.up.railway.app' };
    prepareDeployment(next);
    assert.equal(readFileSync(join(dir, 'push-keys.json'), 'utf8'), original);
    assert.equal(next.VAPID_PRIVATE_KEY, env.VAPID_PRIVATE_KEY);
    writeFileSync(join(dir, 'push-keys.json'), 'invalid');
    assert.throws(() => prepareDeployment({ ...next, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' }), /Restore push-keys.json/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('explicit deployment settings and existing keys take precedence', () => {
  const env = { APP_URL: 'https://chat.example.com', VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'mailto:admin@example.com', RAILWAY_PUBLIC_DOMAIN: 'another.up.railway.app' };
  prepareDeployment(env);
  assert.equal(env.APP_URL, 'https://chat.example.com');
  assert.equal(env.VAPID_PRIVATE_KEY, 'private');
  assert.throws(() => prepareDeployment({ VAPID_PUBLIC_KEY: 'incomplete' }), /Both VAPID/);
  assert.doesNotThrow(() => prepareDeployment({}));
});
