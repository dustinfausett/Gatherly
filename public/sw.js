// Preview resolver v2: fresh access checks and encrypted-message recovery.
if(typeof importScripts==='function')try{importScripts('/push-preview.js');}catch{}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Never cache authenticated requests, message contents or private conversations.
// The red Home Screen badge uses the Badging API, not NotificationOptions.badge
// (that separate option is a small notification-tray image on some devices).
async function applyBadge(count){
 if(!Number.isSafeInteger(count)||count<0)return;
 try{if(count===0){if(self.navigator.clearAppBadge)await self.navigator.clearAppBadge();else if(self.navigator.setAppBadge)await self.navigator.setAppBadge(0);}else if(self.navigator.setAppBadge)await self.navigator.setAppBadge(count);}catch{}
}
async function refreshBadge(fallback){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3000);
 try{
  const response=await fetch('/api/badges',{credentials:'include',cache:'no-store',signal:controller.signal});
  if(response.status===401){await applyBadge(0);return;}
  if(!response.ok)throw new Error('Badge state unavailable.');
  const badge=await response.json();await applyBadge(badge.count);
 }catch{await applyBadge(fallback);}finally{clearTimeout(timeout);}
}
// Late or retried provider deliveries update the existing tray item quietly.
async function quietAlert(userId){
 if(!userId||typeof indexedDB==='undefined')return false;
 let db;
 try{
  db=await new Promise((resolve,reject)=>{const request=indexedDB.open('churp-push-alerts',1);request.onupgradeneeded=()=>request.result.createObjectStore('alerts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  return await new Promise((resolve,reject)=>{const transaction=db.transaction('alerts','readwrite'),store=transaction.objectStore('alerts'),request=store.get(userId);let quiet=false;
   request.onsuccess=()=>{const now=Date.now();quiet=typeof request.result==='number'&&now-request.result<30000;if(!quiet)store.put(now,userId);};transaction.oncomplete=()=>resolve(quiet);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });
 }catch{return false;}finally{db?.close();}
}
self.addEventListener('push',event=>{
 let payload;try{payload=event.data?.json();}catch{return;}if(!payload||typeof payload!=='object')return;
 // Keep a visible notification for every message push: iOS does not support
 // using silent pushes solely to change a badge.
 event.waitUntil((async()=>{
  const display=self.churpPushPreview?await self.churpPushPreview(payload):{title:payload.title||'Churp',body:payload.body};
  const quiet=await quietAlert(payload.recipient_id);
  await Promise.allSettled([
  self.registration.showNotification(display.title,{
   body:display.body,icon:'/icons/churp-home-192.png',data:{url:payload.url||'/'},tag:'gatherly-message',renotify:!quiet,silent:quiet,
  }),refreshBadge(payload.unread_count),
 ]);
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();let target;try{target=new URL(event.notification.data?.url||'/',self.location.origin);}catch{return;}
 if(target.origin!==self.location.origin)return;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
  const existing=clients.find(c=>c.url.startsWith(self.location.origin));
  if(existing){await existing.navigate(target.href);return existing.focus();}
  return self.clients.openWindow(target.href);
 }));
});
