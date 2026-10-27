import MessageFocus from './MessageFocus';
import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle,Clock,Paperclip,Reply} from 'lucide-react';
import MessageText from './MessageText';
import ScheduledActions from './ScheduledActions';
import {ScheduledEditor} from './ScheduledOutbox';
import {conversationParts,useScheduledSends} from './scheduled-state';
import {scheduleLabel} from './scheduled-client';
import {activityArtwork} from './activityArtwork';

export default function ScheduledMessages({channel,targetId,version,enabled=true,...props}){
 const state=useScheduledSends({channel,targetId,version,enabled});
 return <ScheduledPreviews key={`${channel}:${targetId}`} state={state} channel={channel} targetId={targetId} {...props}/>;
}
export function ScheduledPreviews({state,channel,targetId,threadId=null,search='',onThread,onRefresh}){
 const [editor,setEditor]=useState(null),anchor=useRef(null),previousIds=useRef(new Set());
 const rows=(state.rows||[]).filter(row=>{
  const parts=conversationParts(row,channel,targetId);
  return parts.some(p=>threadId===null||row.entries[p.position].request.reply_to===threadId)&&(!search||row.draft?.body?.toLowerCase().includes(search.toLowerCase()));
 }).sort((a,b)=>a.send_at-b.send_at);
 const ids=rows.map(r=>r.id).join(',');
 useEffect(()=>{const current=new Set(rows.map(r=>r.id));if([...current].some(id=>!previousIds.current.has(id)))anchor.current?.scrollIntoView({block:'nearest'});previousIds.current=current;},[ids]);
 const refresh=()=>{state.reload();onRefresh?.();},done=()=>{setEditor(null);refresh();};
 return <>
  {state.error&&<p className="scheduled-inline-error" role="alert">Scheduled messages could not refresh. <button type="button" className="text-button" onClick={state.reload}>Retry</button></p>}
  {rows.map(row=>{
   const parts=conversationParts(row,channel,targetId).filter(p=>threadId===null||row.entries[p.position].request.reply_to===threadId),entry=row.entries[parts[0].position],kind=entry.request.message_kind||'chat',replyTo=entry.request.reply_to;
   const held=parts.some(p=>p.state==='held'),sending=parts.some(p=>p.state==='sending'),batch=row.entries.length>1||row.entries.some(e=>e.channel==='sms'&&e.request.thread_ids?.length>1);
   let title='';if(['poll','rsvp','assignments'].includes(kind)&&row.draft)try{title=JSON.parse(row.draft.body).title;}catch{}
   return <MessageFocus key={row.id} copyText={row.draftError?undefined:title||row.draft?.body} actions={close=><ScheduledActions row={row} onEdit={()=>{close();setEditor({row,action:'edit'});}} onReschedule={()=>{close();setEditor({row,action:'reschedule'});}} onChanged={()=>{close();refresh();}}/>}><article className="message own scheduled-inline" data-schedule-id={row.id} aria-label="Your scheduled message">
    <div className="message-content">
     <div className="scheduled-inline-meta"><Clock size={14}/><strong>{held?'Needs review':sending?'Sending…':'Scheduled'}</strong><span>· Only you</span><time dateTime={new Date(row.send_at).toISOString()}>{scheduleLabel(row.send_at,row.time_zone)}</time></div>
     {!!replyTo&&<div className="scheduled-thread-label"><Reply size={13}/>{onThread?<button type="button" className="text-button" onClick={()=>onThread(replyTo)}>Reply in thread</button>:'Reply in thread'}</div>}
     <div className={`message-bubble scheduled-preview ${entry.request.urgent?'urgent-message':''}`}>
      {!!entry.request.urgent&&<span className="urgent-label"><AlertCircle size={13}/>Urgent</span>}
      {row.draftError?<p>{row.draftError}</p>:title?<div className="scheduled-activity"><img src={activityArtwork[kind]} alt=""/><div><small>{({poll:'Poll',rsvp:'RSVP',assignments:'Assignments'})[kind]}</small><strong>{title}</strong></div></div>:<p><MessageText text={row.draft?.body||''}/></p>}
      {row.draft?.attachments?.map(file=><span className="scheduled-attachment" key={file.id}><Paperclip size={15}/>{file.name}</span>)}
     </div>
     <small className="scheduled-not-sent">Not sent yet{channel==='sms'?' · Phone text':''}</small>
     {parts.filter(p=>p.error).map(p=><p key={p.id} className="error-banner">{p.error}</p>)}
     {batch&&<p className="scheduled-batch-note">Part of a scheduled batch. Editing, rescheduling or cancelling here applies to the whole batch.</p>}
    </div>
   </article></MessageFocus>;
  })}<div ref={anchor}/>
  {editor&&createPortal(<ScheduledEditor row={editor.row} action={editor.action} onClose={()=>setEditor(null)} onSaved={done}/>,document.body)}
 </>;
}
