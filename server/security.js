import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export async function passwordHash(value) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(value, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(value, stored) {
  if (!stored) return false;
  const [salt, key] = stored.split(':');
  const actual = await scrypt(value, salt, 64);
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}
