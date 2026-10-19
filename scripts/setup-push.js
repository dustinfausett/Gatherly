import webPush from 'web-push';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const path = '.env';
if (existsSync(path)) process.loadEnvFile(path);
const subjectArg = process.argv.find(arg => arg.startsWith('--subject='))?.slice(10);
const subject = subjectArg || process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
if (!/^(mailto:|https:\/\/)/.test(subject)) throw new Error('Use --subject=mailto:you@example.com or a public HTTPS contact URL.');
if (!!process.env.VAPID_PUBLIC_KEY !== !!process.env.VAPID_PRIVATE_KEY) throw new Error('A partial VAPID configuration exists. Complete or remove it before generating new keys.');
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  console.log('Existing push keys preserved.');
} else {
  const keys = webPush.generateVAPIDKeys();
  let contents = existsSync(path) ? readFileSync(path, 'utf8') : '# Local configuration. Keep this file private.\n';
  for (const [name, value] of Object.entries({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: subject })) {
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    contents = pattern.test(contents) ? contents.replace(pattern, `${name}=${value}`) : `${contents.trimEnd()}\n${name}=${value}\n`;
  }
  writeFileSync(path, contents, { mode: 0o600 });
  console.log('Push keys saved privately in .env. Restart the server to activate them.');
  if (!subjectArg) console.log('For deployment, set VAPID_SUBJECT to your public contact email or HTTPS URL.');
}
