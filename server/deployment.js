import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import webPush from 'web-push';

// A Railway service must have its persistent volume before accepting user data.
export function prepareDeployment(env = process.env) {
  if (env.RAILWAY_ENVIRONMENT_ID && !env.RAILWAY_VOLUME_MOUNT_PATH) {
    throw new Error('Attach a Railway Volume mounted at /data before starting Gatherly. Accounts, messages, and uploads must survive redeploys.');
  }
  if (!env.DATA_DIR && env.RAILWAY_VOLUME_MOUNT_PATH) env.DATA_DIR = env.RAILWAY_VOLUME_MOUNT_PATH;
  if (env.RAILWAY_VOLUME_MOUNT_PATH && resolve(env.DATA_DIR || '.data') !== resolve(env.RAILWAY_VOLUME_MOUNT_PATH)) {
    throw new Error('DATA_DIR must match the Railway Volume mount path. Use /data for both.');
  }
  if (!env.APP_URL && env.RAILWAY_PUBLIC_DOMAIN) env.APP_URL = `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  if (!!env.VAPID_PUBLIC_KEY !== !!env.VAPID_PRIVATE_KEY) {
    throw new Error('Both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required when supplying your own push keys.');
  }
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return;
  const subject = env.VAPID_SUBJECT || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : null);
  if (!subject) return;
  if (!subject.startsWith('https://') && !subject.startsWith('mailto:')) throw new Error('VAPID_SUBJECT must be a public HTTPS contact URL or mailto: address.');
  const dataDir = resolve(env.DATA_DIR || '.data');
  mkdirSync(dataDir, { recursive: true });
  const keyFile = join(dataDir, 'push-keys.json');
  let keys;
  if (existsSync(keyFile)) {
    try { keys = JSON.parse(readFileSync(keyFile, 'utf8')); } catch { throw new Error('Cannot read the saved push keys. Restore push-keys.json from backup instead of replacing it.'); }
    if (typeof keys.publicKey !== 'string' || typeof keys.privateKey !== 'string' || !keys.publicKey || !keys.privateKey) throw new Error('Saved push keys are incomplete. Restore push-keys.json from backup.');
  } else {
    keys = webPush.generateVAPIDKeys();
    writeFileSync(keyFile, JSON.stringify(keys), { mode: 0o600, flag: 'wx' });
  }
  env.VAPID_PUBLIC_KEY = keys.publicKey;
  env.VAPID_PRIVATE_KEY = keys.privateKey;
  env.VAPID_SUBJECT = subject;
}
