import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isMobileMessagingDevice,messageEnterKey} from '../src/message-keyboard.js';

const desktop={userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',platform:'Win32',maxTouchPoints:10,userAgentData:{mobile:false}};
const iphone={userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',platform:'iPhone',maxTouchPoints:5};
test('desktop Enter sends, Shift+Enter adds lines, and mobile/tablet Enter stays native',()=>{
 assert.equal(isMobileMessagingDevice(desktop),false);
 for(const device of [iphone,{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9)',platform:'Linux armv8l'},{userAgent:'Mozilla/5.0 Macintosh',platform:'MacIntel',maxTouchPoints:5},{userAgent:'mobile client',userAgentData:{mobile:true}}]){
  assert.equal(isMobileMessagingDevice(device),true);
  let sent=false,prevented=false;messageEnterKey({key:'Enter',preventDefault:()=>{prevented=true;}},{device,onSend:()=>{sent=true;}});assert.equal(sent,false);assert.equal(prevented,false);
 }
 for(const [extra,send,prevent] of [[{},true,true],[{shiftKey:true},false,false],[{ctrlKey:true},false,false],[{metaKey:true},false,false],[{altKey:true},false,false],[{key:'a'},false,false]]){
  let sent=false,prevented=false;messageEnterKey({key:'Enter',...extra,preventDefault:()=>{prevented=true;}},{device:desktop,onSend:()=>{sent=true;}});assert.equal(sent,send);assert.equal(prevented,prevent);
 }
});
test('composition, disabled submits and held Enter cannot cause accidental sends',()=>{
 for(const extra of [{isComposing:true},{nativeEvent:{isComposing:true}},{keyCode:229},{nativeEvent:{keyCode:229}}]){
  let sent=false,prevented=false;messageEnterKey({key:'Enter',...extra,preventDefault:()=>{prevented=true;}},{device:desktop,onSend:()=>{sent=true;}});assert.equal(sent,false);assert.equal(prevented,false);
 }
 for(const [extra,disabled] of [[{},true],[{repeat:true},false],[{nativeEvent:{repeat:true}},false]]){
  let sent=false,prevented=false;messageEnterKey({key:'Enter',...extra,preventDefault:()=>{prevented=true;}},{device:desktop,disabled,onSend:()=>{sent=true;}});assert.equal(sent,false);assert.equal(prevented,true);
 }
});
