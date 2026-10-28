import React,{useEffect,useState} from 'react';
import {Bell,BellOff} from 'lucide-react';
import {api,post} from './api';
const event='churp-device-notifications',key=id=>`churp:device-notifications:${id}`;
const read=id=>{try{const value=JSON.parse(localStorage.getItem(key(id))||'{}');return value&&typeof value==='object'?value:{};}catch{return {};}};
const save=(id,changes)=>{try{localStorage.setItem(key(id),JSON.stringify({...read(id),...changes}));}catch{}window.dispatchEvent(new Event(event));};
export const notificationPreferred=id=>read(id).enabled!==false;
const supported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
let operations=Promise.resolve();
const serial=operation=>{const next=operations.then(operation,operation);operations=next.catch(()=>{});return next;};
async function registration(){return await navigator.serviceWorker.getRegistration()||await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});}
export async function enableDeviceNotifications(user,config,ask=false){
 if(!supported())throw new Error('Device notifications need a supported browser and HTTPS. On iPhone, add Churp to your Home Screen first.');
 if(!config.vapidPublicKey)throw new Error('Device notifications are awaiting server setup. Nest unread indicators still work.');
 // Permission must be requested directly from a user gesture, before asynchronous work.
 const permission=ask&&Notification.permission!=='granted'?await Notification.requestPermission():Notification.permission;
 if(permission!=='granted')throw new Error(permission==='denied'?'Allow notifications in your browser’s site settings, then try again.':'Tap Enable to allow notifications on this device.');
 return serial(async()=>{
  const reg=await registration();
  if(!reg.active)await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Refresh Churp to finish notification setup.')),10000))]);
  const raw=atob(config.vapidPublicKey.replaceAll('-','+').replaceAll('_','/')),applicationServerKey=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const subscription=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});
  await post('/push/subscribe',{subscription:subscription.toJSON()});save(user.id,{enabled:true,dismissed:false});return true;
 });
}
export const disconnectDeviceNotifications=(user,remember=true)=>serial(async()=>{
 const reg='serviceWorker' in navigator?await navigator.serviceWorker.getRegistration():null,subscription=await reg?.pushManager?.getSubscription();
 if(subscription){await api('/push/subscribe',{method:'DELETE',body:{endpoint:subscription.endpoint}});await subscription.unsubscribe();}
 if(remember)save(user.id,{enabled:false});
});
function useDeviceNotifications(user){
 const [state,setState]=useState({loaded:false,subscribed:false,preferred:notificationPreferred(user.id),dismissed:!!read(user.id).dismissed});
 useEffect(()=>{let active=true;const update=async()=>{let subscription=null;try{subscription=await (await navigator.serviceWorker?.getRegistration())?.pushManager?.getSubscription();}catch{}if(active)setState({loaded:true,subscribed:!!subscription,preferred:notificationPreferred(user.id),dismissed:!!read(user.id).dismissed});};update();window.addEventListener(event,update);return()=>{active=false;window.removeEventListener(event,update);};},[user.id]);return state;
}
export function DeviceNotifications({user,config}){
 const state=useDeviceNotifications(user),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(config.vapidPublicKey&&supported()&&notificationPreferred(user.id)&&Notification.permission==='granted')enableDeviceNotifications(user,config).catch(()=>{});},[user.id,config.vapidPublicKey]);
 if(!state.loaded||!state.preferred||state.subscribed||state.dismissed||!config.vapidPublicKey||!supported()||Notification.permission==='denied')return null;
 return <aside className="device-notification-prompt" aria-label="Enable device notifications"><p>Keep up with your Nests. Allow notifications on this device; you can mute any Nest.</p><div className="button-row"><button className="button primary small" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await enableDeviceNotifications(user,config,true);}catch(e){setError(e.message);}finally{setBusy(false);}}}><Bell size={16}/>{busy?'Enabling…':'Enable notifications'}</button><button className="text-button" onClick={()=>save(user.id,{dismissed:true})}>Not now</button></div>{error&&<p role="status">{error}</p>}</aside>;
}
export function NotificationScreen({user,config}){
 const state=useDeviceNotifications(user),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 return <div className="settings-section notification-settings"><h4>Stay in the loop</h4><p className="muted small-text">Device alerts are on by default after your browser grants permission. Each Nest can be muted separately. Supported Home Screen apps also show an unread-message badge. {state.preferred&&!state.subscribed?'This device still needs permission or setup.':''}</p><button type="button" className="button secondary" disabled={!state.loaded||busy} onClick={async()=>{setBusy(true);setNotice('');try{if(state.subscribed){await disconnectDeviceNotifications(user);setNotice('Device notifications are off for this browser.');}else{await enableDeviceNotifications(user,config,true);setNotice('Device notifications are on for this browser.');}}catch(e){setNotice(e.message);}finally{setBusy(false);}}}>{state.subscribed?<BellOff size={17}/>:<Bell size={17}/>}{busy?'Updating…':state.subscribed?'Turn off device notifications':'Enable device notifications'}</button>{!config.vapidPublicKey&&<p className="small-text muted">Device push is awaiting server configuration.</p>}{notice&&<p className="info-banner" role="status">{notice}</p>}</div>;
}

export function NotificationPrivacySettings({user,onAccountUpdate}){
 const [enabled,setEnabled]=useState(user.notification_previews!==false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>setEnabled(user.notification_previews!==false),[user.notification_previews]);
 return <section className="settings-section notification-privacy"><h4>Notification privacy</h4><label className="toggle-row"><span><strong>Show message previews</strong><small>Show who sent a message and its first few words in phone notifications. Turn this off to keep those details private.</small></span><input className="visually-hidden" type="checkbox" aria-label="Show message previews" checked={enabled} disabled={busy} onChange={async event=>{const next=event.target.checked;setEnabled(next);setBusy(true);setError('');try{const result=await api('/me/notification-privacy',{method:'PATCH',body:{show_previews:next}});onAccountUpdate(result.user);}catch(e){setEnabled(!next);setError(e.message);}finally{setBusy(false);}}}/><span className={`toggle ${enabled?'checked':''}`} aria-hidden="true"><span/></span></label><p className="small-text muted">Applies to future alerts on all your devices. Alerts are limited to one every 30 seconds; messages arriving together are combined into the next alert. Messages still arrive in your chats immediately.</p>{error&&<p className="error-banner" role="alert">{error}</p>}</section>;
}
