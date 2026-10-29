import React,{useState} from 'react';
import {api} from './api';
import {Avatar,Field} from './components';
export default function UsernameContact({onStart}){
 const [username,setUsername]=useState(''),[person,setPerson]=useState(null),[searched,setSearched]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function search(e){e.preventDefault();if(busy)return;setBusy(true);setError('');setPerson(null);setSearched(false);try{const r=await api(`/private/username?username=${encodeURIComponent(username.trim())}`);setPerson(r.person);setSearched(true);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="settings-section"><h4>Find someone by username</h4><p className="small-text muted">Enter their full username, with or without @. You don’t need to share a Tree.</p><form onSubmit={search}><Field label="Churp username"><input disabled={busy} value={username} onChange={e=>{setUsername(e.target.value);setPerson(null);setSearched(false);setError('');}} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={31}/></Field><button className="button secondary" disabled={busy||!username.trim()}>{busy?'Searching…':'Find username'}</button></form>
 {searched&&!person&&<p role="status" className="small-text muted">No available account matches that username.</p>}
 {person&&<div className="personal-contact"><Avatar name={person.name} id={person.avatar_id} portrait={person.avatar_style!=='photo'?person.avatar_choice:undefined}/><div><strong>{person.name}</strong><small>@{person.username}</small>{person.requires_parent_approval&&<p className="small-text muted">A linked parent must approve before private messages can be sent.</p>}</div><button type="button" className="button primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onStart({username:person.username});}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?'Opening…':person.requires_parent_approval?'Request to message':'Add & message'}</button></div>}
 {error&&<p role="alert" className="error-banner">{error}</p>}</section>;
}
