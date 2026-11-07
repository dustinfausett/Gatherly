import {Browser} from '@capacitor/browser';
import {post} from '../api';
import {nativeCallback,mobileScheme} from '../../shared/mobile';
import {nativePlatform} from './runtime';
const key='churp:native-auth';let pending;
function secret(){const b=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
async function challenge(verifier){const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));return btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
export async function receiveNativeAuth(url){const callback=nativeCallback(url);if(!callback)return false;let saved;try{saved=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}if(!saved||saved.state!==callback.state||saved.expires<Date.now())return true;sessionStorage.removeItem(key);const active=pending;pending=null;try{await Browser.close();}catch{}
 try{if(callback.error)throw new Error('Google confirmation was cancelled.');const result=await post('/native-auth/exchange',{code:callback.code,state:callback.state,verifier:saved.verifier});active?.resolve(result);window.dispatchEvent(new CustomEvent('churp-native-auth-result',{detail:result}));}catch(error){active?.reject(error);window.dispatchEvent(new CustomEvent('churp-native-error',{detail:error.message}));}finally{pending=null;}return true;
}
export async function startNativeGoogle(purpose,proofNonce){if(pending)throw new Error('Finish the existing Google confirmation first.');const verifier=secret(),state=secret();const request=await post('/native-auth/start',{purpose,platform:nativePlatform(),code_challenge:await challenge(verifier),state,proof_nonce:proofNonce});sessionStorage.setItem(key,JSON.stringify({verifier,state,expires:Date.now()+5*60000}));
 return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{if(pending?.state===state){pending=null;sessionStorage.removeItem(key);reject(new Error('Google confirmation expired. Please try again.'));}},5*60000);pending={state,resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}};Browser.addListener('browserFinished',()=>{setTimeout(()=>{if(pending?.state===state){pending.reject(new Error('Google confirmation was cancelled.'));pending=null;sessionStorage.removeItem(key);}},1500);}).then(listener=>{setTimeout(()=>listener.remove(),5*60000);});Browser.open({url:request.browser_url}).catch(error=>{pending?.reject(error);pending=null;sessionStorage.removeItem(key);});});
}
