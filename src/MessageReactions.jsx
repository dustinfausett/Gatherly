import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {SmilePlus,X} from 'lucide-react';
import {api} from './api';
import {useEncryption} from './encryption/EncryptionGate';
import {decryptReactions,sealReactions} from './encryption/client';
import {QUICK_REACTIONS,REACTION_EMOJIS,toggleReaction} from '../shared/reactions';
import './message-reactions.css';
const Context=createContext(null);
function merge(previous,updates){const next=new Map(previous.map(r=>[r.id,r]));for(const row of updates)if(!next.has(row.id)||next.get(row.id).version<=row.version)next.set(row.id,row);return [...next.values()];}
export function ReactionsProvider({channel,messages,user,version,canReact=true,childId,children}){
 const {enabled}=useEncryption(),encrypted=enabled||channel==='private';
 const [rows,setRows]=useState([]),[busy,setBusy]=useState(new Set());const pending=useRef(new Set()),generation=useRef(0);
 const ids=[...new Set(messages.filter(m=>!m.deleted&&!m.decryptionError).map(m=>m.id))].sort((a,b)=>a-b).join(',');
 const childQuery=childId?`&child_id=${encodeURIComponent(childId)}`:'';
 useEffect(()=>{
  if(!ids){setRows([]);return;}
  let active=true;const epoch=generation.current,values=ids.split(','),chunks=[];for(let i=0;i<values.length;i+=200)chunks.push(values.slice(i,i+200).join(','));
  Promise.all(chunks.map(chunk=>api(`/reactions?channel=${channel}&ids=${chunk}${childQuery}`))).then(results=>decryptReactions(results.flatMap(r=>r.states),encrypted)).then(values=>{if(active&&epoch===generation.current)setRows(old=>merge(old.filter(r=>values.some(value=>value.id===r.id)),values));}).catch(()=>{if(active)setRows([]);});return()=>{active=false;};
 },[ids,version,channel,encrypted,childQuery]);
 async function react(messageId,emoji){
  if(!canReact||pending.current.has(messageId))return;
  generation.current++;pending.current.add(messageId);setBusy(new Set(pending.current));
  try{
   for(let attempt=0;attempt<2;attempt++){
    const path=`/reactions/${channel}/${messageId}`,latest=await api(path),decoded=await decryptReactions(latest.states,encrypted),mine=decoded.find(r=>r.user_id===user.id);
    if(!latest.can_react)throw new Error('Reactions are paused for this conversation.');
    if(mine?.invalid)throw new Error('Your earlier reactions could not be unlocked. Refresh or restore your encryption keys before changing them.');
    const emojis=toggleReaction(mine?.emojis||[],emoji),expectedVersion=mine?.version||0;
    const body=encrypted?await sealReactions(channel,messageId,emojis,expectedVersion,latest.roster):{expectedVersion,clientId:crypto.randomUUID(),reactionCount:emojis.length,body:JSON.stringify(emojis)};
    try{const result=await api(path,{method:'PUT',body});const values=await decryptReactions(result.states,encrypted);setRows(old=>merge(old,values));return;}
    catch(error){if(error.status!==409||attempt===1)throw error;}
   }
  }finally{pending.current.delete(messageId);setBusy(new Set(pending.current));}
 }
 const context={rows,user,react,busy,canReact};
 return <Context.Provider value={context}>{children}</Context.Provider>;
}
export default function MessageReactions({message,mode='summary'}){
 const context=useContext(Context),[open,setOpen]=useState(false),[search,setSearch]=useState(''),[error,setError]=useState(''),root=useRef(),more=useRef();
 useEffect(()=>{if(!open)return;const outside=e=>{if(!root.current?.contains(e.target))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 if(!context||message.deleted||message.decryptionError||(mode==='controls'&&!context.canReact))return null;
 const {rows,user,react,busy,canReact}=context,states=rows.filter(r=>r.message_id===message.id&&!r.invalid),mine=states.find(r=>r.user_id===user.id)?.emojis||[],working=busy.has(message.id),summary=new Map();
 for(const row of states)for(const emoji of row.emojis){if(!summary.has(emoji))summary.set(emoji,[]);summary.get(emoji).push(row.user_id===user.id?'You':row.name);}
 async function choose(emoji){setError('');setOpen(false);try{await react(message.id,emoji);}catch(e){setError(e.message);}}
 const choices=REACTION_EMOJIS.filter(item=>item.label.toLowerCase().includes(search.toLowerCase())||item.emoji===search);
 return <div className="message-reactions" data-message-id={message.id} ref={root} onKeyDown={e=>{if(open&&e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);more.current?.focus();}}}>
  {mode==='controls'&&canReact&&<div className="reaction-quick" role="group" aria-label="Quick reactions">{QUICK_REACTIONS.map(({emoji,label})=><button type="button" key={emoji} aria-label={`React with ${label}`} aria-pressed={mine.includes(emoji)} disabled={working} onClick={()=>choose(emoji)}>{emoji}</button>)}<button type="button" className="more-reactions" aria-label="More reactions" aria-expanded={open} aria-haspopup="dialog" disabled={working} ref={more} onClick={()=>{setOpen(v=>!v);setSearch('');}}><SmilePlus size={18}/></button></div>}
  {mode==='summary'&&!!summary.size&&<div className="reaction-summary" role="group" aria-label="Message reactions">{[...summary].map(([emoji,names])=>canReact?<button type="button" className={`reaction-chip ${mine.includes(emoji)?'mine':''}`} key={emoji} disabled={working} aria-label={`${emoji}: ${names.length} ${names.length===1?'reaction':'reactions'} from ${names.join(', ')}`} aria-pressed={mine.includes(emoji)} title={names.join(', ')} onClick={()=>choose(emoji)}><span>{emoji}</span><span>{names.length}</span></button>:<span className="reaction-chip" title={names.join(', ')} key={emoji}>{emoji} {names.length}</span>)}</div>}
  {open&&<section className="reaction-picker" role="dialog" aria-label="Choose a reaction" tabIndex={-1}><div className="reaction-picker-heading"><strong>A little reaction</strong><button type="button" aria-label="Close reactions" onClick={()=>{setOpen(false);more.current?.focus();}}><X size={17}/></button></div><input type="search" aria-label="Find an emoji" placeholder="Find an emoji…" value={search} onChange={e=>setSearch(e.target.value)}/><div className="reaction-emoji-grid">{choices.map(({emoji,label})=><button type="button" key={emoji} aria-label={label} aria-pressed={mine.includes(emoji)} onClick={()=>choose(emoji)}>{emoji}</button>)}</div>{!choices.length&&<p>No matching emojis.</p>}<small>Up to 5 different emojis. A sixth replaces your oldest. Tap a selected emoji to remove it.</small></section>}
  {error&&<p className="reaction-error" role="alert">{error}</p>}
 </div>;
}
