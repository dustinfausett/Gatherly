import React, { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Settings2, Check } from 'lucide-react';
import { Field, Modal } from './components';
import { api, post } from './api';
import { useEncryption } from './encryption/EncryptionGate';
import { sealMessage, signAssignmentRequest } from './encryption/client';
import { readAssignmentList } from './assignmentData';
import { ASSIGNMENT_LIMITS, assignmentSetup, encodeAssignmentOperation, operationMetadata, parseAssignments, validateAssignments, validateAssignmentItem, validateAssignmentSettings } from '../shared/assignments';
import './assignments.css';
const artwork='/brand/assignments/clipboard.png';
const blankItem=()=>({id:crypto.randomUUID(),title:'',notes:'',dueDate:null,assigneeId:null});
const dateLabel=value=>new Date(value+'T12:00:00Z').toLocaleDateString([],{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
function SettingsFields({value,onChange}){
  return <><Field label="List title" value={value.title} onChange={e=>onChange({...value,title:e.target.value})} maxLength={100} placeholder="e.g. Emma’s birthday party" required />
    <Field label="List description (optional)"><textarea rows={2} value={value.description} onChange={e=>onChange({...value,description:e.target.value})} maxLength={2000}/></Field>
    <Field label="List due date (optional)" type="date" value={value.dueDate || ''} onChange={e=>onChange({...value,dueDate:e.target.value || null})}/>
    <label className="assignment-collaboration"><input type="checkbox" checked={value.allowMemberAdds} onChange={e=>onChange({...value,allowMemberAdds:e.target.checked})}/><span><strong>Allow Nest members to add assignments</strong><small>Members can contribute new items later. You and Nest admins can change this at any time.</small></span></label></>;
}
function ItemFields({item,onChange,members,index}){
  const prefix=index ? `Assignment ${index}` : 'Assignment';
  return <><Field label={index ? `Assignment ${index}` : 'What needs doing?'} value={item.title} onChange={e=>onChange({...item,title:e.target.value})} maxLength={240} placeholder="e.g. Pick up the cake" required/>
    <Field label={`${prefix}: assigned to`}><select value={item.assigneeId || ''} onChange={e=>onChange({...item,assigneeId:e.target.value || null})}><option value="">Open to volunteers</option>{item.assigneeId && !members.some(m=>m.id===item.assigneeId) && <option value={item.assigneeId}>Previous member — choose another</option>}{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
    <Field label={`${prefix}: notes (optional)`}><textarea rows={2} maxLength={1000} value={item.notes} onChange={e=>onChange({...item,notes:e.target.value})}/></Field>
    <Field label={`${prefix}: due date (optional)`} type="date" value={item.dueDate || ''} onChange={e=>onChange({...item,dueDate:e.target.value || null})}/></>;
}
export function AssignmentBuilder({group,onClose,onSent}){
  const {enabled}=useEncryption(),[settings,setSettings]=useState({title:'',description:'',dueDate:null,allowMemberAdds:false}),[items,setItems]=useState([blankItem()]);
  const [members,setMembers]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const saving=useRef(false),prepared=useRef(null);
  useEffect(()=>{let current=true;api(`/groups/${group.id}/assignment-members`).then(r=>{if(current){setMembers(r.members);setError('');}}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[group.id,retry]);
  async function submit(e){
    e.preventDefault();if(saving.current || !members)return;setBusy(true);saving.current=true;setError('');
    try{
      const value=validateAssignments({...settings,items}),body=JSON.stringify(value),setup=assignmentSetup(value);
      if(prepared.current?.body!==body){let request=enabled ? await sealMessage(group.id,body,[],null,null,'assignments') : {body};if(enabled)request=await signAssignmentRequest(request,null,setup,'assignment-setup');prepared.current={body,request};}
      await post(`/groups/${group.id}/messages`,{...prepared.current.request,message_kind:'assignments',assignment_setup:setup});await onSent();onClose();
    }catch(e){if(e.status===409)prepared.current=null;setError(e.message);}finally{saving.current=false;setBusy(false);}
  }
  return <Modal title="Create assignment list" subtitle="A shared plan for your Nest." onClose={()=>{if(!saving.current)onClose();}} wide><form className="form assignment-builder" onSubmit={submit}>
    <fieldset disabled={busy || !members}><SettingsFields value={settings} onChange={setSettings}/>{items.map((item,index)=><section className="assignment-item-editor" key={item.id}><div className="assignment-editor-heading"><h3>Assignment {index+1}</h3>{items.length>1 && <button className="icon-button" type="button" aria-label={`Remove assignment ${index+1}`} onClick={()=>setItems(prev=>prev.filter(i=>i.id!==item.id))}><Trash2 size={17}/></button>}</div><ItemFields item={item} members={members || []} index={index+1} onChange={next=>setItems(prev=>prev.map(i=>i.id===item.id?next:i))}/></section>)}{items.length<ASSIGNMENT_LIMITS.initialItems && <button className="button secondary" type="button" onClick={()=>setItems(prev=>[...prev,blankItem()])}><Plus size={17}/>Add assignment</button>}</fieldset>
    {!members && !error && <p role="status">Loading Nest members…</p>}{error && <div className="error-banner" role="alert">{error}{!members && <button type="button" className="text-button" onClick={()=>setRetry(n=>n+1)}>Try again</button>}</div>}
    <p className="poll-help">Each item has one responsible person. Members can claim open items and complete their own assignments. Completed items move below unfinished ones.</p>
    <div className="form-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy || !members}>{busy?'Sharing…':'Share assignments'}</button></div>
  </form></Modal>;
}
function AssignmentEditor({editor,data,user,busy,error,onClose,onSave}){
  const [settings,setSettings]=useState(()=>({title:data.title,description:data.description,dueDate:data.dueDate,allowMemberAdds:data.allowMemberAdds})),[item,setItem]=useState(()=>editor.item || blankItem());
  const members=data.can_manage ? data.eligible : data.eligible.filter(m=>m.id===user.id);
  return <Modal title={editor.kind==='settings'?'List settings':editor.kind==='add'?'Add assignment':'Edit assignment'} onClose={onClose} wide><form className="form assignment-editor" onSubmit={e=>{e.preventDefault();onSave(editor.kind==='settings'?settings:item);}}><fieldset disabled={busy}>{editor.kind==='settings'?<SettingsFields value={settings} onChange={setSettings}/>:<ItemFields item={item} members={members} onChange={setItem}/>}</fieldset>{error && <div className="error-banner" role="alert">{error}</div>}<div className="form-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy?'Saving…':editor.kind==='add'?'Add assignment':'Save changes'}</button></div></form></Modal>;
}
export function AssignmentDialog({message,group,user,version,onClose}){
  const {enabled}=useEncryption(),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editor,setEditor]=useState(null),[confirm,setConfirm]=useState(null);
  const saving=useRef(false),prepared=useRef(null),active=useRef(true);
  const read=()=>readAssignmentList(group.id,message.id,enabled);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>{let current=true;read().then(r=>{if(current)setData(r);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[message.id,version]);
  async function change(operation,baseVersion=data.revision){
    if(saving.current)return false;saving.current=true;setBusy(true);setError('');
    try{
      const op={...operation,expectedVersion:baseVersion},metadata=operationMetadata(op),body=encodeAssignmentOperation(message.id,op),key=JSON.stringify([metadata,body]);
      if(prepared.current?.key!==key){let request;if(enabled){const rs=await api(`/messages/${message.id}/assignments/roster`);request=await sealMessage(group.id,body,[],message.id,null,'assignment_op',rs);request=await signAssignmentRequest(request,message.id,metadata,'assignment-operation');}else request={body,reply_to:message.id};prepared.current={key,request};}
      await post(`/messages/${message.id}/assignments/operations`,{...prepared.current.request,operation:metadata});prepared.current=null;
      const fresh=await read();if(active.current){setData(fresh);setConfirm(null);}return true;
    }catch(e){if(e.status===409){prepared.current=null;try{const fresh=await read();if(active.current)setData(fresh);}catch{}}if(active.current)setError(e.message);return false;}
    finally{saving.current=false;if(active.current)setBusy(false);}
  }
  async function save(value){
    try{
      const operation=editor.kind==='settings'?{action:'settings',...validateAssignmentSettings(value)}:{action:editor.kind==='add'?'add':'edit',itemId:value.id,assigneeId:value.assigneeId,item:validateAssignmentItem(value)};
      if(await change(operation,editor.revision))setEditor(null);
    }catch(e){setError(e.message);}
  }
  function edit(kind,item){setError('');setEditor({kind,item,revision:data.revision});}
  if(editor)return <AssignmentEditor key={`${editor.kind}:${editor.item?.id || ''}`} editor={editor} data={data} user={user} busy={busy} error={error} onClose={()=>{if(!saving.current){setEditor(null);setError('');}}} onSave={save}/>;
  const initial=parseAssignments(message.body),done=data?.items.filter(i=>i.completed).length || 0;
  return <Modal title={data?.title || initial?.title || 'Assignments'} onClose={onClose} wide><div className="assignment-view">
    {error && <div className="error-banner" role="alert">{error}<button type="button" className="text-button" onClick={()=>read().then(r=>{setData(r);setError('');}).catch(e=>setError(e.message))}>Try again</button></div>}
    {!data?<p role="status">Opening assignments…</p>:<>
      {data.description && <p className="assignment-description">{data.description}</p>}{data.dueDate && <p className="assignment-due">Due {dateLabel(data.dueDate)}</p>}
      <div className="assignment-progress" role="status"><strong>{done} of {data.items.length} assignments complete</strong><progress value={done} max={Math.max(1,data.items.length)} aria-label="Assignments complete"/></div>
      <div className="assignment-list-actions">{(data.can_manage || data.allowMemberAdds) && <button type="button" className="button secondary" disabled={busy || data.items.length>=100} onClick={()=>edit('add')}><Plus size={17}/>Add assignment</button>}{data.can_manage && <button type="button" className="text-button" disabled={busy} onClick={()=>edit('settings')}><Settings2 size={17}/>List settings</button>}</div>
      <p className="poll-help">{data.allowMemberAdds?'Nest members can add assignments to this list.':'Only the creator and Nest admins can add assignments.'}</p>
      <div className="assignment-items">{[...data.items].sort((a,b)=>Number(a.completed)-Number(b.completed)).map(item=>{
        const own=item.assigneeId===user.id,canComplete=data.can_manage || own,assignee=data.eligible.find(m=>m.id===item.assigneeId),due=item.dueDate || data.dueDate;
        return <article className={`assignment-row ${item.completed?'is-complete':''}`} key={item.id} data-assignment-id={item.id}>
          <div className="assignment-row-title"><button type="button" className="assignment-check" aria-label={`${item.completed?'Reopen':'Complete'} assignment: ${item.title}`} aria-pressed={item.completed} disabled={busy || !canComplete} onClick={()=>change({action:'complete',itemId:item.id,completed:!item.completed})}>{item.completed && <Check size={18}/>}</button><div><h3>{item.title}</h3><span className="assignment-owner">{item.assigneeId?`${assignee?.name || 'Previous Nest member'}${own?' (you)':''}`:'Open to volunteers'}</span></div><span className="assignment-state">{item.completed?'Done':'To do'}</span></div>
          {item.notes && <p className="assignment-notes">{item.notes}</p>}{due && <p className="assignment-due">Due {dateLabel(due)}</p>}
          <div className="assignment-row-actions">{!item.assigneeId && !item.completed && <button type="button" className="text-button" disabled={busy} onClick={()=>change({action:'claim',itemId:item.id,assigneeId:user.id})}>I’ll do it</button>}{own && !item.completed && <button type="button" className="text-button" disabled={busy} onClick={()=>change({action:'release',itemId:item.id})}>Release assignment</button>}{data.can_manage && <><button type="button" className="text-button" disabled={busy} aria-label={`Edit assignment: ${item.title}`} onClick={()=>edit('edit',item)}><Pencil size={14}/>Edit</button><button type="button" className="text-button danger" disabled={busy} aria-label={`Remove assignment: ${item.title}`} onClick={()=>setConfirm(item.id)}><Trash2 size={14}/>Remove</button></>}</div>
          {confirm===item.id && <div className="inline-confirm"><span>Remove this assignment?</span><button type="button" disabled={busy} onClick={()=>change({action:'remove',itemId:item.id})}>Remove assignment</button><button type="button" disabled={busy} onClick={()=>setConfirm(null)}>Keep assignment</button></div>}
        </article>;
      })}</div>{!data.items.length && <p className="poll-help">No assignments yet. Add one to get started.</p>}
    </>}
  </div></Modal>;
}
export function AssignmentCard({message,group,user,version,onOpen}){
  const {enabled}=useEncryption(),[data,setData]=useState(null),[open,setOpen]=useState(false),[error,setError]=useState(false);
  useEffect(()=>{let active=true;readAssignmentList(group.id,message.id,enabled,false).then(r=>{if(active){setData(r);setError(false);}}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[message.id,version,enabled]);
  const initial=parseAssignments(message.body),title=data?.title || initial?.title || 'Assignments';
  return <><button type="button" className="assignment-card" aria-label={`Open assignments: ${title}`} aria-haspopup="dialog" onClick={()=>onOpen?onOpen(message):setOpen(true)}><img src={artwork} alt="" width="1254" height="1254"/><span><strong>{title}</strong><small>{data?`${data.items.filter(i=>i.completed).length} of ${data.items.length} assignments complete`:'Shared assignment list'}</small><span>{error?'Open to reload':'Open assignments'}</span></span></button>{open && <AssignmentDialog message={message} group={group} user={user} version={version} onClose={()=>setOpen(false)}/>}</>;
}
