import React,{cloneElement,useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Copy,X} from 'lucide-react';
import './message-focus.css';
export const MESSAGE_HOLD_MS=750;

function FocusedMessage({children,reactions,actions,copyText,onClose,source,label,onActivate,onClickCapture}){
 const panel=useRef(),closeButton=useRef(),title=useId(),[status,setStatus]=useState('');
 useEffect(()=>{
  const app=document.getElementById('root'),previousInert=app?.inert,overflow=document.body.style.overflow;
  if(app)app.inert=true;document.body.style.overflow='hidden';closeButton.current?.focus();
  return()=>{if(app)app.inert=previousInert;document.body.style.overflow=overflow;if(source.current?.isConnected&&(document.activeElement===document.body||panel.current?.contains(document.activeElement)))source.current.focus({preventScroll:true});};
 },[]);
 function keys(event){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
  if(event.key==='Tab'){
   const nodes=[...panel.current.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length),first=nodes[0],last=nodes.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
 }
 return createPortal(<div className="message-focus-backdrop" onClickCapture={onClickCapture} onPointerDown={event=>{if(event.target===event.currentTarget)onClose();}}>
  <section className="message-focus-card" role="dialog" aria-modal="true" aria-labelledby={title} ref={panel} onKeyDown={keys}>
   <h2 id={title} className="visually-hidden">{label}</h2><button type="button" className="message-focus-close icon-button" aria-label="Close message options" onClick={onClose} ref={closeButton}><X size={20}/></button>
   <div className="message-focus-reactions">{reactions}</div>
   <div className="message-focus-preview" onClickCapture={event=>{const button=event.target.closest('button');if(!button||event.target.closest('.message-reactions'))return;if(onActivate&&event.target.closest('.poll-message')){event.preventDefault();event.stopPropagation();onClose();onActivate();}else onClose();}}>{cloneElement(children,{className:`${children.props.className||''} is-focused-message`,tabIndex:undefined})}</div>
   <div className="message-focus-actions">{actions?.(onClose)}{typeof copyText==='string'&&copyText.trim()&&<button type="button" className="message-copy-action" onClick={async()=>{try{await navigator.clipboard.writeText(copyText);setStatus('Copied to clipboard.');}catch{setStatus('Could not copy. You can select the message text to copy it.');}}}><Copy size={16}/>Copy text</button>}</div>
   {status&&<p className="message-focus-status" role="status">{status}</p>}
  </section>
 </div>,document.body);
}

export default function MessageFocus({children,reactions,actions,copyText,label='Message options',disabled=false,onClose,onActivate}){
 const [open,setOpen]=useState(false),source=useRef(),timer=useRef(),press=useRef(),unlisten=useRef(()=>{}),suppressClick=useRef(false),unguard=useRef(()=>{}),closed=useRef(onClose);closed.current=onClose;
 function cancel(){clearTimeout(timer.current);press.current=null;unlisten.current();unlisten.current=()=>{};}
 function close(){setOpen(false);unguard.current();closed.current?.();}
 function consumeHeldClick(event){if(!suppressClick.current)return;unguard.current();if(event.detail===0)return;event.preventDefault();event.stopPropagation();}
 // Opening the overlay may retarget the release click onto its preview.
 // Suppress that click, but allow the next deliberate pointer/keyboard action.
 function guardHeldClick(){
  unguard.current();suppressClick.current=true;
  const reset=()=>{suppressClick.current=false;document.removeEventListener('pointerdown',reset,true);unguard.current=()=>{};};
  unguard.current=reset;document.addEventListener('pointerdown',reset,{capture:true,once:true});
 }
 useEffect(()=>()=>{clearTimeout(timer.current);unlisten.current();unguard.current();},[]);
 useEffect(()=>{if(disabled&&open)close();},[disabled,open]);
 function insideDialog(event){const dialog=event.target.closest('[role=dialog]');return dialog&&event.currentTarget.contains(dialog);}
 function start(event){
  if(insideDialog(event))return;
  if(disabled||open||event.button!==0||event.isPrimary===false||event.target.closest('input,textarea,select,[contenteditable=true]'))return;
  cancel();press.current={x:event.clientX,y:event.clientY,id:event.pointerId};
  const move=event=>{const p=press.current;if(p&&event.pointerId===p.id&&Math.hypot(event.clientX-p.x,event.clientY-p.y)>10)cancel();};
  const end=()=>cancel();
  document.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true);document.addEventListener('scroll',end,{capture:true,passive:true});window.addEventListener('blur',end);
  unlisten.current=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end,true);document.removeEventListener('pointercancel',end,true);document.removeEventListener('scroll',end,true);window.removeEventListener('blur',end);};
  timer.current=setTimeout(()=>{cancel();guardHeldClick();setOpen(true);},MESSAGE_HOLD_MS);
 }
 const target=cloneElement(children,{
  ref:source,className:`${children.props.className||''} ${disabled?'':'message-focus-target'}`,
  tabIndex:disabled?undefined:0,'aria-haspopup':disabled?undefined:'dialog','aria-description':disabled?undefined:'Hold for three quarters of a second, or press Enter, to open message options.',
  onPointerDownCapture:start,
  onClickCapture:consumeHeldClick,
  onContextMenu:event=>{if(disabled||insideDialog(event))return;event.preventDefault();if(!press.current&&event.button===2&&event.nativeEvent.pointerType!=='touch'){cancel();setOpen(true);}},
  onKeyDown:event=>{if(!disabled&&event.target===event.currentTarget&&(['Enter',' ' ,'ContextMenu'].includes(event.key)||(event.key==='F10'&&event.shiftKey))){event.preventDefault();cancel();setOpen(true);}},
 });
 return <>{target}{open&&!disabled&&<FocusedMessage onClickCapture={consumeHeldClick} onActivate={onActivate} source={source} label={label} reactions={reactions} actions={actions} copyText={copyText} onClose={close}>{children}</FocusedMessage>}</>;
}
