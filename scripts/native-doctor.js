import {existsSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {mobileAppId,validateAppOrigin,productionAppOrigin} from '../shared/mobile.js';
const config=JSON.parse(readFileSync('capacitor.config.json','utf8')),platform=process.argv.includes('--android')?'android':process.argv.includes('--ios')?'ios':'both';let broken=false;
function check(ok,message){console.log((ok?'OK: ':'NEEDS SETUP: ')+message);return ok;}
if(!check(Number(process.versions.node.split('.')[0])>=24,'Node 24 or newer'))broken=true;
if(!check(config.appId===mobileAppId&&!config.server?.url,'Shared bundled app; no remote website loaded as the app'))broken=true;
try{console.log('API: '+validateAppOrigin(process.env.VITE_CHURP_API_ORIGIN||productionAppOrigin));}catch(e){check(false,e.message);broken=true;}
if(platform!=='android'){
 check(existsSync('ios/App/App.xcodeproj'),'iPhone Xcode project');
 if(process.platform==='darwin'){try{console.log(execFileSync('xcodebuild',['-version'],{encoding:'utf8'}).trim());}catch{check(false,'Install Xcode, open it once and select its command-line tools.');}}else check(false,'iPhone compilation and simulator tests require Xcode on the Mac.');
 check(existsSync('ios/App/App/App.entitlements'),'Apple Developer signing and Push Notifications entitlement (needed for real native push)');
 console.log('Before App Store submission: complete Sign in with Apple or establish an applicable guideline 4.8 exception; review privacy labels and encryption/export questions.');
}
if(platform!=='ios'){
 check(existsSync('android/gradlew'),'Android Gradle project');const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;check(!!sdk&&existsSync(join(sdk,'platforms','android-36')),'Android SDK 36; install through Android Studio and set ANDROID_HOME.');try{execFileSync('java',['-version'],{stdio:'pipe'});check(true,'Java is available (use Java 21 for this project).');}catch{check(false,'Install Java 21 or use Android Studio’s bundled JDK.');}
 check(existsSync('android/app/google-services.json'),'Firebase Android configuration (needed for native Android push)');
}
console.log('Backend: native-auth and native-push routes must be deployed before testing. APNs/FCM delivery credentials are configured privately in Railway, never in this repository.');
if(broken)process.exitCode=1;
