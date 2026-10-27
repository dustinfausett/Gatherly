import React,{useState} from 'react';
import {Clock} from 'lucide-react';
import {createPortal} from 'react-dom';
import {Field,Form,Modal} from './components';
import {localDate,queueScheduled,scheduleLabel,scheduleZone} from './scheduled-client';
import './scheduling.css';
export const openScheduled=()=>window.dispatchEvent(new Event('churp-open-scheduled'));
export const initialSchedule=(time=null)=>({enabled:!!time,sendAt:localDate(time||Date.now()+3600000),requestId:crypto.randomUUID()});
export function ScheduleFields({value,onChange,forced=false}){return <div className="schedule-fields">{!forced&&<label className="schedule-toggle"><input type="checkbox" checked={value.enabled} onChange={e=>onChange({...value,enabled:e.target.checked})}/><Clock size={16}/><span>Schedule send</span></label>}{(forced||value.enabled)&&<><Field label="Send date and time" type="datetime-local" value={value.sendAt} onChange={e=>onChange({...value,enabled:true,sendAt:e.target.value})} min={localDate(Date.now()+60000)} required/><p className="small-text muted">{scheduleZone()} · Churp sends while the app is closed. If the server is temporarily offline, it sends after service resumes.</p></>}</div>;}
export function ScheduleButton({prepare,onScheduled,disabled=false}){
 const [open,setOpen]=useState(false),[when,setWhen]=useState(()=>initialSchedule());
 return <><button type="button" className="icon-button schedule-send-button" title="Schedule send" aria-label="Schedule send" disabled={disabled} onClick={()=>{setWhen(initialSchedule(Date.now()+3600000));setOpen(true);}}><Clock size={19}/></button>{open&&createPortal(<div onSubmit={e=>e.stopPropagation()}><Modal title="Schedule send" onClose={()=>setOpen(false)}><Form submit="Schedule message" onSubmit={async()=>{const {entries,draft}=await prepare();await queueScheduled(entries,draft,when);setOpen(false);await onScheduled?.();}}><ScheduleFields value={when} onChange={setWhen} forced/><p className="small-text muted">Your scheduled message will appear faded in this conversation. You can edit, reschedule or cancel it there, or in Your corner → Scheduled messages.</p></Form><button className="text-button" onClick={()=>{setOpen(false);openScheduled();}}>View scheduled messages</button></Modal></div>,document.body)}</>;
}
export function ScheduledMessagesButton(){return <button type="button" className="text-button scheduled-open-button" onClick={openScheduled}><Clock size={16}/>Scheduled messages</button>;}
export function ScheduleSummary({value}){return value.enabled?<p className="info-banner"><Clock size={16}/>Scheduled for {scheduleLabel(new Date(value.sendAt))}</p>:null;}
