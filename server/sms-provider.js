import {createHmac,timingSafeEqual} from 'node:crypto';
export function twilioSignature(token,url,form){return createHmac('sha1',token).update(url+Object.keys(form).sort().map(k=>k+form[k]).join('')).digest('base64');}
export function validTwilioSignature(token,url,form,signature){if(!token||typeof signature!=='string'||Object.values(form).some(v=>typeof v!=='string'))return false;const expected=Buffer.from(twilioSignature(token,url,form)),given=Buffer.from(signature);return expected.length===given.length&&timingSafeEqual(expected,given);}
export function smsConfiguration(env=process.env){
 const integer=(key,fallback)=>/^\d+$/.test(env[key]||'')?Number(env[key]):fallback;
 const mode=['mock','live'].includes(env.SMS_MODE)?env.SMS_MODE:'disabled';
 return {mode,accountSid:env.TWILIO_ACCOUNT_SID||'',authToken:env.TWILIO_AUTH_TOKEN||'',serviceSid:env.TWILIO_MESSAGING_SERVICE_SID||'',from:env.TWILIO_FROM_NUMBER||'',liveApproved:env.SMS_LIVE_APPROVED==='true',treeId:env.SMS_PILOT_TREE_ID||'',senders:(env.SMS_LIVE_SENDER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean),dailyLimit:Math.min(integer('SMS_DAILY_SEGMENT_LIMIT',200),10000),senderDailyLimit:Math.min(integer('SMS_SENDER_DAILY_SEGMENT_LIMIT',50),1000),dailyCents:Math.min(integer('SMS_DAILY_BUDGET_CENTS',1000),100000),segmentCents:Math.max(1,integer('SMS_ESTIMATED_SEGMENT_COST_CENTS',5))};
}
export function liveReady(c,appUrl){return c.mode==='live'&&c.liveApproved&&/^AC[\da-f]{32}$/i.test(c.accountSid)&&!!c.authToken&&/^MG[\da-f]{32}$/i.test(c.serviceSid)&&/^\+1\d{10}$/.test(c.from)&&new URL(appUrl).protocol==='https:'&&!!c.treeId&&c.senders.length>0;}
export async function twilioSend(config,{to,body,statusCallback},transport=fetch){
 let response;try{response=await transport(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:to,From:config.from,MessagingServiceSid:config.serviceSid,Body:body,StatusCallback:statusCallback}),signal:AbortSignal.timeout(15000)});}catch{return {state:'unknown',error:'Provider response was not received. Do not resend until reconciled.'};}
 let result;try{result=await response.json();}catch{return {state:'unknown',error:'Provider response could not be verified. Do not resend.'};}
 if(response.ok&&/^SM[\da-f]{32}$/i.test(result.sid))return {state:'submitted',sid:result.sid};
 // A timeout/5xx may follow acceptance. Retrying these can duplicate a text.
 if(response.status>=400&&response.status<500&&response.status!==408)return {state:'failed',code:Number.isInteger(result.code)?result.code:null,error:`Twilio rejected the request${Number.isInteger(result.code)?` (code ${result.code})`:''}.`};
 return {state:'unknown',error:'Provider acceptance is uncertain. Do not resend until reconciled.'};
}
