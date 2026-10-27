import React,{useEffect,useRef,useState} from 'react';
import {Clock,Paperclip,X} from 'lucide-react';
import {api,post} from './api';
import {Field,Form,Modal} from './components';
import {readScheduled,rebuildScheduled,scheduleLabel} from './scheduled-client';
import {ScheduleFields,initialSchedule} from './ScheduleControls';
import {PollBuilder} from './Polls';
import {RsvpBuilder} from './Rsvps';
import {AssignmentBuilder} from './Assignments';
import {uploadEncrypted} from './encryption/client';
const statusName=row=>row.status==='sent'&&row.entries.every(e=>e.channel==='sms')?'Queued for phone delivery':({scheduled:'Scheduled',needs_review:'Needs review',sending:'Sending',sent:'Sent',cancelled:'Cancelled',partly_sent:'Partly sent'})[row.status];
function preview(draft){if(!draft)return 'Encrypted draft unavailable';try{return JSON.parse(draft.body).title||draft.body;}catch{return draft.body||'Attachments';}}
export default function ScheduledOutbox({version,onClose,onRefresh}){
 const [rows,setRows]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[editor,setEditor]=useState(null),[all,setAll]=useState(false),[busy,setBusy]=useState(false);const cache=useRef(new Map());
 const reload=()=>{setRevision(n=>n+1);onRefresh?.();};
 useEffect(()=>{let active=true;const load=async()=>{try{const result=await api('/scheduled'),opened=await Promise.all(result.sends.map(async row=>{try{const old=cache.current.get(row.id),draft=old?.cipher===row.draft_ciphertext&&old?.sendAt===row.send_at&&old?.entries===JSON.stringify(row.entries)?old.draft:await readScheduled(row);cache.current.set(row.id,{cipher:row.draft_ciphertext,sendAt:row.send_at,entries:JSON.stringify(row.entries),draft});return {...row,draft};}catch(e){return {...row,draftError:e.message};}}));if(active){setRows(opened);setError('');}}catch(e){if(active)setError(e.message);}};load();const timer=setInterval(load,3000);return()=>{active=false;clearInterval(timer);};},[version,revision]);
 const done=()=>{setEditor(null);reload();};
 if(editor){const {row,action}=editor,draft=row.draft,kind=row.entries[0].request.message_kind,group={id:row.entries[0].target_id,name:draft.labels?.[0]||'Nest'};
  if(action==='edit'&&row.entries.length===1&&row.entries[0].channel==='nest'&&['poll','rsvp','assignments'].includes(kind)){
   let initial;try{initial=JSON.parse(draft.body);}catch{initial=null;}
   const Builder=kind==='poll'?PollBuilder:kind==='rsvp'?RsvpBuilder:AssignmentBuilder;
   return <Builder group={group} initialValue={initial} scheduledRecord={row} onSent={reload} onClose={()=>setEditor(null)}/>;
  }
  return <EditScheduled row={row} action={action} onClose={()=>setEditor(null)} onSaved={done}/>;
 }
 const visible=(rows||[]).filter(r=>all||r.parts.some(p=>['pending','held','sending'].includes(p.state))).sort((a,b)=>all?b.send_at-a.send_at:a.send_at-b.send_at);
 return <Modal title="Scheduled messages" subtitle="Your upcoming sends, across Churp." onClose={onClose} wide>
  <p className="small-text muted">Edit, reschedule or cancel before delivery starts. If recipients or encryption keys change, the send waits here for review. Phone texts still need consent at delivery.</p>
  <div className="scheduled-filter"><button className={!all?'selected':''} onClick={()=>setAll(false)}>Upcoming</button><button className={all?'selected':''} onClick={()=>setAll(true)}>All sends</button></div>
  {error&&<p className="error-banner" role="alert">{error}<button className="text-button" onClick={reload}>Retry</button></p>}
  {!rows?<p role="status">Opening your encrypted drafts…</p>:<div className="scheduled-list">{visible.map(row=>{const editable=row.parts.every(p=>['pending','held'].includes(p.state));return <article className="scheduled-card" key={row.id}>
   <span className={`scheduled-status ${row.status}`}>{statusName(row)}</span><h3>{row.draft?.labels?.join(', ')||'Scheduled message'}</h3><small><Clock size={12}/> {scheduleLabel(row.send_at,row.time_zone)} · {row.entries.length} {row.entries.length===1?'send':'separate sends'}</small>
   <p>{row.draftError||preview(row.draft).slice(0,220)}</p>{!!row.draft?.attachments?.length&&<small>{row.draft.attachments.length} attachments</small>}
   {row.parts.filter(p=>p.error).map(p=><p key={p.id} className="error-banner">{p.error}</p>)}
   {row.status==='sent'&&row.entries.some(e=>e.channel==='sms')&&<p className="small-text muted">Phone delivery results are in Messages → Phone texts → Recent text batches.</p>}{row.parts.some(p=>p.state==='sent')&&row.entries.length>1&&<small>{row.parts.filter(p=>p.state==='sent').length} of {row.parts.length} posted</small>}
   <div className="personal-actions"><button className="text-button" disabled={!editable||!row.draft||busy} onClick={()=>setEditor({row,action:'edit'})}>Edit</button><button className="text-button" disabled={!editable||!row.draft||busy} onClick={()=>setEditor({row,action:'reschedule'})}>Reschedule</button><button className="text-button danger" disabled={busy||row.parts.some(p=>p.state==='sending')||!row.parts.some(p=>['pending','held'].includes(p.state))} onClick={async()=>{setBusy(true);setError('');try{await post(`/scheduled/${row.id}/cancel`,{expected_version:row.version});reload();}catch(e){setError(e.message);}finally{setBusy(false);}}}>Cancel send</button></div>
  </article>;})}{!visible.length&&<p className="personal-empty">{all?'No scheduled sends yet.':'No upcoming sends. Use the clock beside Send to plan one.'}</p>}</div>}
 </Modal>;
}
function EditScheduled({row,action,onClose,onSaved}){
 const [body,setBody]=useState(row.draft.body),[files,setFiles]=useState(row.draft.attachments||[]),[when,setWhen]=useState(()=>initialSchedule(row.send_at>Date.now()?row.send_at:Date.now()+3600000)),[uploading,setUploading]=useState(false),[error,setError]=useState('');
 return <Modal title={action==='reschedule'?'Reschedule message':'Edit scheduled message'} onClose={onClose}><Form submit="Save scheduled send" onSubmit={async()=>{if(uploading)throw new Error('Wait for the attachment to finish.');await rebuildScheduled(row,{...row.draft,body,attachments:files},when);onSaved();}}>
  {action==='edit'&&<><Field label="Scheduled message"><textarea rows={5} value={body} onChange={e=>setBody(e.target.value)} maxLength={row.entries.some(e=>e.channel==='sms')?1200:10000}/></Field><div className="scheduled-edit-files">{files.map(f=><div key={f.id}><span>{f.name}</span><button type="button" className="icon-button" aria-label={`Remove ${f.name}`} onClick={()=>setFiles(v=>v.filter(x=>x.id!==f.id))}><X size={16}/></button></div>)}</div>{!row.entries.some(e=>e.channel==='sms')&&<label className="button secondary"><Paperclip size={16}/>{uploading?'Encrypting…':'Add attachments'}<input type="file" className="visually-hidden" multiple disabled={uploading} onChange={async e=>{const selected=[...e.target.files];e.target.value='';setError('');if(files.length+selected.length>5){setError('Choose up to five attachments.');return;}setUploading(true);try{setFiles(v=>[...v]);const added=await Promise.all(selected.map(uploadEncrypted));setFiles(v=>[...v,...added]);}catch(e){setError(e.message);}finally{setUploading(false);}}}/></label>}</>}
  <ScheduleFields value={when} onChange={setWhen} forced/>{error&&<p className="error-banner" role="alert">{error}</p>}
 </Form></Modal>;
}
