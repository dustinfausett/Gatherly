import {useEffect,useState} from 'react';
import {isMobileMessagingDevice} from './message-keyboard';
// Browser chrome can resize the viewport too. Only a substantial reduction
// while editing (or while an already-open keyboard closes) counts as a keyboard.
export function keyboardIsOpen({mobile,editing,baseline,height,scale=1,previous=false}){
 return mobile&&scale<=1.1&&(editing||previous)&&baseline-height>Math.max(120,baseline*.18);
}
const textInput=element=>element?.tagName==='TEXTAREA'||element?.isContentEditable||element?.tagName==='INPUT'&&!['button','submit','reset','checkbox','radio','range','color','file','hidden','date','time','datetime-local'].includes(element.type);
export default function useMobileKeyboard(){
 const [layout,setLayout]=useState({open:false,height:0,top:0});
 useEffect(()=>{
  if(!isMobileMessagingDevice())return;
  const viewport=window.visualViewport;let baseline=Math.max(window.innerHeight,viewport?.height||0),open=false,frame;
  function measure(){const height=viewport?.height||window.innerHeight,editing=!!textInput(document.activeElement),scale=viewport?.scale||1;if(!open&&!editing)baseline=Math.max(baseline,window.innerHeight,height);open=keyboardIsOpen({mobile:true,editing,baseline,height,scale,previous:open});setLayout({open,height,top:viewport?.offsetTop||0});}
  const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);},rotate=()=>{baseline=Math.max(window.innerHeight,viewport?.height||0);update();};
  document.addEventListener('focusin',update);document.addEventListener('focusout',update);window.addEventListener('resize',update);window.addEventListener('orientationchange',rotate);viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);measure();
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('focusin',update);document.removeEventListener('focusout',update);window.removeEventListener('resize',update);window.removeEventListener('orientationchange',rotate);viewport?.removeEventListener('resize',update);viewport?.removeEventListener('scroll',update);};
 },[]);
 return layout;
}
