import {Capacitor} from '@capacitor/core';
import {backendPath,productionAppOrigin} from '../../shared/mobile';
export const isNative=()=>Capacitor.isNativePlatform();
export const nativePlatform=()=>Capacitor.getPlatform();
export const apiOrigin=import.meta.env?.VITE_CHURP_API_ORIGIN||productionAppOrigin;
export const publicUrl=path=>isNative()?backendPath(path,apiOrigin):path;
export const apiUrl=path=>isNative()?backendPath('/api'+path,apiOrigin):'/api'+path;
export async function backendFetch(path,options={}){
 return fetch(isNative()?backendPath(path,apiOrigin):path,{...options,credentials:isNative()?'include':options.credentials||'same-origin',headers:{...(isNative()?{'x-churp-client':'native'}:{}),...options.headers}});
}
export async function watchRefresh(refresh){
 let stopped=false,last=null,working=false;const active=()=>document.visibilityState!=='hidden';
 const poll=async()=>{if(stopped||working||!active())return;working=true;try{const response=await backendFetch('/api/sync');if(response.status===401){refresh();return;}if(!response.ok)return;const {version}=await response.json();if(!stopped&&last!==version){last=version;refresh();}}catch{}finally{working=false;}};
 const focus=()=>{refresh();poll();};document.addEventListener('visibilitychange',focus);window.addEventListener('online',focus);window.addEventListener('churp-native-resume',focus);const timer=setInterval(poll,5000);poll();
 return ()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',focus);window.removeEventListener('online',focus);window.removeEventListener('churp-native-resume',focus);};
}
