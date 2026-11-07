import {PushNotifications} from '@capacitor/push-notifications';
import {Badge} from '@capawesome/capacitor-badge';
import {App} from '@capacitor/app';
import {api,post} from '../api';
import {nativePlatform,apiOrigin} from './runtime';
import {nativeRoute} from '../../shared/mobile';
const env=import.meta.env?.VITE_CHURP_APNS_ENV==='production'?'production':'development',key='churp:native-push-install';let owner=null,active=true,started=false,lastToken=null;
function installId(){let id=localStorage.getItem(key);if(!id){id=crypto.randomUUID();localStorage.setItem(key,id);}return id;}
export async function nativePushConfigured(){const r=await api('/native-push/config');return !!r.configured[nativePlatform()];}
export async function nativePushSubscribed(userId){const permission=await PushNotifications.checkPermissions();return permission.receive==='granted'&&localStorage.getItem('churp:native-push-subscribed')===userId;}
async function subscribe(token){if(!owner)return;await post('/native-push/subscribe',{install_id:installId(),platform:nativePlatform(),token,environment:env});localStorage.setItem('churp:native-push-subscribed',owner);window.dispatchEvent(new Event('churp-device-notifications'));await presence();}
async function presence(){if(!owner)return;try{const result=await post('/native-push/presence',{install_id:installId(),visible:active&&document.visibilityState!=='hidden'});if(!result.subscribed&&owner&&lastToken)await subscribe(lastToken);}catch{}}
export async function enableNativePush(user,ask=false){owner=user.id;if(!await nativePushConfigured())throw new Error('Phone notifications are awaiting Apple or Firebase setup.');
 if(!started){started=true;await PushNotifications.addListener('registration',result=>{lastToken=result.value;subscribe(result.value).catch(e=>window.dispatchEvent(new CustomEvent('churp-native-error',{detail:e.message})));});await PushNotifications.addListener('registrationError',()=>window.dispatchEvent(new CustomEvent('churp-native-error',{detail:'Phone notifications could not register. Check the Apple or Firebase setup.'})));await PushNotifications.addListener('pushNotificationActionPerformed',event=>{if(event.notification.data?.recipient_id&&event.notification.data.recipient_id!==owner)return;const route=nativeRoute(new URL(event.notification.data?.url||'/',apiOrigin).href,apiOrigin);if(route)location.assign(new URL(route,location.href).href);});await App.addListener('appStateChange',event=>{active=event.isActive;presence();});window.addEventListener('visibilitychange',presence);setInterval(presence,15000);if(nativePlatform()==='android')await PushNotifications.createChannel({id:'churp-messages',name:'Churp messages',description:'Messages from your Nests and private conversations',importance:4,visibility:0});}
 let permission=await PushNotifications.checkPermissions();if(permission.receive!=='granted'&&ask)permission=await PushNotifications.requestPermissions();if(permission.receive!=='granted')throw new Error('Allow notifications in your phone settings, then try again.');await PushNotifications.register();if(lastToken)await subscribe(lastToken);
}
export async function disableNativePush(){const id=localStorage.getItem(key);try{if(id)await api('/native-push/subscribe',{method:'DELETE',body:{install_id:id}});}finally{owner=null;lastToken=null;localStorage.removeItem('churp:native-push-subscribed');try{await PushNotifications.unregister();await PushNotifications.removeAllDeliveredNotifications();await Badge.clear();}catch{}window.dispatchEvent(new Event('churp-device-notifications'));}}

export async function nativeBadge(count){try{await Badge.set({count});}catch{}}
