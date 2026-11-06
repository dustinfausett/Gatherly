// System-only identity. Deliberately absent from selectable avatars and pets.
export const deletedAccountName='Unknown';
export const deletedAccountAvatar='deleted-crow';
export const deletedAccountImage='/brand/avatars/churp-unknown-crow.png';
export function protectedHistoryUntil(birthDate){if(!birthDate)return null;const [year,month,day]=birthDate.split('-').map(Number);return Date.UTC(year+18,month-1,day);}
