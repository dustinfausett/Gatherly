import MessageFocus from './MessageFocus';
import MessageReactions,{ReactionsProvider} from './MessageReactions';
import MessageText from './MessageText';
import React,{useEffect,useState} from 'react';
import {ArrowLeft,ShieldCheck,Users} from 'lucide-react';
import {api,post} from './api';
import {FamilyAlertAvatar} from './FamilyAlert';
import {Field,Form,Logo,formatTime} from './components';
import {decryptPrivate,shareGuardianHistory,approvePrivateRequest} from './encryption/client';
import {PrivateAttachment} from './PrivateMessages';
import './family.css';

function useFamily(active=true){
  const [data,setData]=useState(null),[error,setError]=useState('');
  async function refresh(){try{setData(await api('/family'));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{if(!active)return;refresh();const timer=setInterval(refresh,4000);return()=>clearInterval(timer);},[active]);
  return {data,error,refresh};
}
export function FamilyGate({user,onUser,onLogout,children}) {
  const required=!!user.family?.needs_setup;
  const {data,error,refresh}=useFamily(required),[busy,setBusy]=useState(false),[migrationError,setMigrationError]=useState(''),[remaining,setRemaining]=useState(null);
  useEffect(()=>{if(required&&data&&!data.status.needs_setup)api('/me').then(r=>onUser(r.user)).catch(()=>{});},[required,data?.status.needs_setup]);
  if(!required)return children;
  const status=data?.status||user.family;
  return <main className="encryption-gate family-gate"><section className="encryption-panel"><Logo/><FamilyAlertAvatar user={{...user,family:status}} size={64}/><span className="eyebrow">ACCOUNT PROTECTION</span>
    <h1>{!status.age_recorded?'A little about you':'Link your parent account'}</h1>
    {!status.age_recorded?<Form submit="Save date of birth" onSubmit={async form=>{const r=await post('/family/birth-date',{birth_date:form.get('birth_date')});onUser(r.user);await refresh();}}><p>Your date of birth stays private. People under 18 need at least one linked parent before continuing.</p><Field label="Date of birth" name="birth_date" type="date" autoComplete="bday" max={new Date().toISOString().slice(0,10)} required/><p className="small-text muted">Enter your correct date. It cannot be changed from account settings.</p></Form>:<>
      <p>A linked parent can read your direct messages and attachments with anyone, including earlier messages. They review first messages before new private conversations open. This does not give them access to your Nest conversations.</p>
      <FamilyLinks data={data} onRefresh={refresh} youth userId={user.id}/>
      {status.parent_count>0&&status.history_remaining>0&&<section className="family-card"><h2>Prepare earlier direct messages</h2><p>Share encrypted access to your earlier direct messages with your linked parents. Your account keys and Nest conversations stay separate.</p><button className="button primary" disabled={busy} onClick={async()=>{setBusy(true);setMigrationError('');try{await shareGuardianHistory(setRemaining);await refresh();onUser((await api('/me')).user);}catch(e){setMigrationError(e.message);}finally{setBusy(false);}}}>{busy?'Preparing message history…':'Prepare messages & continue'}</button>{remaining!==null&&busy&&<p role="status">{remaining} message access updates remaining</p>}</section>}
    </>}
    {(error||migrationError)&&<p className="error-banner" role="alert">{error||migrationError}</p>}
    <button className="text-button" onClick={onLogout}>Sign out</button>
  </section></main>;
}
function FamilyLinks({data,onRefresh,youth,userId}){
  if(!data)return <p role="status">Loading family accounts…</p>;
  const mine=data.links.filter(l=>youth?l.child_id===userId&&l.child_protected:l.parent_id===userId);
  return <>
    {mine.map(l=><div className="family-card" key={l.id}><strong>{youth?l.parent_name:l.child_name}</strong><span>@{youth?l.parent_username:l.child_username}</span><p>{!l.child_protected?'18 or older · parental access has ended':l.status==='active'?'Parent linked':'Awaiting parent confirmation'}</p>
      {!youth&&l.status==='pending'&&l.child_protected&&<Form submit="Confirm parent link" onSubmit={async form=>{await post(`/family/links/${l.id}/confirm`,{confirm_parent:form.get('confirm_parent')==='on'});await onRefresh();}}><label className="family-consent"><input type="checkbox" name="confirm_parent" required/>I am this person’s parent or legal guardian. I understand I will be able to read their direct messages.</label></Form>}
      {(!youth||l.status==='pending')&&<button className="text-button danger" onClick={async()=>{if(!window.confirm(l.status==='active'?'Remove your parent link? If this is the last parent, the child must link another parent before continuing.':'Cancel this family link?'))return;try{await api(`/family/links/${l.id}`,{method:'DELETE'});await onRefresh();}catch(e){window.alert(e.message);}}}>Remove link</button>}
    </div>)}
    {youth&&mine.length<2&&<Form submit="Link parent" onSubmit={async form=>{await post('/family/claim',{code:form.get('code')});await onRefresh();}}><p>Ask a parent to sign in to their own account and open <strong>Your corner → Family & youth protection</strong>. Enter the code they create, then ask them to confirm your account.</p><Field label="Parent invitation code" name="code" autoComplete="off" required maxLength={30}/></Form>}
    {youth&&<p className="small-text muted">One parent is required; a second is optional. Either linked parent can approve for your family. Youth-to-youth conversations require approval from a parent in each family. You cannot remove an active parent link yourself. Parent access ends when you turn 18.</p>}
  </>;
}
export function FamilySettings({user}){
  const {data,error,refresh}=useFamily(),[code,setCode]=useState(''),[child,setChild]=useState(null),[actionError,setActionError]=useState('');
  async function act(fn){setActionError('');try{await fn();await refresh();}catch(e){setActionError(e.message);}}
  if(child)return <ParentMessages user={user} child={child} onBack={()=>setChild(null)}/>;
  const youth=!!user.family?.protected;
  return <section className="family-settings"><p className="settings-intro">{youth?'Your parents help protect your direct messages.':'Link up to two parent accounts to each child. Either parent can approve for their child and review direct messages. Youth-to-youth conversations need a parent from each family.'} Nest access follows its existing membership rules.</p>
    {!youth&&<div className="family-card"><h3>Link a child’s account</h3><p>Create a code for your child to enter, then confirm the account below. A code verifies control of the accounts; it does not independently verify age or the family relationship.</p><button className="button secondary" onClick={()=>act(async()=>setCode((await post('/family/codes')).code))}>Create parent invitation code</button>{code&&<><output className="family-code">{code}</output><p className="small-text muted">Single use · expires in 24 hours. A new code replaces your previous code.</p></>}</div>}
    <FamilyLinks data={data} onRefresh={refresh} youth={youth} userId={user.id}/>
    {!youth&&data?.links.filter(l=>l.status==='active'&&l.parent_id===user.id&&l.child_protected).map(l=><button key={l.id} className="button secondary family-review" onClick={()=>setChild({id:l.child_id,name:l.child_name})}><Users size={18}/>View {l.child_name}’s direct messages</button>)}
    <h3>Message requests</h3>{data&&!data.approvals.length&&<p className="muted">No message requests.</p>}
    {data?.approvals.map(a=><div className="family-card" key={`${a.child_id}:${a.adult_id}`}><strong>{a.adult_name} · @{a.adult_username}</strong><p>{youth?'Your direct messages':`Direct messages with ${a.child_name}`} · {a.status}</p>{!youth&&<button className="button secondary small" onClick={()=>setChild({id:a.child_id,name:a.child_name,initialPeer:a.adult_id})}>Review conversation</button>}</div>)}
    {(error||actionError)&&<p className="error-banner" role="alert">{error||actionError}</p>}
    <p className="small-text muted">Parents can review, block and remove content, but cannot send messages as their child. This applies only while the child is under 18 and the link is active. Previously downloaded messages cannot be taken back.</p>
  </section>;
}
function ParentMessages({child,user,onBack}){
  const [list,setList]=useState([]),[cid,setCid]=useState(null),[messages,setMessages]=useState([]),[error,setError]=useState(''),[more,setMore]=useState(false),[cursor,setCursor]=useState(null),[revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;const load=()=>api(`/family/children/${child.id}/conversations`).then(r=>{if(active){setList(r.conversations);setError('');}}).catch(e=>{if(active){setList([]);setMessages([]);setError(e.message);}});load();const timer=setInterval(load,4000);return()=>{active=false;clearInterval(timer);};},[child.id,revision]);
  useEffect(()=>{setMessages([]);setCursor(null);},[cid]);
  useEffect(()=>{if(!cid)return;let active=true;const load=async()=>{try{const r=await api(`/private/conversations/${cid}/messages?child_id=${child.id}${cursor?`&before=${cursor}`:''}`),plain=await decryptPrivate(cid,r.messages);if(active){setMessages(old=>cursor?[...plain,...old]:plain);setMore(r.more);setError('');}}catch(e){if(active){setMessages([]);setError(e.message);}}};load();const timer=cursor?null:setInterval(load,4000);return()=>{active=false;clearInterval(timer);};},[cid,child.id,cursor,list.length,revision]);
  useEffect(()=>{if(child.initialPeer&&!cid){const found=list.find(c=>c.peer_id===child.initialPeer);if(found)setCid(found.id);}},[child.initialPeer,list.length]);
  const current=list.find(c=>c.id===cid);
  async function action(fn){try{setError('');await fn();setRevision(n=>n+1);}catch(e){setError(e.message);}}
  return <ReactionsProvider key={cid||'none'} channel="private" messages={messages} user={user} version={user} canReact={false} childId={child.id}><div className="family-message-review"><button className="text-button" onClick={cid?()=>setCid(null):onBack}><ArrowLeft size={17}/>{cid?'Back to conversations':'Back to family settings'}</button><h3>{child.name}’s direct messages</h3><p className="info-banner"><ShieldCheck size={17}/>Parent-supervised. You can approve, block or remove content, but cannot send messages here. Viewing does not mark messages as read for your child.</p>{error&&<p className="error-banner" role="alert">{error}</p>}
    {cid&&current&&<div className="button-row">{current.own_approval&&current.own_approval!=='approved'&&<button className="button primary" disabled={!messages.length} onClick={()=>action(()=>approvePrivateRequest(child.id,current.peer_id))}>Approve conversation</button>}<button className="button secondary" onClick={()=>action(async()=>{if(current.parent_blocked&&current.own_approval&&current.own_approval!=='approved')await approvePrivateRequest(child.id,current.peer_id);await post(`/family/conversations/${cid}/block`,{child_id:child.id,blocked:!current.parent_blocked});})}>{current.parent_blocked?'Unblock conversation':'Block conversation'}</button></div>}
    {!cid?<>{!list.length&&<p>No direct conversations.</p>}{list.map(c=><button className="family-conversation" key={c.id} onClick={()=>setCid(c.id)}>{child.name} and {c.name}</button>)}</>:<>{more&&messages.length>0&&<button className="text-button" onClick={()=>setCursor(messages[0].id)}>Load earlier messages</button>}{!messages.length&&<p>No shared messages yet. Earlier messages become available when your child completes setup.</p>}{messages.map(m=><MessageFocus key={m.id} disabled={!!m.decryptionError} copyText={m.body} actions={close=>!m.removed_by&&<button type="button" className="text-button danger" onClick={()=>action(async()=>{await post(`/family/messages/${m.id}/remove`,{child_id:child.id});close();})}>Remove from conversation</button>}><div className={`private-message-item ${m.user_id===child.id?'own':''}`}><article className={`private-bubble ${m.user_id===child.id?'own':''}`}><strong>{m.user_id===child.id?child.name:list.find(c=>c.id===cid)?.name}</strong><p><MessageText text={m.body}/></p>{m.files.map(f=><PrivateAttachment key={f.id} file={f}/>)}<small>{formatTime(m.created_at)}</small>{m.removed_by&&<small>Removed from participants · retained for parent review</small>}</article><MessageReactions message={m}/></div></MessageFocus>)}</>}
  </div></ReactionsProvider>;
}
