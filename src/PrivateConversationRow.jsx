import React,{useRef,useState} from 'react';
import {MoreHorizontal,Pin} from 'lucide-react';
import {Avatar} from './components';
import UnreadEgg from './UnreadEgg';
import {NavigationArt} from './Contacts';
export const conversationUnread=c=>!!(c.unread||c.marked_unread);
export default function PrivateConversationRow({conversation:c,selected,onOpen,onOptions,onUnread}){
 const [offset,setOffset]=useState(0),[revealed,setRevealed]=useState(false),[busy,setBusy]=useState(false),gesture=useRef(null),suppressClick=useRef(false),unread=conversationUnread(c);
 async function markUnread(){setBusy(true);try{await onUnread(c);}finally{setBusy(false);}}
 return <div className={`private-row-wrap ${unread?'is-unread':''} ${selected?'selected':''}`} data-conversation-id={c.id} data-unread={unread}>
  <div className="swipe-unread" aria-hidden="true"><NavigationArt kind="messages"/>Unread</div>
  <button type="button" className="swipe-options" tabIndex={revealed?0:-1} aria-hidden={!revealed} onClick={()=>{setRevealed(false);onOptions(c.id);}}>Options</button>
  <div className={`private-row-content ${busy?'busy':''}`} style={{transform:`translateX(${offset||(revealed?-90:0)}px)`}}
   onPointerDown={e=>{if(e.button!==0||busy)return;suppressClick.current=false;gesture.current={x:e.clientX,y:e.clientY,dx:0,swiping:false,vertical:false};}}
   onPointerMove={e=>{const g=gesture.current;if(!g||g.vertical)return;const dx=e.clientX-g.x,dy=e.clientY-g.y;if(!g.swiping&&Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){g.vertical=true;return;}if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.4){if(!g.swiping)e.currentTarget.setPointerCapture(e.pointerId);g.swiping=true;g.dx=dx;suppressClick.current=true;setOffset(Math.max(-100,Math.min(100,dx)));}}}
   onPointerUp={e=>{const g=gesture.current;gesture.current=null;setOffset(0);if(!g?.swiping)return;e.preventDefault();if(g.dx>64&&!busy){setRevealed(false);markUnread();}else setRevealed(g.dx < -64);}}
   onPointerCancel={()=>{gesture.current=null;setOffset(0);}}
   onClickCapture={e=>{if(suppressClick.current){e.preventDefault();e.stopPropagation();suppressClick.current=false;}}}>
   <button type="button" aria-label={`Open private conversation with ${c.name}`} aria-describedby={unread?`private-state-${c.id}`:undefined} className={`private-row ${unread?'is-unread':''} ${selected?'selected':''}`} onClick={()=>{if(revealed)setRevealed(false);else onOpen(c.id);}}><span className="row-avatar"><Avatar name={c.name} id={c.avatar_id} portrait={c.avatar_style!=='photo'?c.avatar_choice:undefined}/><UnreadEgg active={unread}/></span><span className="private-row-copy"><strong>{c.name}{c.pin_position!=null&&<Pin size={13} aria-label="Pinned"/>}</strong><small>{c.inactive?'Account deleted':c.parent_blocked||c.blocked_low||c.blocked_high?'Blocked':c.approval_required?'Parent approval or account setup needed':c.supervised?'Parent-supervised':'Private conversation'}</small></span>{!!c.unread&&<span className="private-count">{c.unread}</span>}{unread&&<span id={`private-state-${c.id}`} className="visually-hidden">Unread</span>}</button>
   <button type="button" className="icon-button private-row-options" aria-label={`Options for ${c.name}`} title="Conversation options" onClick={()=>{setRevealed(false);onOptions(c.id);}}><MoreHorizontal size={21}/></button>
  </div>
 </div>;
}
