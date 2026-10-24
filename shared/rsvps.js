// Event details and RSVP choices are signed and encrypted like other Nest messages.
export const RSVP_CHOICES = [{ id: 'going', label: 'Going', mood: 'happy' }, { id: 'maybe', label: 'Maybe', mood: 'questioning' }, { id: 'declined', label: 'Can’t go', mood: 'sad' }];
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new Error(`Enter ${required ? '1–' : 'up to '}${max} characters.`);
  return value.trim();
}
export function deadline(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Choose a valid response deadline.');
  return new Date(value).toISOString();
}
export function validateRsvp(value) {
  const title = text(value?.title, 100, true), allDay = value.allDay === true;
  let start, end = value.end || null;
  if (allDay) {
    const valid = d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;
    if (!valid(value.start) || (end && !valid(end))) throw new Error('Choose a valid event date.');
    start = value.start;
  } else { start = deadline(value.start); end = deadline(end); if (!start) throw new Error('Choose an event date and time.'); }
  if (end && end < start) throw new Error('The end must be after the start.');
  const timeZone = text(value.timeZone || 'UTC', 80, true);
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new Error('Choose a valid time zone.'); }
  return { churp: 'rsvp', version: 1, title, allDay, start, end, timeZone, location: text(value.location || '', 500), description: text(value.description || '', 3000), responseDeadline: deadline(value.responseDeadline) };
}
export function parseRsvp(body) { try { const v = JSON.parse(body); return v.churp === 'rsvp' && v.version === 1 ? validateRsvp(v) : null; } catch { return null; } }
export function validateResponse(value) {
  if (!RSVP_CHOICES.some(c => c.id === value?.choice)) throw new Error('Choose Going, Maybe or Can’t go.');
  if (!Number.isSafeInteger(value.guests) || value.guests < 0 || value.guests > 99 || (value.choice === 'declined' && value.guests !== 0)) throw new Error('Enter 0–99 additional guests.');
  return { choice: value.choice, guests: value.guests };
}
export const encodeResponse = (eventId, value) => JSON.stringify({ churp: 'rsvp-response', version: 1, eventId, ...validateResponse(value) });
export function parseResponse(body, eventId) { try { const v = JSON.parse(body); return v.churp === 'rsvp-response' && v.version === 1 && v.eventId === eventId ? validateResponse(v) : null; } catch { return null; } }
export function responseSummary(responses) {
  return Object.fromEntries(RSVP_CHOICES.map(({ id }) => { const list = responses.filter(r => r.choice === id), guests = list.reduce((n, r) => n + r.guests, 0); return [id, { members: list.length, guests, total: list.length + guests }]; }));
}
