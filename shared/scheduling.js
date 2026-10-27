export const MAX_SCHEDULE_DAYS=365;
export function scheduleTime(value,now=Date.now()){
 const time=typeof value==='number'?value:Date.parse(value);
 if(!Number.isSafeInteger(time)||time<=now||time>now+MAX_SCHEDULE_DAYS*86400000)throw new Error('Choose a future time within the next year.');return time;
}
export function scheduleProof({client_id,send_at,time_zone,entries,draft_ciphertext}){return {clientId:client_id,sendAt:send_at,timeZone:time_zone,entries,draftCiphertext:draft_ciphertext};}
