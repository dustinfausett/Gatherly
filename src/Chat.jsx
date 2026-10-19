import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Bell, BellOff, ChevronDown, Download, File, Hash, ImagePlus, Info, LockKeyhole, MessageCircle, MoreHorizontal, Paperclip, Reply, Search, Send, Settings2, ShieldCheck, Smile, Trash2, UserPlus, Users, X } from 'lucide-react';
import { api, patch, post, upload } from './api';
import { Avatar, Empty, formatDay, formatTime } from './components';

function Attachment({ file }) {
  const image = file.mime.startsWith('image/');
  return image ? <a className="image-attachment" href={`/api/files/${file.id}`} target="_blank" rel="noreferrer"><img src={`/api/files/${file.id}`} alt={file.name} loading="lazy" /></a> : <a className="file-attachment" href={`/api/files/${file.id}`} download><span><File size={21} /></span><div><strong>{file.name}</strong><small>{file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</small></div><Download size={17} /></a>;
}
function Message({ message: m, own, admin, onReply, onThread, onDelete, compact = false }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return <article className={`message ${own ? 'own' : ''} ${compact ? 'compact' : ''}`}>
    {!own && <Avatar name={m.name} id={m.avatar_id} size={34} />}
    <div className="message-content"><div className="message-meta"><strong>{own ? 'You' : m.name}</strong><time dateTime={m.created_at}>{formatTime(m.created_at)}</time></div>
      <div className={`message-bubble ${m.deleted ? 'deleted' : ''}`}>
        {m.reply_to && !compact && <button className="reply-preview" onClick={() => onThread(m.reply_to)}><Reply size={13} /><span><strong>{m.parent_name || 'Earlier message'}</strong>{m.parent_body?.slice(0,100) || 'View conversation'}</span></button>}
        {m.deleted ? <p>This message was deleted.</p> : <><p>{m.body}</p>{m.files?.map(f => <Attachment key={f.id} file={f} />)}</>}
      </div>
      {!m.deleted && <div className="message-actions"><button aria-label={`Reply to ${m.name}`} onClick={() => onReply(m)}><Reply size={13} />Reply</button>{!compact && <button onClick={() => onThread(m.reply_to || m.id)}><MessageCircle size={13} />Thread</button>}{(own || admin) && <button className="delete-message" aria-label="Delete message" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /></button>}</div>}
      {confirmDelete && <div className="inline-confirm"><span>Delete this message?</span><button onClick={() => { onDelete(m.id); setConfirmDelete(false); }}>Delete</button><button onClick={() => setConfirmDelete(false)}>Cancel</button></div>}
    </div>
  </article>;
}
function Composer({ group, reply, setReply, onSent, notify, thread = false }) {
  const [body, setBody] = useState(''), [files, setFiles] = useState([]), [uploading, setUploading] = useState(false), [sending, setSending] = useState(false), [emojiOpen, setEmoji] = useState(false);
  const textarea = useRef(), picker = useRef(), imagePicker = useRef();
  useEffect(() => { if (reply) textarea.current?.focus(); }, [reply?.id]);
  async function attach(event) {
    const selected = [...event.target.files]; event.target.value = '';
    if (files.length + selected.length > 5) return notify('Attach up to five files per message.', true);
    setUploading(true);
    try { const results = []; for (const f of selected) results.push(await upload(f)); setFiles(prev => [...prev, ...results]); }
    catch (err) { notify(err.message, true); } finally { setUploading(false); }
  }
  async function send(e) {
    e?.preventDefault(); if (sending || uploading || (!body.trim() && !files.length)) return;
    setSending(true);
    try { await post(`/groups/${group.id}/messages`, { body, files: files.map(f => f.id), reply_to: reply?.reply_to || reply?.id || null }); setBody(''); setFiles([]); if (!thread) setReply(null); await onSent(); textarea.current?.focus(); }
    catch (err) { notify(err.message, true); } finally { setSending(false); }
  }
  return <form className="composer" onSubmit={send}>
    {reply && !thread && <div className="composing-reply"><Reply size={16} /><div>Replying to <strong>{reply.name}</strong><span>{reply.body || 'Attachment'}</span></div><button type="button" className="icon-button" aria-label="Cancel reply" onClick={() => setReply(null)}><X size={16} /></button></div>}
    {!!files.length && <div className="pending-files">{files.map(f => <span key={f.id}><File size={14} />{f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))}><X size={13} /></button></span>)}</div>}
    <textarea ref={textarea} value={body} onChange={e => setBody(e.target.value)} placeholder={thread ? 'Write a reply…' : `Message ${group.name}…`} aria-label={thread ? 'Write a reply' : 'Write a message'} maxLength={10000} rows={2} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
    <div className="composer-toolbar"><div><button className="icon-button" type="button" aria-label="Attach files" title="Attach files (up to 15 MB each)" disabled={uploading || sending} onClick={() => picker.current.click()}><Paperclip size={19} /></button><button className="icon-button" type="button" aria-label="Attach photo" disabled={uploading || sending} onClick={() => imagePicker.current.click()}><ImagePlus size={19} /></button><button className={`icon-button ${emojiOpen ? 'active' : ''}`} type="button" aria-label="Add emoji" aria-expanded={emojiOpen} onClick={() => setEmoji(!emojiOpen)}><Smile size={19} /></button></div>
      <span className="composer-tip">{uploading ? 'Uploading…' : 'Enter to send · Shift + Enter for a new line'}</span><button className="send-button" type="submit" aria-label="Send message" disabled={sending || uploading || (!body.trim() && !files.length)}><Send size={17} />{sending ? 'Sending' : 'Send'}</button>
    </div>
    {emojiOpen && <div className="emoji-picker" role="group" aria-label="Emoji picker">{['😊','❤️','🙌','👍','🎉','😂','🌿','✨','👋','☀️','💬','🤍'].map(emoji => <button type="button" key={emoji} onClick={() => { setBody(prev => prev + emoji); setEmoji(false); textarea.current.focus(); }}>{emoji}</button>)}</div>}
    <input type="file" ref={picker} className="visually-hidden" multiple onChange={attach} /><input type="file" ref={imagePicker} className="visually-hidden" accept="image/*" multiple onChange={attach} />
  </form>;
}
export default function Chat({ community, group, user, version, onRefresh, onModal, notify, onBack }) {
  const [messages, setMessages] = useState([]), [more, setMore] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [reply, setReply] = useState(null), [search, setSearch] = useState(''), [searchOpen, setSearchOpen] = useState(false), [infoOpen, setInfoOpen] = useState(false);
  const [threadId, setThreadId] = useState(null), [threadMessages, setThreadMessages] = useState([]), [threadError, setThreadError] = useState('');
  const scroll = useRef(), bottom = useRef(), lastId = useRef(null), first = useRef(true);
  const subcommunity = community.subcommunities.find(s => s.id === group.subcommunity_id);
  const canPost = group.joined && (!group.admin_only || group.is_admin);
  async function load() {
    const result = await api(`/groups/${group.id}/messages`);
    setMessages(prev => { const merged = new Map(prev.map(m => [m.id,m])); for (const m of result.messages) merged.set(m.id,m); return [...merged.values()].sort((a,b) => a.id - b.id); });
    if (first.current) setMore(result.has_more);
    setError(''); setLoading(false);
    const latest = result.messages.at(-1)?.id;
    if (latest && group.joined) { await patch(`/groups/${group.id}/membership`, { read_to: latest }); if (group.unread) await onRefresh(); }
    return result;
  }
  useEffect(() => {
    let active = true;
    (async () => { try { const result = await api(`/groups/${group.id}/messages`); if (!active) return; setMessages(prev => { const merged = new Map(prev.map(m => [m.id,m])); result.messages.forEach(m => merged.set(m.id,m)); return [...merged.values()].sort((a,b) => a.id-b.id); }); if (first.current) setMore(result.has_more); setLoading(false); setError(''); if (group.joined && document.visibilityState === 'visible' && result.messages.length) { await patch(`/groups/${group.id}/membership`, { read_to: result.messages.at(-1).id }); if (group.unread) await onRefresh(); } } catch (err) { if (active) { setError(err.message); setLoading(false); } } })();
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
    if (!threadId) return;
    let active = true;
    api(`/groups/${group.id}/threads/${threadId}`).then(r => { if (active) { setThreadMessages(r.messages); setThreadError(''); } }).catch(e => { if (active) setThreadError(e.message); });
    return () => { active = false; };
  }, [threadId, version, messages]);
  async function older() {
    try {
      const height = scroll.current.scrollHeight;
      const result = await api(`/groups/${group.id}/messages?before=${messages[0].id}`);
      setMessages(prev => [...result.messages, ...prev]); setMore(result.has_more);
      requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight - height; });
    } catch (err) { notify(err.message, true); }
  }
  async function changeMembership(action) { try { await action(); await onRefresh(); } catch (err) { notify(err.message, true); } }
  async function deleteMessage(id) { try { await api(`/messages/${id}`, { method: 'DELETE' }); await load(); } catch (err) { notify(err.message, true); } }
  const filtered = messages.filter(m => !search || m.body.toLowerCase().includes(search.toLowerCase()) || m.name.toLowerCase().includes(search.toLowerCase()));
  const messageProps = { admin: group.is_admin, onReply: m => { if (!canPost) return notify(group.joined ? 'Only admins can post in this Group.' : 'Join this Group to reply.', true); setReply(m); }, onThread: id => { setThreadId(id); setInfoOpen(false); }, onDelete: deleteMessage };
  return <div className="chat-layout"><section className="chat-panel">
    <header className="chat-header"><button className="icon-button mobile-only" onClick={onBack} aria-label="Back to Groups"><ArrowLeft size={21} /></button><Avatar name={group.name} id={group.avatar_id} size={43} square /><div className="chat-heading"><div className="breadcrumb">{community.name}<span>/</span>{subcommunity?.name}</div><h1>{group.private ? <LockKeyhole size={18} /> : <Hash size={20} />}{group.name}{group.admin_only ? <span className="tag">Announcements</span> : null}</h1></div><div className="chat-header-actions"><button className={`icon-button ${searchOpen ? 'active' : ''}`} aria-label="Search messages" onClick={() => { setSearchOpen(!searchOpen); setSearch(''); }}><Search size={19} /></button>{group.joined && <button className="icon-button" aria-label={group.muted ? 'Unmute Group' : 'Mute Group'} onClick={() => changeMembership(() => patch(`/groups/${group.id}/membership`, { muted: !group.muted }))}>{group.muted ? <BellOff size={19} /> : <Bell size={19} />}</button>}<span className="header-divider" /><button className={`icon-button ${infoOpen ? 'active' : ''}`} aria-label="Group information" onClick={() => { setInfoOpen(!infoOpen); setThreadId(null); }}><Info size={20} /></button></div></header>
    {searchOpen && <div className="chat-search"><Search size={17} /><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search loaded messages or people…" aria-label="Search loaded messages" /><span>{search ? `${filtered.length} found` : 'Load earlier messages to search more'}</span><button className="icon-button" aria-label="Close search" onClick={() => { setSearchOpen(false); setSearch(''); }}><X size={17} /></button></div>}
    <div className="conversation" ref={scroll}>
      {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={() => load().catch(e => notify(e.message,true))}>Try again</button></div>}
      {loading ? <div className="loading-messages">Getting the conversation ready…</div> : <>
        {!more && <div className="conversation-start"><span className="conversation-start-icon">{group.private ? <LockKeyhole size={25} /> : <MessageCircle size={27} />}</span><h2>A good place to talk.</h2><p>This is the beginning of <strong>{group.name}</strong>.{group.description ? ` ${group.description}` : ' Make yourself at home.'}</p><span><ShieldCheck size={13} />{group.private ? 'A private space, by invitation.' : 'A space for your Community.'}</span></div>}
        {more && <button className="load-earlier" onClick={older}>Load earlier messages</button>}
        {filtered.map((m,index) => { const day = formatDay(m.created_at), previous = filtered[index-1]; return <React.Fragment key={m.id}>{(!previous || formatDay(previous.created_at) !== day) && <div className="date-divider"><span>{day}</span></div>}<Message message={m} own={m.user_id === user.id} {...messageProps} /></React.Fragment>; })}
        {!!search && !filtered.length && <Empty icon={Search} title="Nothing here just yet.">Try a different name or phrase.</Empty>}
      </>}<div ref={bottom} />
    </div>
    <div className="chat-bottom"><div className="group-status"><span className={group.private ? 'status-private' : 'status-public'}>{group.private ? <LockKeyhole size={12} /> : <span className="tiny-dot" />}{group.private ? 'Private Group' : 'Public Group'}</span><span>{group.member_count} {group.member_count === 1 ? 'member' : 'members'}{group.muted ? ' · Notifications muted' : ''}</span><button onClick={() => bottom.current?.scrollIntoView({ behavior: 'smooth' })} aria-label="Jump to latest message"><ArrowDown size={14} /></button></div>
      {canPost ? <Composer group={group} reply={reply} setReply={setReply} onSent={async () => { await load(); await onRefresh(); }} notify={notify} /> : !group.joined ? <div className="join-group-banner"><div><strong>There’s room for you here.</strong><p>Join to send messages and stay in the loop.</p></div><button className="button primary" onClick={() => changeMembership(() => post(`/groups/${group.id}/join`))}><UserPlus size={17} />Join Group</button></div> : <div className="read-only"><ShieldCheck size={19} /><span>Only admins can post and reply in this Group.<small>You’ll still receive updates unless you mute the Group.</small></span></div>}
      <div className="conversation-footnote"><span className="tiny-leaf">❧</span> A little kindness goes a long way.</div>
    </div>
  </section>
    {infoOpen && <aside className="detail-panel"><div className="detail-header"><h3>About this Group</h3><button className="icon-button" aria-label="Close Group information" onClick={() => setInfoOpen(false)}><X size={18} /></button></div><div className="group-detail"><Avatar name={group.name} id={group.avatar_id} size={76} square /><h2>{group.name}</h2><span className="tag">{group.private ? 'Private Group' : 'Public Group'}</span><p>{group.description || 'A little space for your Community to connect.'}</p></div><div className="detail-facts"><span><Users size={17} />{group.member_count} members</span><span><Hash size={17} />{subcommunity?.name}</span><span><ShieldCheck size={17} />{group.admin_only ? 'Admins can post and reply' : 'Joined members can post and reply'}</span></div><div className="detail-actions">{group.is_admin && <><button onClick={() => onModal({ kind: 'invite', group })}><UserPlus size={17} />Invite to Group</button><button onClick={() => onModal({ kind: 'space', type: 'group', entity: group })}><Settings2 size={17} />Group settings</button></>}{group.joined && <><button onClick={() => changeMembership(() => patch(`/groups/${group.id}/membership`, { muted: !group.muted }))}>{group.muted ? <Bell size={17} /> : <BellOff size={17} />}{group.muted ? 'Unmute notifications' : 'Mute notifications'}</button><button className="danger" onClick={() => changeMembership(() => api(`/groups/${group.id}/join`, { method: 'DELETE' }))}>Leave Group</button></>}</div></aside>}
    {threadId && <aside className="detail-panel thread-panel"><div className="detail-header"><h3>Thread</h3><button className="icon-button" aria-label="Close thread" onClick={() => setThreadId(null)}><X size={18} /></button></div><div className="thread-messages">{threadError && <div className="error-banner">{threadError}</div>}{threadMessages.map(m => <Message key={m.id} message={m} own={m.user_id === user.id} compact {...messageProps} onReply={() => {}} />)}{!threadMessages.length && !threadError && <p className="muted">Loading thread…</p>}</div>{canPost && !!threadMessages.length && !threadMessages[0].deleted && <Composer key={threadId} group={group} reply={threadMessages[0]} setReply={() => {}} thread notify={notify} onSent={load} />}</aside>}
  </div>;
}
