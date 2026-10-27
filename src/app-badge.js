import {useEffect} from 'react';
import {api} from './api';
import {notificationPreferred} from './notifications';
export async function setAppBadge(count){
 if(!Number.isSafeInteger(count)||count<0)return;
 try{if(count===0){if(navigator.clearAppBadge)await navigator.clearAppBadge();else if(navigator.setAppBadge)await navigator.setAppBadge(0);}else if(navigator.setAppBadge)await navigator.setAppBadge(count);}catch{/* Unsupported/denied badging must never interrupt messaging. */}
}
export function useAppBadge(user,version){
 useEffect(()=>{
  let active=true,request=0;
  if(!user||user.family?.needs_setup){setAppBadge(0);return;}
  if(!navigator.setAppBadge&&!navigator.clearAppBadge)return;
  const update=async()=>{if(!notificationPreferred(user.id)){request++;await setAppBadge(0);return;}if(document.visibilityState==='hidden')return;const current=++request;try{const badge=await api('/badges');if(active&&current===request)await setAppBadge(badge.count);}catch(e){if(active&&e.status===401)await setAppBadge(0);}};
  update();window.addEventListener('churp-device-notifications',update);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return()=>{active=false;window.removeEventListener('churp-device-notifications',update);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[user?.id,user?.family?.needs_setup,version]);
}
