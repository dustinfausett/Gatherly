import React,{useEffect,useState} from 'react';
import {Field} from './components';
import {api,patch} from './api';
import {normalizeUsername,usernameRules} from '../shared/usernames';
export default function UsernameSettings({user,onAccountUpdate}){
 const [value,setValue]=useState(user.username),[check,setCheck]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 let username='',validation='';try{username=normalizeUsername(value);}catch(e){validation=e.message;}
 useEffect(()=>{
  if(!username||username===user.username){setCheck(null);return;}
  let active=true;const timer=setTimeout(()=>{api(`/me/username?username=${encodeURIComponent(username)}`).then(r=>{if(active)setCheck({username,status:r.available?'available':'taken'});}).catch(e=>{if(active)setCheck({username,status:'error',error:e.message});});},350);
  return()=>{active=false;clearTimeout(timer);};
 },[username,user.username]);
 const status=!username?'invalid':username===user.username?'current':check?.username===username?check.status:'checking',canSave=status==='available'&&!busy;
 async function save(e){e.preventDefault();if(!canSave)return;setBusy(true);setError('');setNotice('');try{const r=await patch('/me/username',{username});setValue(r.user.username);onAccountUpdate(r.user);setNotice(`Your username is now @${r.user.username}.`);}catch(e){setError(e.message);if(e.status===409)setCheck({username,status:'taken'});}finally{setBusy(false);}}
 return <section className="settings-section username-settings"><h4>Change username</h4><p className="small-text muted">Your chats, contacts, family links and Tree/Nest memberships stay connected to your account. People should use your new username to find you.{user.has_password?' Use it the next time you sign in with your password.':''}</p>
  <form className="form" onSubmit={save}><fieldset disabled={busy}><Field label="Username" hint={usernameRules}><input value={value} onChange={e=>{setValue(e.target.value);setError('');setNotice('');}} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required minLength={3} maxLength={30}/></Field></fieldset>
   <p className={`small-text username-availability ${status}`} role="status" aria-live="polite">{status==='current'?'This is your current username.':status==='invalid'?validation:status==='checking'?'Checking availability…':status==='available'?`@${username} is available.`:status==='taken'?'That username is already taken.':check?.error}</p>
   {error&&<p className="error-banner" role="alert">{error}</p>}{notice&&<p className="info-banner" role="status">{notice}</p>}
   <div className="form-footer"><button type="submit" className="button primary" disabled={!canSave}>{busy?'Saving…':'Save username'}</button></div>
  </form>
 </section>;
}
