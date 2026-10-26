// Dates remain private account data. Use calendar dates, never a mutable age field.
export function birthDate(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Enter your date of birth.');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0,10) !== value || value > now.toISOString().slice(0,10) || +value.slice(0,4) < now.getUTCFullYear()-120) throw new Error('Enter a valid date of birth.');
  return value;
}
export function ageAt(value, now = new Date()) {
  if (!value) return null;
  const [year,month,day] = value.split('-').map(Number);
  return now.getUTCFullYear()-year-Number(now.getUTCMonth()+1 < month || (now.getUTCMonth()+1 === month && now.getUTCDate() < day));
}
