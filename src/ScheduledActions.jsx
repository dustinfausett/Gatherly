import React,{useState} from 'react';
import {cancelScheduled} from './scheduled-client';
import {activeScheduledPart} from './scheduled-state';

export default function ScheduledActions({row,onEdit,onReschedule,onChanged}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),editable=!row.entries.some(e=>e.channel==='sms')&&row.parts.every(p=>['pending','held'].includes(p.state));
 return <><div className="personal-actions scheduled-actions">
  <button type="button" className="text-button" disabled={!editable||!row.draft||busy} onClick={onEdit}>Edit</button>
  <button type="button" className="text-button" disabled={!editable||!row.draft||busy} onClick={onReschedule}>Reschedule</button>
  <button type="button" className="text-button danger" disabled={busy||row.parts.some(p=>p.state==='sending')||!row.parts.some(activeScheduledPart)} onClick={async()=>{setBusy(true);setError('');try{await cancelScheduled(row);onChanged();}catch(e){setError(e.message);onChanged();}finally{setBusy(false);}}}>Cancel send</button>
 </div>{error&&<p className="error-banner" role="alert">{error}</p>}</>;
}
