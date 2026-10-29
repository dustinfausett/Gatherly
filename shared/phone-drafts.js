export function phoneTextUrl(phone, text, ios = false) {
  if (typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Choose a valid saved phone number.');
  if (typeof text !== 'string' || !text.trim()) throw new Error('Write a message first.');
  return `sms:${phone}${ios ? '&' : '?'}body=${encodeURIComponent(text)}`;
}
export function phoneDraftText(body, sender, tree, invitation) {
  const clean = value => String(value).replace(/[\r\n]/g, ' ').trim().slice(0, 100);
  return `${body.trim()}\n\n— ${clean(sender)}${tree ? ` · ${clean(tree)}` : ''}\n${tree ? 'Join us on Churp' : 'Find us on Churp'}: ${invitation}`;
}
export const phoneDraftState = state => ({ ready: 'Ready for your phone', opened: 'Opening requested · send not confirmed', done: 'Marked sent by you', skipped: 'Skipped' })[state] || 'Needs review';
