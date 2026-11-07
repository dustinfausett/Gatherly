import {App} from '@capacitor/app';
import {Keyboard} from '@capacitor/keyboard';
import {SplashScreen} from '@capacitor/splash-screen';
import {StatusBar,Style} from '@capacitor/status-bar';
import {isNative,apiOrigin} from './runtime';
import {nativeRoute} from '../../shared/mobile';
import {receiveNativeAuth} from './auth';
import {installNativeLinks,purgeStaleNativeShares} from './files';
export async function initializeNative(){
 if(!isNative())return;document.documentElement.classList.add('churp-native');installNativeLinks();purgeStaleNativeShares();
 const open=async url=>{if(await receiveNativeAuth(url))return;const route=nativeRoute(url,apiOrigin);if(route)location.assign(new URL(route,location.href).href);};
 await App.addListener('appUrlOpen',event=>open(event.url));await App.addListener('appStateChange',event=>{window.dispatchEvent(new Event(event.isActive?'churp-native-resume':'churp-native-pause'));});
 const launch=await App.getLaunchUrl();if(launch?.url)await open(launch.url);
 await App.addListener('backButton',({canGoBack})=>{const modal=document.querySelector('[role="dialog"]');if(modal){modal.querySelector('button[aria-label="Close dialog"],button[aria-label="Close message options"]')?.click();return;}if(document.activeElement?.matches('input,textarea')){Keyboard.hide();document.activeElement.blur();return;}const event=new Event('churp-native-back',{cancelable:true});if(!window.dispatchEvent(event))return;if(canGoBack)history.back();else App.minimizeApp();});
 for(const event of ['keyboardWillShow','keyboardDidShow','keyboardWillHide','keyboardDidHide'])Keyboard.addListener(event,data=>{window.dispatchEvent(new CustomEvent('churp-native-keyboard',{detail:{open:event.endsWith('Show'),height:data.keyboardHeight||0}}));}).catch(()=>{});
 StatusBar.setStyle({style:Style.Dark}).catch(()=>{});SplashScreen.hide().catch(()=>{});
}
