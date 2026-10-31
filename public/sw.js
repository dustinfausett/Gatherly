// Notifications v5: validate private edits; immediate background alerts and visible-app suppression.
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
// The server normally avoids pushes to visible devices. Check again for a
// window opened after dispatch, before decrypting or displaying an alert.
async function appVisible(){
 try{return (await self.clients.matchAll({type:'window',includeUncontrolled:true})).some(c=>c.visibilityState==='visible'&&new URL(c.url).origin===self.location.origin&&new URL(c.url).pathname==='/');}catch{return false;}
}
self.addEventListener('push',event=>{
 let payload;try{payload=event.data?.json();}catch{return;}if(!payload||typeof payload!=='object')return;
 // Presence prevents foreground provider sends; this check also covers
 // notifications already in flight when Churp becomes visible.
 event.waitUntil((async()=>{
  if(await appVisible()){await refreshBadge(payload.unread_count);return;}
  const display=self.churpPushPreview?await self.churpPushPreview(payload):{title:payload.title||'Churp',body:payload.body};
  if(await appVisible()){await refreshBadge(payload.unread_count);return;}
  await Promise.allSettled([
  self.registration.showNotification(display.title,{
   body:display.body,icon:'/icons/churp-home-192.png',data:{url:payload.url||'/'},tag:`churp-${payload.source?.channel||'alert'}-${payload.source?.messageId||crypto.randomUUID()}`,renotify:false,silent:false,
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
