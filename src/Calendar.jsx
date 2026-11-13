import React, {useEffect,useRef,useState} from 'react';
import {api,post,patch} from './api';
import {Modal} from './components';
import {reminderLabel} from './CalendarReminders';
import './calendar.css';
export function CalendarButton({label,onClick}) {return <button type="button" className="icon-button calendar-button" aria-label={label} title={label} onClick={onClick}><img src="/brand/activities/calendar.png" alt="" width="36" height="36"/></button>;}
const del=path=>api(path,{method:'DELETE'});
const localInput=d=>{const v=new Date(d);return new Date(v-v.getTimezoneOffset()*60000).toISOString().slice(0,16);};
function EventForm({event,nests,onSave,onCancel}){
 const [draft,setDraft]=useState(event?{...event,start:localInput(event.start),end:localInput(event.end)}:{group_id:nests[0]?.id||'',title:'',description:'',location:'',start:'',end:'',visibility:'private'}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const field=(name,value)=>setDraft(d=>({...d,[name]:value}));
 return <form className="calendar-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const body={...draft,start:new Date(draft.start).toISOString(),end:new Date(draft.end).toISOString()};if(event)await patch(`/calendar/events/${event.id}`,body);else await post('/calendar/events',body);await onSave();}catch(e){setError(e.message);}finally{setBusy(false);}}}>
 <h3>{event?'Edit event':'New Nest event'}</h3>
 <label>Nest<select aria-label="Event Nest" value={draft.group_id} disabled={!!event} onChange={e=>field('group_id',e.target.value)}>{nests.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
 <label>Title<input required maxLength={160} value={draft.title} onChange={e=>field('title',e.target.value)}/></label>
 <label>Starts<input required type="datetime-local" value={draft.start} onChange={e=>field('start',e.target.value)}/></label>
 <label>Ends<input required type="datetime-local" value={draft.end} onChange={e=>field('end',e.target.value)}/></label>
 <p className="small-text">Times use your device’s local time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
 <label>Location<input maxLength={500} value={draft.location} onChange={e=>field('location',e.target.value)}/></label>
 <label>Description<textarea maxLength={5000} value={draft.description} onChange={e=>field('description',e.target.value)}/></label>
 <label>Visibility<select aria-label="Visibility" value={draft.visibility} onChange={e=>field('visibility',e.target.value)}><option value="private">Private · Nest members only</option><option value="public">Public · everyone in this Tree</option></select></label>
 {error&&<p role="alert">{error}</p>}<div className="calendar-actions"><button className="button primary" disabled={busy}>Save event</button><button className="button secondary" type="button" onClick={onCancel}>Cancel</button></div>
 </form>;
}
function CalendarFilters({data, filters, onChange}) {
  const [expanded, setExpanded] = useState({});
  const selected = n => filters.branches.includes(n.branch_id) || filters.nests.includes(n.id);
  function branchChange(branch, checked) {
    const ids = data.nests.filter(n => n.branch_id === branch.id).map(n => n.id);
    onChange({branches: checked ? [...new Set([...filters.branches,branch.id])] : filters.branches.filter(id => id !== branch.id), nests: checked ? [...new Set([...filters.nests,...ids])] : filters.nests.filter(id => !ids.includes(id))});
  }
  function nestChange(nest, checked) {
    // Expand the old whole-Branch selection before excluding one child.
    const children = data.nests.filter(n => n.branch_id === nest.branch_id), branchSelected = nest.branch_id && filters.branches.includes(nest.branch_id);
    let ids = new Set([...filters.nests,...(branchSelected ? children.map(n => n.id) : [])]);
    if (checked) ids.add(nest.id); else ids.delete(nest.id);
    let branches = filters.branches.filter(id => id !== nest.branch_id);
    if (nest.branch_id && children.length && children.every(n => ids.has(n.id))) branches = [...branches,nest.branch_id];
    onChange({branches,nests:[...ids]});
  }
  const nestRow = nest => <label className="calendar-filter-row calendar-filter-nest" key={nest.id}><input type="checkbox" aria-label={`Show Nest ${nest.name}`} checked={selected(nest)} onChange={e => nestChange(nest,e.target.checked)}/><span>{nest.name}</span></label>;
  return <details className="calendar-filters"><summary>Personal filters · saved automatically</summary>
    <fieldset><legend className="visually-hidden">Calendars to show</legend>
      {data.branches.map(branch => {
        const children = data.nests.filter(n => n.branch_id === branch.id), full = filters.branches.includes(branch.id), partial = !full && children.some(selected);
        return <div className="calendar-filter-folder" key={branch.id}>
          <div className="calendar-filter-row">
            <input type="checkbox" aria-label={`Show Branch ${branch.name}`} checked={full} ref={el => {if (el) el.indeterminate = partial;}} onChange={e => branchChange(branch,e.target.checked)}/>
            <button type="button" className="calendar-folder-toggle" aria-label={`${expanded[branch.id] ? 'Collapse' : 'Expand'} Branch ${branch.name}`} aria-expanded={!!expanded[branch.id]} aria-controls={`calendar-filter-${branch.id}`} onClick={() => setExpanded(v => ({...v,[branch.id]:!v[branch.id]}))}><span aria-hidden="true">{expanded[branch.id] ? '▾' : '▸'}</span><span className="calendar-dot" style={{background:branch.color}}/>{branch.name}</button>
          </div>
          {expanded[branch.id] && <div id={`calendar-filter-${branch.id}`} className="calendar-filter-children">{children.length ? children.map(nestRow) : <p className="small-text muted">No visible Nests in this Branch.</p>}</div>}
        </div>;
      })}
      {data.nests.filter(n => !n.branch_id).map(nestRow)}
    </fieldset>
  </details>;
}
function EventDetails({event, offsets, onBack, onEdit, onDelete, onReload}) {
  const [when,setWhen] = useState(event.reminder ? localInput(event.reminder.remind_at) : ''), [error,setError] = useState(''), [busy,setBusy] = useState(false), [notice,setNotice] = useState('');
  return <div className="calendar-event-details">
    <button type="button" className="text-button" onClick={onBack}>‹ Back to calendar</button>
    <p className="calendar-event-dates">{eventDate(event)}</p>
    <dl><dt>Nest</dt><dd>{event.nest_name}</dd><dt>Visibility</dt><dd>{event.visibility === 'private' ? 'Private · Nest members only' : 'Public · everyone in the Tree'}</dd>{event.location && <><dt>Location</dt><dd>{event.location}</dd></>}{event.description && <><dt>Description</dt><dd className="calendar-description">{event.description}</dd></>}</dl>
    {event.can_manage && <div className="calendar-actions"><button type="button" className="button secondary" onClick={onEdit}>Edit event</button><button type="button" className="text-button danger" onClick={onDelete}>Delete event</button></div>}
    <section className="calendar-event-reminder"><h3>My reminders</h3>
      <p className="small-text muted">Default reminders: {offsets.length ? offsets.map(reminderLabel).join(', ') : 'none'}. Defaults follow your Nest notification settings. Change them in Your corner → Notifications.</p>
      <p className="small-text muted">Add a personal one-time reminder for this event. It follows device notifications and any Nest mute.</p>
      {event.reminder && <p>{event.reminder.sent ? 'Reminder sent' : 'Personal reminder set'}: {new Date(event.reminder.remind_at).toLocaleString()}</p>}
      <form onSubmit={async e => {e.preventDefault();setBusy(true);setError('');setNotice('');try {await api(`/calendar/events/${event.id}/reminder`,{method:'PUT',body:{remind_at:new Date(when).toISOString()}});await onReload();setNotice('Your personal reminder is saved.');} catch(e) {setError(e.message);} finally {setBusy(false);}}}>
        <label>Remind me on<input type="datetime-local" required value={when} min={localInput(Date.now()+60000)} max={localInput(event.start)} onChange={e=>setWhen(e.target.value)}/></label>
        <div className="calendar-actions"><button className="button primary small" disabled={busy || new Date(event.start) <= new Date()}>Save personal reminder</button>{event.reminder && <button type="button" className="text-button" disabled={busy} onClick={async () => {setBusy(true);setError('');try {await del(`/calendar/events/${event.id}/reminder`);await onReload();setWhen('');setNotice('Personal reminder removed.');} catch(e) {setError(e.message);} finally {setBusy(false);}}}>Remove personal reminder</button>}</div>
      </form>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    </section>
  </div>;
}
const eventDate = event => {
  const start = new Date(event.start), end = new Date(event.end);
  const date = start.toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}), time = d => d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  return `${date} · ${time(start)} – ${start.toDateString() === end.toDateString() ? time(end) : end.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`;
};
export default function Calendar({community, scope={type:'tree',id:community.id}, version, onClose, initialEventId=null}) {
  const [data,setData] = useState(null), [filters,setFilters] = useState(null), [error,setError] = useState(''), [form,setForm] = useState(null), [eventId,setEventId] = useState(initialEventId), [subscribing,setSubscribing] = useState(false);
  const [month,setMonth] = useState(() => {const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);}), [day,setDay] = useState(''), [feed,setFeed] = useState(null), [busy,setBusy] = useState(false);
  const current=useRef(true), filterQueue=useRef(Promise.resolve()), subscriptionRequest=useRef(null);
  async function load() {const r=await api(`/calendar/trees/${community.id}`);if(current.current){setData(r);setFilters(f => f || r.filters || {branches:r.branches.map(b=>b.id),nests:r.nests.map(n=>n.id)});}}
  useEffect(() => {current.current=true;load().catch(e=>{if(current.current)setError(e.message);});return()=>{current.current=false;};},[community.id,version]);
  function saveFilters(next) {setFilters(next);setError('');filterQueue.current=filterQueue.current.catch(()=>{}).then(()=>api(`/calendar/trees/${community.id}/filters`,{method:'PUT',body:next})).catch(e=>{if(current.current)setError(`Filters could not be saved: ${e.message}`);});}
  const name=scope.type==='tree'?'Tree':scope.type==='branch'?community.subcommunities?.find(b=>b.id===scope.id)?.name||'Branch':community.circles?.find(n=>n.id===scope.id)?.name||'Nest';
  const back=()=>{setEventId(null);setForm(null);setSubscribing(false);setError('');};
  async function subscribe() {
    setSubscribing(true);setError('');if(feed || subscriptionRequest.current)return;
    setBusy(true);
    subscriptionRequest.current=post(`/calendar/trees/${community.id}/subscriptions`,{scope_type:scope.type,scope_id:scope.id});
    try {const r=await subscriptionRequest.current;if(current.current){setFeed(r);await load();}} catch(e) {if(current.current)setError(e.message);} finally {subscriptionRequest.current=null;if(current.current)setBusy(false);}
  }
  if(!data)return <Modal title={`${name} calendar`} onClose={onClose}><p role={error?'alert':'status'}>{error||'Opening calendar…'}</p></Modal>;
  const nests=data.nests.filter(n=>n.can_post&&(scope.type==='tree'||(scope.type==='nest'?n.id===scope.id:n.branch_id===scope.id)));
  const selectedEvent=data.events.find(e=>e.id===eventId);
  if(subscribing) return <Modal key="subscription" title={`Subscribe to ${name === 'Tree' ? community.name : name} calendar`} onClose={back}>
    <div className="calendar-subscriptions"><button type="button" className="text-button" onClick={back}>‹ Back to calendar</button>
      {busy && <p role="status">Creating your subscription link…</p>}{error && <p role="alert">{error}</p>}
      {feed && <><label>Subscription URL<input readOnly value={feed.url} onFocus={e=>e.target.select()}/></label><a className="button secondary" href={feed.url.replace(/^https?:/,'webcal:')}>Open in Apple Calendar</a><h3>Google Calendar</h3><p>On the Google Calendar website, open Other calendars → + → From URL, then paste this link.</p><h3>Apple Calendar</h3><p>Use the button above, or choose New Calendar Subscription and paste the URL.</p></>}
      {!feed && !busy && <button type="button" className="button secondary" onClick={subscribe}>Create subscription link</button>}
      <p>This is a read-only subscription to this {scope.type === 'nest' ? 'Nest' : scope.type === 'branch' ? 'Branch' : 'Tree'} calendar. Your calendar provider controls its refresh schedule. Keep the URL private: anyone with it can read the events available to you.</p>
      <p>Subscriptions follow current event privacy and membership. Revoking a link stops future updates; previously downloaded events may remain in your calendar app. Personal display filters do not change subscriptions.</p>
      {data.subscriptions.filter(s=>s.scope_type===scope.type&&s.scope_id===scope.id).map((s,i)=><div className="calendar-actions" key={s.id}><span>Subscription {i+1}</span><button type="button" className="text-button danger" onClick={async()=>{try{await del(`/calendar/subscriptions/${s.id}`);if(feed?.id===s.id)setFeed(null);await load();}catch(e){setError(e.message);}}}>Revoke subscription</button></div>)}
    </div>
  </Modal>;
  if(form) return <Modal key={`form-${form.id||'new'}`} title={form.id?'Edit event':'New event'} onClose={()=>setForm(null)}><EventForm event={form.id?form:null} nests={nests} onCancel={()=>setForm(null)} onSave={async()=>{await load();setForm(null);}}/></Modal>;
  if(eventId) return <Modal key={`event-${eventId}`} title={selectedEvent?.title||'Event unavailable'} onClose={back} wide>
    {error && <p role="alert">{error}</p>}
    {selectedEvent ? <EventDetails event={selectedEvent} offsets={data.notification_offsets||[]} onBack={back} onReload={load} onEdit={()=>setForm(selectedEvent)} onDelete={async()=>{if(!window.confirm('Delete this calendar event?'))return;try{await del(`/calendar/events/${selectedEvent.id}`);await load();back();}catch(e){setError(e.message);}}}/> : <><p>This event was removed or is no longer available to you.</p><button className="text-button" onClick={back}>Back to calendar</button></>}
  </Modal>;
  const events=data.events.filter(e=>scope.type==='nest'?e.group_id===scope.id:scope.type==='branch'?e.branch_id===scope.id:filters.branches.includes(e.branch_id)||filters.nests.includes(e.group_id));
  const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const monthEnd=new Date(month.getFullYear(),month.getMonth()+1,1), monthEvents=events.filter(e=>new Date(e.start)<monthEnd&&new Date(e.end)>month);
  const cells=Array.from({length:Math.ceil((month.getDay()+new Date(month.getFullYear(),month.getMonth()+1,0).getDate())/7)*7},(_,i)=>new Date(month.getFullYear(),month.getMonth(),i-month.getDay()+1));
  const listed=day?monthEvents.filter(e=>{const begin=new Date(`${day}T00:00`),end=new Date(begin);end.setDate(end.getDate()+1);return new Date(e.start)<end&&new Date(e.end)>begin;}):monthEvents;
  return <Modal key="calendar" title={`${name} calendar`} subtitle={community.name} onClose={onClose} wide><div className="churp-calendar">
    {error && <p role="alert" className="error-banner">{error}</p>}
    <div className="calendar-actions">{!!nests.length&&<button className="button primary" onClick={()=>setForm({})}>New event</button>}<button type="button" className="button secondary" onClick={subscribe}>Subscribe to Calendar</button></div>
    {scope.type==='tree'&&<CalendarFilters data={data} filters={filters} onChange={saveFilters}/>}
    <nav className="calendar-month" aria-label="Calendar month"><button className="button secondary" aria-label="Previous month" onClick={()=>{setMonth(new Date(month.getFullYear(),month.getMonth()-1,1));setDay('');}}>‹</button><h3>{month.toLocaleDateString([],{month:'long',year:'numeric'})}</h3><button className="button secondary" aria-label="Next month" onClick={()=>{setMonth(new Date(month.getFullYear(),month.getMonth()+1,1));setDay('');}}>›</button></nav>
    <div className="calendar-grid">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=><strong key={x}>{x}</strong>)}{cells.map(d=>{const next=new Date(d);next.setDate(next.getDate()+1);const daily=monthEvents.filter(e=>new Date(e.start)<next&&new Date(e.end)>d);return <button type="button" key={dateKey(d)} aria-label={`${d.toLocaleDateString()}: ${daily.length} events`} aria-pressed={day===dateKey(d)} className={d.getMonth()!==month.getMonth()?'outside-month':''} onClick={()=>setDay(v=>v===dateKey(d)?'':dateKey(d))}><span>{d.getDate()}</span><div>{daily.slice(0,3).map(e=><i key={e.id} style={{background:e.color}} title={e.title}/>)}{daily.length>3&&<small>+{daily.length-3}</small>}</div></button>;})}</div>
    <h3>{day?`Events on ${day}`:'This month’s events'}</h3>{!listed.length&&<p>No events match this view.</p>}
    <div className="calendar-event-list">{listed.map(e=><button type="button" className="calendar-event-row" key={e.id} style={{borderLeftColor:e.color}} aria-label={`Open event: ${e.title}`} onClick={()=>setEventId(e.id)}><strong>{e.title}</strong><span>{eventDate(e)}</span></button>)}</div>
  </div></Modal>;
}
