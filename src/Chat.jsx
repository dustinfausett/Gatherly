import { Bird, LandingNest } from './BirdJourney';
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowLeft, Bell, BellOff, Download, File, ImagePlus, Info, MessageCircle, Paperclip, Pencil, Plus, Reply, Search, Send, Settings2, ShieldCheck, Smile, Trash2, UserPlus, Users, X } from 'lucide-react';
import { PollBuilder, PollDialog, PollCard, messagePreview } from './Polls';
import { RsvpBuilder, RsvpDialog, RsvpEnvelope } from './Rsvps';
import { AssignmentBuilder, AssignmentCard, AssignmentDialog } from './Assignments';
import SharedLibrary from './SharedLibrary';
import MessageEditor from './MessageEditor';
import SpaceIcon from './SpaceIcon';
import { useEncryption } from './encryption/EncryptionGate';
import { attachmentUrl, uploadEncrypted, sealMessage, decryptMessages, convertHistory } from './encryption/client';
import NestEncryptionDetails from './encryption/NestEncryptionDetails';
import PrivacyShield from './encryption/PrivacyShield';
import { api, patch, post, upload } from './api';
import { Avatar, Empty, formatDay, formatTime } from './components';

function Attachment({ file }) {
  const {enabled}=useEncryption();const [url,setUrl]=useState(null),[error,setError]=useState('');
  useEffect(()=>{if(!enabled)return;let active=true,created;
    attachmentUrl(file).then(value=>{created=value;if(active)setUrl(value);else URL.revokeObjectURL(value);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;if(created)URL.revokeObjectURL(created);};
  },[enabled,file.id,file.key]);
  const image = file.mime.startsWith('image/');
  if(enabled && !url)return <span className={error ? 'attachment-error' : 'attachment-loading'}>{error || 'Decrypting attachment…'}</span>;
  return image ? <a className="image-attachment" href={enabled ? url : `/api/files/${file.id}`} target="_blank" rel="noreferrer"><img src={enabled ? url : `/api/files/${file.id}`} alt={file.name} loading="lazy" /></a> : <a className="file-attachment" href={enabled ? url : `/api/files/${file.id}`} download={enabled ? file.name : true}><span><File size={21} /></span><div><strong>{file.name}</strong><small>{file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</small></div><Download size={17} /></a>;
}
function Message({ message: m, own, admin, onReply, onThread, onDelete, onUrgency, onEdit, group, user, version, compact = false }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return <article className={`message ${own ? 'own' : ''} ${compact ? 'compact' : ''}`}>
    {!own && <Avatar name={m.name} id={m.avatar_id} birdId={m.avatar_style === 'bird' ? m.bird_id : undefined} size={34} />}
    <div className="message-content"><div className="message-meta"><strong>{own ? 'You' : m.name}</strong><time dateTime={m.created_at}>{formatTime(m.created_at)}</time>{m.edited_at && !m.deleted && <small className="message-edited" title={`Edited ${new Date(m.edited_at).toLocaleString()}`}>edited</small>}{!!m.self_encrypted && !m.migrated && !m.decryptionError && !m.deleted && <span className="message-protection" title="All recipients used self-managed keys for this version of the message.">{m.edited_at ? 'E2EE when edited' : 'E2EE when sent'}</span>}{m.migrated && <small className="migrated-history-label" title="This earlier message was originally stored readable. An existing reader converted it; it does not carry a retroactive signature from its original author.">Converted by {m.signer_name || 'an existing reader'}</small>}</div>
      <div className={`message-bubble ${['poll','rsvp','assignments'].includes(m.message_kind) && !m.deleted && !m.decryptionError ? 'poll-message' : ''} ${m.decryptionError ? 'decryption-failed' : ''} ${m.deleted ? 'deleted' : ''} ${m.urgent && !m.deleted ? 'urgent-message' : ''}`}>
        {m.reply_to && !compact && <button className="reply-preview" onClick={() => onThread(m.reply_to)}><Reply size={13} /><span><strong>{m.parent_name || 'Earlier message'}</strong>{m.parent_body?.slice(0,100) || 'View conversation'}</span></button>}
        {!!m.urgent && !m.deleted && <span className="urgent-label"><AlertCircle size={13} />Urgent</span>}{m.deleted ? <p>This message was deleted.</p> : m.message_kind === 'poll' && !m.decryptionError ? <PollCard message={m} group={group} user={user} version={version} /> : m.message_kind === 'rsvp' && !m.decryptionError ? <RsvpEnvelope message={m} group={group} user={user} version={version} /> : m.message_kind === 'assignments' && !m.decryptionError ? <AssignmentCard message={m} group={group} user={user} version={version} /> : <><p>{m.body}</p>{m.files?.map(f => <Attachment key={f.id} file={f} />)}</>}
      </div>
      {!m.deleted && !m.decryptionError && <div className="message-actions"><button aria-label={`Reply to ${m.name}`} onClick={() => onReply(m)}><Reply size={13} />Reply</button>{!compact && <button onClick={() => onThread(m.reply_to || m.id)}><MessageCircle size={13} />Thread</button>}{own && onEdit && (m.message_kind || 'chat') === 'chat' && <button aria-label="Edit message" onClick={() => onEdit(m)}><Pencil size={13} />Edit</button>}{(own || admin) && onUrgency && <button aria-label={m.urgent ? 'Remove urgency' : 'Mark message urgent'} aria-pressed={!!m.urgent} onClick={() => onUrgency(m)}><AlertCircle size={13} />{m.urgent ? 'Remove urgency' : 'Urgent'}</button>}{(own || admin) && <button className="delete-message" aria-label="Delete message" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /></button>}</div>}
      {confirmDelete && <div className="inline-confirm"><span>Delete this message?</span><button onClick={() => { onDelete(m.id); setConfirmDelete(false); }}>Delete</button><button onClick={() => setConfirmDelete(false)}>Cancel</button></div>}
    </div>
  </article>;
}
function Composer({ group, reply, setReply, onSent, notify, thread = false }) {
  const {enabled}=useEncryption();const prepared=useRef(null);
  const [body, setBody] = useState(''), [files, setFiles] = useState([]), [uploading, setUploading] = useState(false), [sending, setSending] = useState(false), [emojiOpen, setEmoji] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [addOpen, setAddOpen] = useState(false), [pollOpen, setPollOpen] = useState(false), [rsvpOpen, setRsvpOpen] = useState(false), [assignmentsOpen, setAssignmentsOpen] = useState(false);
  const addMenu = useRef(null), addButton = useRef(null);
  useEffect(() => {
    if (!addOpen) return;
    const outside = event => { if (!addMenu.current?.contains(event.target)) setAddOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setAddOpen(false); addButton.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [addOpen]);
  const textarea = useRef(), picker = useRef(), imagePicker = useRef();
  useEffect(() => { if (reply) textarea.current?.focus(); }, [reply?.id]);
  async function attach(event) {
    const selected = [...event.target.files]; event.target.value = '';
    if (files.length + selected.length > 5) return notify('Attach up to five files per message.', true);
    setUploading(true);
    try { const results = []; for (const f of selected) results.push(await (enabled ? uploadEncrypted(f) : upload(f))); setFiles(prev => [...prev, ...results]); }
    catch (err) { notify(err.message, true); } finally { setUploading(false); }
  }
  async function send(e) {
    e?.preventDefault(); if (sending || uploading || (!body.trim() && !files.length)) return;
    setSending(true);
    try {
      const replyTo=reply?.reply_to || reply?.id || null,key=JSON.stringify([body,files.map(f=>f.id),replyTo]);
      let request;
      if(enabled){if(prepared.current?.key!==key)prepared.current={key,request:await sealMessage(group.id,body,files,replyTo)};request={...prepared.current.request,urgent};}
      else request={body,files:files.map(f=>f.id),urgent,reply_to:replyTo};
      await post(`/groups/${group.id}/messages`,request);prepared.current=null;setBody(''); setFiles([]); setUrgent(false); if (!thread) setReply(null); await onSent(); textarea.current?.focus(); }
    catch (err) { if(err.status===409)prepared.current=null;notify(err.message, true); } finally { setSending(false); }
  }
  return <><form className="composer" onSubmit={send}>
    {urgent && <div className="urgent-draft"><AlertCircle size={14} />This message will be marked urgent.</div>}
    {reply && !thread && <div className="composing-reply"><Reply size={16} /><div>Replying to <strong>{reply.name}</strong><span>{messagePreview(reply) || 'Attachment'}</span></div><button type="button" className="icon-button" aria-label="Cancel reply" onClick={() => setReply(null)}><X size={16} /></button></div>}
    {!!files.length && <div className="pending-files">{files.map(f => <span key={f.id}><File size={14} />{f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))}><X size={13} /></button></span>)}</div>}
    <textarea ref={textarea} value={body} onChange={e => setBody(e.target.value)} placeholder={thread ? 'Write a reply…' : `Message ${group.name}…`} aria-label={thread ? 'Write a reply' : 'Write a message'} maxLength={10000} rows={2} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
    <div className="composer-toolbar"><div><span className="composer-add" ref={addMenu}><button className="icon-button" ref={addButton} type="button" aria-label="Add to chat" aria-expanded={addOpen} disabled={uploading || sending} onClick={() => setAddOpen(!addOpen)}><Plus size={20} /></button>{addOpen && <div className="composer-add-menu" role="group" aria-label="Add to chat options">{!thread && <button type="button" onClick={() => { setAddOpen(false); setPollOpen(true); }}><img src="/brand/polls/ballot.png" alt="" />Poll</button>}{!thread && <button type="button" onClick={() => { setAddOpen(false); setRsvpOpen(true); }}><img src="/brand/polls/envelope.png" alt="" />RSVP</button>}{!thread && <button type="button" onClick={() => { setAddOpen(false); setAssignmentsOpen(true); }}><img src="/brand/assignments/clipboard.png" alt="" />Assignments</button>}<button type="button" onClick={() => { setAddOpen(false); imagePicker.current.click(); }}><ImagePlus size={19} />Photo</button><button type="button" onClick={() => { setAddOpen(false); picker.current.click(); }}><Paperclip size={19} />File</button></div>}</span><button className={`icon-button ${emojiOpen ? 'active' : ''}`} type="button" aria-label="Add emoji" aria-expanded={emojiOpen} onClick={() => setEmoji(!emojiOpen)}><Smile size={19} /></button></div>
      <button className={`icon-button urgency-toggle ${urgent ? 'active' : ''}`} type="button" aria-label="Mark as urgent" aria-pressed={urgent} title="Mark as urgent" onClick={() => setUrgent(!urgent)}><AlertCircle size={19} /></button><span className="composer-tip">{uploading ? 'Uploading…' : 'Enter to send · Shift + Enter for a new line'}</span><button className="send-button" type="submit" aria-label="Send message" disabled={sending || uploading || (!body.trim() && !files.length)}><Send size={17} />{sending ? 'Sending' : 'Send'}</button>
    </div>
    {emojiOpen && <div className="emoji-picker" role="group" aria-label="Emoji picker">{['😊','❤️','🙌','👍','🎉','😂','🌿','✨','👋','☀️','💬','🤍'].map(emoji => <button type="button" key={emoji} onClick={() => { setBody(prev => prev + emoji); setEmoji(false); textarea.current.focus(); }}>{emoji}</button>)}</div>}
    <input type="file" ref={picker} className="visually-hidden" multiple onChange={attach} /><input type="file" ref={imagePicker} className="visually-hidden" accept="image/*" multiple onChange={attach} />
  </form>{pollOpen && <PollBuilder group={group} onClose={() => setPollOpen(false)} onSent={onSent} />}{rsvpOpen && <RsvpBuilder group={group} onClose={() => setRsvpOpen(false)} onSent={onSent} />}{assignmentsOpen && <AssignmentBuilder group={group} onClose={() => setAssignmentsOpen(false)} onSent={onSent} />}</>;
}
export default function Chat({ community, group, user, version, onRefresh, onModal, notify, onBack }) {
  const {enabled}=useEncryption();
  const [migration,setMigration]=useState({checked:false,pending:0,busy:false,error:''}),[migrationRetry,setMigrationRetry]=useState(0);
  useEffect(()=>{
    if(!enabled || !group.joined || (migration.checked && !migration.pending))return;let active=true;
    setMigration(prev=>({...prev,busy:true}));
    convertHistory(group.id).then(result=>{if(active){setMigration({checked:true,pending:result.pending,busy:false,error:''});if(result.converted)onRefresh();}}).catch(e=>{if(active)setMigration({checked:true,pending:1,busy:false,error:e.message});});
    return()=>{active=false;};
  },[enabled,group.id,group.joined,version,migrationRetry]);
  async function readMessages(path){const result=await api(path);return {...result,messages:enabled ? await decryptMessages(group.id,result.messages) : result.messages};}

  const [messages, setMessages] = useState([]), [more, setMore] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [reply, setReply] = useState(null), [search, setSearch] = useState(''), [searchOpen, setSearchOpen] = useState(false), [infoOpen, setInfoOpen] = useState(false);
  const [threadId, setThreadId] = useState(null), [threadMessages, setThreadMessages] = useState([]), [threadError, setThreadError] = useState('');
  const [sharedOpen, setSharedOpen] = useState(false), [sharedPoll, setSharedPoll] = useState(null), [sharedRsvp, setSharedRsvp] = useState(null), [sharedAssignments, setSharedAssignments] = useState(null);
  const [editingMessage,setEditingMessage]=useState(null);
  const scroll = useRef(), bottom = useRef(), lastId = useRef(null), first = useRef(true);
  const subcommunity = community.subcommunities.find(s => s.id === group.subcommunity_id);
  const canPost = group.joined && (!group.admin_only || group.is_admin);
  async function load() {
    const result = await readMessages(`/groups/${group.id}/messages`);
    setMessages(prev => { const merged = new Map(prev.map(m => [m.id,m])); for (const m of result.messages) merged.set(m.id,m); return [...merged.values()].sort((a,b) => a.id - b.id); });
    if (first.current) setMore(result.has_more);
    setError(''); setLoading(false);
    const latest = result.messages.at(-1)?.id;
    if (group.joined && !result.messages.some(m=>m.decryptionError) && document.visibilityState === 'visible') { await patch(`/groups/${group.id}/membership`, { read_to: latest || 0 }); if (group.unread || group.marked_unread) await onRefresh(); }
    return result;
  }
  useEffect(() => {
    let active = true;
    if(enabled && !group.joined){setMessages([]);setLoading(false);setError('');return;}
    (async () => { try { const result = await readMessages(`/groups/${group.id}/messages`); if (!active) return; setMessages(prev => { const merged = new Map(prev.map(m => [m.id,m])); result.messages.forEach(m => merged.set(m.id,m)); return [...merged.values()].sort((a,b) => a.id-b.id); }); if (first.current) setMore(result.has_more); setLoading(false); setError(''); if (group.joined && !result.messages.some(m=>m.decryptionError) && document.visibilityState === 'visible') { await patch(`/groups/${group.id}/membership`, { read_to: result.messages.at(-1)?.id || 0 }); if (group.unread || group.marked_unread) await onRefresh(); } } catch (err) { if (active) { setError(err.message); setLoading(false); } } })();
    return () => { active = false; };
  }, [group.id, version, group.joined]);
  useEffect(() => {
    const latest = messages.at(-1)?.id;
    if (latest && latest !== lastId.current) {
      const box = scroll.current;
      if (first.current || messages.at(-1).user_id === user.id || (box && box.scrollHeight - box.scrollTop - box.clientHeight < 350)) bottom.current?.scrollIntoView({ behavior: first.current ? 'instant' : 'smooth' });
      lastId.current = latest; first.current = false;
    }
  }, [messages]);
  useEffect(() => {
    if (!threadId || (enabled && !group.joined)) return;
    let active = true;
    readMessages(`/groups/${group.id}/threads/${threadId}`).then(r => { if (active) { setThreadMessages(r.messages); setThreadError(''); } }).catch(e => { if (active) setThreadError(e.message); });
    return () => { active = false; };
  }, [threadId, version, messages]);
  async function older() {
    try {
      const height = scroll.current.scrollHeight;
      const result = await readMessages(`/groups/${group.id}/messages?before=${messages[0].id}`);
      setMessages(prev => [...result.messages, ...prev]); setMore(result.has_more);
      requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight - height; });
    } catch (err) { notify(err.message, true); }
  }
  async function changeMembership(action) { try { await action(); await onRefresh(); } catch (err) { notify(err.message, true); } }
  async function deleteMessage(id) { try { await api(`/messages/${id}`, { method: 'DELETE' }); await load(); } catch (err) { notify(err.message, true); } }
  const filtered = messages.filter(m => !search || (messagePreview(m) || '').toLowerCase().includes(search.toLowerCase()) || m.name.toLowerCase().includes(search.toLowerCase()));
  const messageProps = { group, user, version, onEdit:canPost ? setEditingMessage : null, admin: group.is_admin, onReply: m => { if (!canPost) return notify(group.joined ? 'Only admins can post in this Nest.' : 'Join this Nest to reply.', true); setReply(m); }, onThread: id => { setThreadId(id); setInfoOpen(false); }, onDelete: deleteMessage, onUrgency: canPost ? async m => { try { await patch(`/messages/${m.id}`, { urgent: !m.urgent }); await load(); await onRefresh(); } catch (err) { notify(err.message, true); } } : null };
  return <div className="chat-layout"><section className="chat-panel">
    <header className="chat-header"><button className="icon-button mobile-only" onClick={onBack} aria-label="Back to Nests"><ArrowLeft size={21} /></button><Avatar name={group.name} id={group.avatar_id} size={43} square /><div className="chat-heading"><div className="breadcrumb">{community.name}{subcommunity && <><span>/</span>{subcommunity.name}</>}</div><h1 tabIndex={-1}><SpaceIcon size={23} locked={!!group.private}/>{group.name}<PrivacyShield active={group.self_encrypted} size={18}/>{group.admin_only ? <span className="tag">Announcements</span> : null}</h1></div><button type="button" className="chat-landing-nest" data-bird-landing aria-label="Open shared items" aria-haspopup="dialog" disabled={!group.joined} onClick={() => setSharedOpen(true)}><span className="landing-nest-scene"><Bird className="resident-bird" birdId={user.bird_id}/><LandingNest/></span></button><div className="chat-header-actions"><button className={`icon-button ${searchOpen ? 'active' : ''}`} aria-label="Search messages" onClick={() => { setSearchOpen(!searchOpen); setSearch(''); }}><Search size={19} /></button>{group.joined && <button className="icon-button" aria-label={group.muted ? 'Unmute Nest' : 'Mute Nest'} onClick={() => changeMembership(() => patch(`/groups/${group.id}/membership`, { muted: !group.muted }))}>{group.muted ? <BellOff size={19} /> : <Bell size={19} />}</button>}<span className="header-divider" /><button className={`icon-button ${infoOpen ? 'active' : ''}`} aria-label="Nest information" onClick={() => { setInfoOpen(!infoOpen); setThreadId(null); }}><Info size={20} /></button></div></header>
    {searchOpen && <div className="chat-search"><Search size={17} /><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search loaded messages or people…" aria-label="Search loaded messages" /><span>{search ? `${filtered.length} found` : 'Load earlier messages to search more'}</span><button className="icon-button" aria-label="Close search" onClick={() => { setSearchOpen(false); setSearch(''); }}><X size={17} /></button></div>}
    <div className="conversation" ref={scroll}>
      {enabled && group.joined && migration.pending>0 && <div className="encryption-history-note" role="status"><strong>Earlier history is awaiting encryption.</strong><p>{migration.error || 'Earlier server-stored history has not finished converting. Some readers may need to set up encrypted messaging. Retry to continue conversion and cleanup. New messages are encrypted.'}</p><button className="text-button" disabled={migration.busy} onClick={()=>setMigrationRetry(n=>n+1)}>{migration.busy ? 'Converting…' : 'Retry history conversion'}</button></div>}
      {enabled && !group.joined && <div className="encryption-history-note">Join this Nest to receive messages from that point onward. Earlier messages are not shared with new members.</div>}

      {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={() => load().catch(e => notify(e.message,true))}>Try again</button></div>}
      {loading ? <div className="loading-messages">Getting the conversation ready…</div> : <>
        {!more && <div className="conversation-start"><span className="conversation-start-icon"><SpaceIcon size={30} locked={!!group.private}/></span><h2>A good place to talk.</h2><p>This is the beginning of <strong>{group.name}</strong>.{group.description ? ` ${group.description}` : ' Make yourself at home.'}</p><span>{group.private ? 'A private space, by invitation.' : 'A space for your Tree.'}</span></div>}
        {more && <button className="load-earlier" onClick={older}>Load earlier messages</button>}
        {filtered.map((m,index) => { const day = formatDay(m.created_at), previous = filtered[index-1]; return <React.Fragment key={m.id}>{(!previous || formatDay(previous.created_at) !== day) && <div className="date-divider"><span>{day}</span></div>}<Message message={{...m,parent_body:messagePreview(messages.find(p=>p.id===m.reply_to && !p.decryptionError)) || m.parent_body,parent_name:messages.find(p=>p.id===m.reply_to)?.name || m.parent_name}} own={m.user_id === user.id} {...messageProps} /></React.Fragment>; })}
        {!!search && !filtered.length && <Empty icon={Search} title="Nothing here just yet.">Try a different name or phrase.</Empty>}
      </>}<div ref={bottom} />
    </div>
    <div className="chat-bottom">{enabled && <div className="encrypted-status" role="status" aria-live="polite"><PrivacyShield active={group.self_encrypted}/>{group.self_encrypted ? 'New messages are end-to-end encrypted' : 'Encrypted · Churp-managed keys in this Nest'}</div>}<div className="group-status"><span className={group.private ? 'status-private' : 'status-public'}><SpaceIcon size={16} locked={!!group.private}/>{group.private ? 'Private Nest' : 'Public Nest'}</span><span>{group.member_count} {group.member_count === 1 ? 'member' : 'members'}{group.muted ? ' · Notifications muted' : ''}</span><button onClick={() => bottom.current?.scrollIntoView({ behavior: 'smooth' })} aria-label="Jump to latest message"><ArrowDown size={14} /></button></div>
      {canPost ? <Composer group={group} reply={reply} setReply={setReply} onSent={async () => { await load(); await onRefresh(); }} notify={notify} /> : !group.joined ? <div className="join-group-banner"><div><strong>There’s room for you here.</strong><p>Join to send messages and stay in the loop.</p></div><button className="button primary" onClick={() => changeMembership(() => post(`/groups/${group.id}/join`))}><UserPlus size={17} />Join Nest</button></div> : <div className="read-only"><ShieldCheck size={19} /><span>Only admins can post and reply in this Nest.<small>You’ll still receive updates unless you mute the Nest.</small></span></div>}
      <div className="conversation-footnote"><span className="tiny-leaf">❧</span> A little kindness goes a long way.</div>
    </div>
  </section>
    {editingMessage && <MessageEditor message={editingMessage} onClose={() => setEditingMessage(null)} onSaved={async () => { await load(); await onRefresh(); }} />}
    {sharedOpen && <SharedLibrary group={group} user={user} version={version} onClose={() => setSharedOpen(false)} onOpenPoll={setSharedPoll} onOpenRsvp={setSharedRsvp} onOpenAssignments={setSharedAssignments} suspended={!!sharedPoll || !!sharedRsvp || !!sharedAssignments} />}
    {sharedPoll && <PollDialog message={sharedPoll} group={group} user={user} version={version} onClose={() => setSharedPoll(null)} />}
    {sharedRsvp && <RsvpDialog message={sharedRsvp} group={group} user={user} version={version} onClose={() => setSharedRsvp(null)} />}
    {sharedAssignments && <AssignmentDialog message={sharedAssignments} group={group} user={user} version={version} onClose={() => setSharedAssignments(null)} />}
    {infoOpen && <aside className="detail-panel"><div className="detail-header"><h3>About this Nest</h3><button className="icon-button" aria-label="Close Nest information" onClick={() => setInfoOpen(false)}><X size={18} /></button></div><div className="group-detail"><Avatar name={group.name} id={group.avatar_id} size={76} square /><h2>{group.name}</h2><span className="tag">{group.private ? 'Private Nest' : 'Public Nest'}</span><p>{group.description || 'A little space for your Tree to connect.'}</p></div><div className="detail-facts"><span><Users size={17} />{group.member_count} members</span><span><SpaceIcon kind={subcommunity ? 'branch' : 'tree'}/>{subcommunity?.name || community.name}</span><span><ShieldCheck size={17} />{group.admin_only ? 'Admins can post and reply' : 'Joined members can post and reply'}</span></div><div className="detail-actions">{enabled && group.joined && <NestEncryptionDetails groupId={group.id}/>} {group.is_admin && <><button onClick={() => onModal({ kind: 'invite', group })}><UserPlus size={17} />Invite to Nest</button><button onClick={() => onModal({ kind: 'space', type: 'group', entity: group })}><Settings2 size={17} />Nest settings</button></>}{group.joined && <><button onClick={() => changeMembership(() => patch(`/groups/${group.id}/membership`, { muted: !group.muted }))}>{group.muted ? <Bell size={17} /> : <BellOff size={17} />}{group.muted ? 'Unmute notifications' : 'Mute notifications'}</button><button className="danger" onClick={() => changeMembership(() => api(`/groups/${group.id}/join`, { method: 'DELETE' }))}>Leave Nest</button></>}</div></aside>}
    {threadId && <aside className="detail-panel thread-panel"><div className="detail-header"><h3>Thread</h3><button className="icon-button" aria-label="Close thread" onClick={() => setThreadId(null)}><X size={18} /></button></div><div className="thread-messages">{threadError && <div className="error-banner">{threadError}</div>}{threadMessages.map(m => <Message key={m.id} message={m} own={m.user_id === user.id} compact {...messageProps} onReply={() => {}} />)}{!threadMessages.length && !threadError && <p className="muted">Loading thread…</p>}</div>{canPost && !!threadMessages.length && !threadMessages[0].deleted && (!enabled || threadMessages[0].id===threadId) && <Composer key={threadId} group={group} reply={threadMessages[0]} setReply={() => {}} thread notify={notify} onSent={load} />}</aside>}
  </div>;
}
