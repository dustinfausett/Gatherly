export const FIRST_NAME_TOKEN = '[first name]';
const tokenPattern = () => /\[\s*first(?:[\s_]+)?name\s*\]/gi;
export const hasFirstNameToken = body => typeof body === 'string' && tokenPattern().test(body);
export function firstName(name) {
  return typeof name === 'string' && name.trim() ? name.trim().split(/\s+/u)[0] : 'there';
}
export function personalizeMessage(body, name) {
  if (typeof body !== 'string') throw new Error('Write a message first.');
  // Use a callback so names containing $&, $1, etc. remain literal text.
  const result = body.replace(tokenPattern(), () => firstName(name));
  if (result.length > 10000) throw new Error(`The personalized message for ${name || 'this recipient'} exceeds 10,000 characters. Shorten your message.`);
  return result;
}
export function scheduledRecipientBody(draft, conversationId) {
  if (draft.personalization?.kind !== 'first-name') return draft.body;
  const name = draft.personalization.names?.[conversationId];
  if (typeof name !== 'string') throw new Error('This scheduled message is missing its recipient name. Review the recipients before sending.');
  return personalizeMessage(draft.body, name);
}
