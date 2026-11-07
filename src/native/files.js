import {Filesystem,Directory} from '@capacitor/filesystem';
import {Share} from '@capacitor/share';
import {Browser} from '@capacitor/browser';
import {AppLauncher} from '@capacitor/app-launcher';
import {isNative,publicUrl} from './runtime';
function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
export async function shareNativeFile(url,name='Churp file'){
 const response=await fetch(url);if(!response.ok)throw new Error('This file is no longer available.');const data=new Uint8Array(await response.arrayBuffer()),safe=(name.split(/[\\/]/).at(-1)||'Churp file').replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,150).replace(/^\.+/,'')||'Churp file';
 const file=await Filesystem.writeFile({path:`churp-shares/${crypto.randomUUID()}/${safe}`,directory:Directory.Cache,data:base64(data),recursive:true});await Share.share({url:file.uri,title:safe,dialogTitle:'Save or share file'});
}
export async function clearNativeShares(){if(!isNative())return;try{await Filesystem.rmdir({directory:Directory.Cache,path:'churp-shares',recursive:true});}catch{}}
export async function openSystemLink(url){if(!isNative())return;const parsed=new URL(url);if(['https:','http:'].includes(parsed.protocol))return Browser.open({url});if(['sms:','mailto:','tel:'].includes(parsed.protocol))return AppLauncher.openUrl({url});throw new Error('This link cannot be opened.');}
export function installNativeLinks(){
 const listener=event=>{if(event.defaultPrevented||!isNative())return;const anchor=event.target.closest?.('a[href]');if(!anchor)return;const href=anchor.getAttribute('href');if(!href||href.startsWith('#'))return;
  if(href.startsWith('blob:')){event.preventDefault();shareNativeFile(href,anchor.getAttribute('download')||anchor.querySelector('img')?.alt||anchor.textContent.trim()||'Churp file').catch(e=>window.dispatchEvent(new CustomEvent('churp-native-error',{detail:e.message})));return;}
  const url=new URL(href,location.href);if(['https:','http:','sms:','mailto:','tel:'].includes(url.protocol)||['/terms','/privacy','/sms-terms','/delete-account'].includes(url.pathname)){event.preventDefault();const target=url.protocol===location.protocol&&url.host===location.host?publicUrl(url.pathname+url.search):url.href;openSystemLink(target).catch(e=>window.dispatchEvent(new CustomEvent('churp-native-error',{detail:e.message})));}
 };document.addEventListener('click',listener);return()=>document.removeEventListener('click',listener);
}

export async function purgeStaleNativeShares(){if(!isNative())return;try{const {files}=await Filesystem.readdir({directory:Directory.Cache,path:'churp-shares'});for(const file of files)if(Date.now()-(file.mtime||file.ctime||Date.now())>86400000)await Filesystem.rmdir({directory:Directory.Cache,path:'churp-shares/'+file.name,recursive:true});}catch{}}
