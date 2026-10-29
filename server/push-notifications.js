// Dispatch each eligible message immediately. Foreground presence is per device,
// so reading Churp on a computer does not silence a closed phone.
export function createPushNotifications({db,enabled,send,badge,eligible=()=>true,canPreview=()=>true,now=Date.now}){
 if(!enabled)return {notify:async()=>{},processDue:async()=>{},close(){}};
 const one=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);let closed=false;
 // Discard alerts retained by the retired cooldown rather than delivering stale
 // notifications after upgrade. Keep the old tables for compatible migrations.
 run('DELETE FROM pending_push_alerts');run('DELETE FROM push_alert_windows');
 async function notify(uid,payload,preview=null,source=null){
  if(closed||!eligible(uid,source))return;
  const subscriptions=all('SELECT * FROM push_subscriptions s WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM push_presence p WHERE p.endpoint=s.endpoint AND p.visible_until>?)',uid,now());
  const account=one('SELECT notification_previews FROM users WHERE id=?',uid);if(!account)return;
  const data={...payload,recipient_id:uid,source,unread_count:badge(uid),...(account.notification_previews&&preview&&canPreview(uid,source,preview)?{preview}:{})};
  let body=JSON.stringify(data);if(Buffer.byteLength(body)>3500){delete data.preview;body=JSON.stringify(data);}
  await Promise.allSettled(subscriptions.map(async subscription=>{
   try{await send(JSON.parse(subscription.subscription),body);}catch(error){if(!closed&&[404,410].includes(error.statusCode))run('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?',subscription.endpoint,uid);throw error;}
  }));
 }
 return {notify,processDue:async()=>{},close(){closed=true;}};
}
