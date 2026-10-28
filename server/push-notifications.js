import {randomUUID} from 'node:crypto';
import {keyVault} from './key-vault.js';
import {PUSH_COOLDOWN_MS} from '../shared/notification-previews.js';

// Coalesce bursts before reaching the push provider; iOS requires every push to be visible.
export function createPushNotifications({db,dataDir,enabled,send,badge,eligible=()=>true,canPreview=()=>true,now=Date.now,autoProcess=true}){
 if(!enabled)return {notify:async()=>{},processDue:async()=>{},close(){}};
 const one=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
 const vault=keyVault(dataDir,!!one('SELECT 1 FROM pending_push_alerts LIMIT 1'));let closed=false,processing=false;
 async function notify(uid,payload,preview=null,source=null){
  if(closed||!eligible(uid,source))return;
  const subscriptions=all('SELECT * FROM push_subscriptions WHERE user_id=?',uid);
  if(!subscriptions.length){run('DELETE FROM pending_push_alerts WHERE user_id=?',uid);return;}
  const time=now(),token=randomUUID();
  const claimed=one(`INSERT INTO push_alert_windows(user_id,last_alert_at,token) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET last_alert_at=excluded.last_alert_at,token=excluded.token WHERE push_alert_windows.last_alert_at<=? RETURNING token`,uid,time,token,time-PUSH_COOLDOWN_MS);
  if(!claimed){
   const due=one('SELECT last_alert_at FROM push_alert_windows WHERE user_id=?',uid).last_alert_at+PUSH_COOLDOWN_MS;
   run('INSERT INTO pending_push_alerts(user_id,due_at,payload) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET due_at=excluded.due_at,payload=excluded.payload',uid,due,vault.seal(uid,'pending-push',JSON.stringify({payload,preview,source})));
   return;
  }
  run('DELETE FROM pending_push_alerts WHERE user_id=?',uid);
  const account=one('SELECT notification_previews FROM users WHERE id=?',uid);
  if(!account)return;
  const data={...payload,recipient_id:uid,source,unread_count:badge(uid),...(account.notification_previews&&preview&&canPreview(uid,source,preview)?{preview}:{})};
  let body=JSON.stringify(data);if(Buffer.byteLength(body)>3500){delete data.preview;body=JSON.stringify(data);}
  const results=await Promise.allSettled(subscriptions.map(async subscription=>{
   try{await send(JSON.parse(subscription.subscription),body);}catch(error){if(!closed&&[404,410].includes(error.statusCode))run('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?',subscription.endpoint,uid);throw error;}
  }));
  if(!closed&&results.every(result=>result.status==='rejected'&&result.reason?.statusCode>=400&&result.reason?.statusCode<500))run('DELETE FROM push_alert_windows WHERE user_id=? AND token=?',uid,token);
 }
 async function processDue(){
  if(closed||processing)return;processing=true;
  try{for(const row of all('SELECT * FROM pending_push_alerts WHERE due_at<=? ORDER BY due_at LIMIT 100',now())){
   if(closed)break;
   run('DELETE FROM pending_push_alerts WHERE user_id=? AND payload=?',row.user_id,row.payload);
   try{const value=JSON.parse(vault.open(row.user_id,'pending-push',row.payload));await notify(row.user_id,value.payload,value.preview,value.source);}catch{/* Invalid or unavailable queued alerts never expose a preview or stop messaging. */}
  }}finally{processing=false;}
 }
 const timer=autoProcess?setInterval(()=>processDue().catch(()=>{}),1000):null;timer?.unref();
 return {notify,processDue,close(){closed=true;clearInterval(timer);}};
}
