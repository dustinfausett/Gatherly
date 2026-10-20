import React, { useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, Bell, BellOff, CheckCheck, ChevronDown, Compass, LockKeyhole, MessageCircle, MoreHorizontal, Pin, PinOff, Plus, Search, Settings2, Sprout } from 'lucide-react';
import { api, patch } from './api';
import { Avatar, Empty, Modal } from './components';

const unread = circle => circle.unread > 0 || circle.marked_unread;
const alphabetic = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);

function CircleRow({ circle: c, groupName, onOpen, onOptions, onChange }) {
  const [offset, setOffset] = useState(0), [revealed, setRevealed] = useState(false), [busy, setBusy] = useState(false);
  const gesture = useRef(null), suppressClick = useRef(false);
  async function markUnread() {
    setBusy(true);
    try { await onChange(c, { marked_unread: true }); } finally { setBusy(false); }
  }
  return <div className={`circle-row ${unread(c) ? 'is-unread' : ''} ${c.urgent_unread > 0 ? 'is-urgent' : ''}`} data-circle-id={c.id} data-unread={unread(c)} data-urgent={c.urgent_unread > 0}>
    <div className="swipe-unread" aria-hidden="true"><MessageCircle size={20} />Unread</div>
    <button className="swipe-options" tabIndex={revealed ? 0 : -1} aria-hidden={!revealed} onClick={() => { setRevealed(false); onOptions(c); }}>Options</button>
    <div className={`circle-row-content ${busy ? 'busy' : ''}`} style={{ transform: `translateX(${offset || (revealed ? -90 : 0)}px)` }}
      onPointerDown={e => {
        if (e.button !== 0) return;
        suppressClick.current = false;
        gesture.current = { x: e.clientX, y: e.clientY, dx: 0, swiping: false, vertical: false };
      }}
      onPointerMove={e => {
        const g = gesture.current; if (!g || g.vertical) return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (!g.swiping && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { g.vertical = true; return; }
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          if (!g.swiping) e.currentTarget.setPointerCapture(e.pointerId);
          g.swiping = true; g.dx = dx; suppressClick.current = true;
          setOffset(Math.max(-100, Math.min(c.joined ? 100 : 0, dx)));
        }
      }}
      onPointerUp={e => {
        const g = gesture.current; gesture.current = null; setOffset(0);
        if (!g?.swiping) return;
        e.preventDefault();
        if (g.dx > 64 && c.joined && !busy) { setRevealed(false); markUnread(); }
        else setRevealed(g.dx < -64);
      }}
      onPointerCancel={() => { gesture.current = null; setOffset(0); }}
      onClickCapture={e => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; } }}>
      <button className="circle-open" aria-label={`Open Circle ${c.name}`} onClick={() => { if (revealed) setRevealed(false); else onOpen(c.id); }}>
        <Avatar name={c.name} id={c.avatar_id} size={46} square />
        <span className="circle-copy"><span className="circle-name">{c.name}{!!c.private && <LockKeyhole size={13} aria-label="Private Circle" />}{c.pin_position !== null && <Pin size={13} aria-label="Pinned" />}</span>
          <span className="circle-preview">{c.urgent_unread > 0 && <span className="urgent-label"><AlertCircle size={13} />Urgent · </span>}{c.description || 'A little room for conversation.'}</span>
          <span className="circle-location">{groupName || 'Community Circle'}{!c.joined ? ' · Join to chat' : ''}</span>
        </span>
        {unread(c) && <span className="circle-unread-count" aria-label={`${c.unread || ''} unread messages`}>{c.unread > 99 ? '99+' : c.unread || '•'}</span>}
      </button>
      {c.joined && <button data-row-control className={`circle-mute ${c.muted ? 'muted' : ''}`} aria-label={`${c.muted ? 'Unmute' : 'Mute'} ${c.name}`} aria-pressed={c.muted} disabled={busy} title={c.muted ? 'Unmute notifications' : 'Mute notifications'} onClick={async () => { setBusy(true); try { await onChange(c, { muted: !c.muted }); } finally { setBusy(false); } }}>{c.muted ? <BellOff size={19} /> : <Bell size={19} />}</button>}
      <button data-row-control className="circle-more" aria-label={`Options for ${c.name}`} title="Circle options" onClick={() => onOptions(c)}><MoreHorizontal size={21} /></button>
    </div>
  </div>;
}

export default function CommunityHome({ community: c, user, filter, setFilter, search, onModal, onCircle, onRefresh, notify }) {
  const [localSearch, setSearch] = useState(''), [collapsed, setCollapsed] = useState({}), [optionsId, setOptionsId] = useState(null), [busy, setBusy] = useState(false), [confirmLeave, setConfirmLeave] = useState(false);
  const query = (localSearch || search).trim().toLowerCase();
  const matches = circle => !query || circle.name.toLowerCase().includes(query);
  const joined = c.circles.filter(g => g.joined);
  const pinned = joined.filter(g => g.pin_position !== null).sort((a,b) => a.pin_position - b.pin_position || alphabetic(a,b));
  const others = joined.filter(g => g.pin_position === null).sort((a,b) => Number(unread(b)) - Number(unread(a)) || alphabetic(a,b));
  const options = c.circles.find(g => g.id === optionsId);
  const parent = id => c.subcommunities.find(s => s.id === id);
  const canCreate = c.is_admin || c.subcommunities.some(s => s.is_admin);
  async function change(circle, body) {
    try { await patch(`/groups/${circle.id}/membership`, body); await onRefresh(); return true; }
    catch (err) { notify(err.message, true); return false; }
  }
  function showOptions(circle) { setOptionsId(circle.id); setConfirmLeave(false); }
  async function action(body) {
    if (busy) return;
    setBusy(true);
    try { if (await change(options, body)) setOptionsId(null); } finally { setBusy(false); }
  }
  const rows = circles => circles.filter(matches).map(circle => <CircleRow key={circle.id} circle={circle} groupName={parent(circle.subcommunity_id)?.name} onOpen={onCircle} onOptions={showOptions} onChange={change} />);
  const createCircle = p => onModal({ kind: 'space', type: 'group', parent: p || (!c.is_admin ? c.subcommunities.find(s => s.is_admin) : undefined) });
  return <div className="community-home circle-home">
    <header className="home-titlebar"><div><span className="eyebrow">YOUR COMMUNITY</span><h1>{c.name}</h1><p className="home-greeting">Good to see you, {user.name.split(' ')[0]}.</p></div>{c.is_admin && <button className="icon-button" aria-label="Community settings" onClick={() => onModal({ kind: 'space', type: 'community', entity: c })}><Settings2 size={20} /></button>}</header>
    <div className="circle-home-toolbar"><label className="circle-search"><Search size={18} /><input aria-label="Search Circles" placeholder="Search Circles…" value={localSearch} onChange={e => setSearch(e.target.value)} /></label>{canCreate && <button className="button primary" onClick={() => createCircle()}><Plus size={17} />New Circle</button>}</div>
    <div className="home-tabs"><button className={filter === 'joined' ? 'active' : ''} onClick={() => setFilter('joined')}>Your Circles <span>{joined.length}</span></button><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Discover <Compass size={14} /></button></div>
    {filter === 'joined' ? <>
      {!!pinned.filter(matches).length && <section className="circle-section pinned-circles" aria-label="Pinned Circles"><h2><Pin size={15} />Pinned<span>Your order · change in Options</span></h2><div className="circle-list">{rows(pinned)}</div></section>}
      {!!others.filter(matches).length && <section className="circle-section joined-circles" aria-label="Other joined Circles"><h2><MessageCircle size={16} />Your Circles<span>Unread first · then A–Z</span></h2><div className="circle-list">{rows(others)}</div></section>}
      {!joined.some(matches) && <Empty icon={query ? Search : MessageCircle} title={query ? 'No Circles found.' : 'Your next conversation is waiting.'}>{query ? 'Try another Circle name.' : 'Discover a Circle to join, or create one for your people.'}</Empty>}
      {!joined.length && <button className="button secondary" onClick={() => setFilter('all')}>Discover Circles</button>}
    </> : <div className="discover-circles">
      {!!c.circles.filter(g => !g.subcommunity_id && matches(g)).length && <section className="circle-section"><h2>Community Circles<span>No Group needed</span></h2><div className="circle-list">{rows(c.circles.filter(g => !g.subcommunity_id).sort(alphabetic))}</div></section>}
      <div className="discover-heading"><h2>Groups <span>Optional collections of Circles</span></h2>{c.is_admin && <button className="text-button" onClick={() => onModal({ kind: 'space', type: 'subcommunity' })}><Plus size={16} />New Group</button>}</div>
      {c.subcommunities.map(s => {
        const circles = s.groups.filter(matches).sort(alphabetic);
        if (query && !circles.length) return null;
        const closed = !query && collapsed[s.id];
        return <section className="discovery-group" key={s.id}><div className="discovery-group-header"><button className="discovery-group-toggle" aria-expanded={!closed} onClick={() => setCollapsed(prev => ({ ...prev, [s.id]: !prev[s.id] }))}><ChevronDown size={17} className={closed ? 'collapsed' : ''} /><Avatar name={s.name} id={s.avatar_id} size={34} square /><span><strong>{s.name}</strong><small>{s.description || `${s.groups.length} Circles`}</small></span></button>{s.is_admin && <><button className="icon-button" aria-label={`Edit Group ${s.name}`} onClick={() => onModal({ kind: 'space', type: 'subcommunity', entity: s })}><Settings2 size={17} /></button><button className="icon-button" aria-label={`Add Circle to ${s.name}`} onClick={() => createCircle(s)}><Plus size={19} /></button></>}</div>{!closed && <div className="circle-list">{rows(circles)}{!circles.length && <p className="empty-group">No Circles here yet.</p>}</div>}</section>;
      })}
      {!c.circles.some(matches) && <Empty icon={query ? Search : Sprout} title={query ? 'No Circles found.' : 'Make room for conversation.'}>{query ? 'Try another Circle name.' : 'Circles can live directly in this Community or inside an optional Group.'}</Empty>}
    </div>}
    <p className="circle-list-hint">Swipe right to mark unread. Swipe left for Options.</p>
    {options && <Modal title={options.name} subtitle="Circle options · your preferences are saved across devices." onClose={() => setOptionsId(null)}>
      <div className="circle-options">
        <button disabled={busy} onClick={() => { setOptionsId(null); onCircle(options.id); }}><MessageCircle size={18} />Open Circle</button>
        {options.joined && <>
          <button disabled={busy} onClick={() => action({ pinned: options.pin_position === null })}>{options.pin_position === null ? <Pin size={18} /> : <PinOff size={18} />}{options.pin_position === null ? 'Pin Circle' : 'Unpin Circle'}</button>
          {options.pin_position !== null && <div className="pin-position-controls"><button disabled={busy || pinned[0]?.id === options.id} onClick={() => action({ pin_position: Math.max(0, pinned.findIndex(g => g.id === options.id) - 1) })}><ArrowUp size={18} />Move up</button><button disabled={busy || pinned.at(-1)?.id === options.id} onClick={() => action({ pin_position: pinned.findIndex(g => g.id === options.id) + 1 })}><ArrowDown size={18} />Move down</button></div>}
          <button disabled={busy} onClick={() => action(unread(options) ? { read_to: Number.MAX_SAFE_INTEGER } : { marked_unread: true })}><CheckCheck size={18} />{unread(options) ? 'Mark as read' : 'Mark as unread'}</button>
          <button disabled={busy} onClick={() => action({ muted: !options.muted })}>{options.muted ? <Bell size={18} /> : <BellOff size={18} />}{options.muted ? 'Unmute notifications' : 'Mute notifications'}</button>
        </>}
        {options.is_admin && <button onClick={() => { setOptionsId(null); onModal({ kind: 'space', type: 'group', entity: options }); }}><Settings2 size={18} />Circle settings</button>}
        {options.joined && <button className="danger" disabled={busy} onClick={() => setConfirmLeave(true)}>Leave Circle</button>}
        {confirmLeave && <div className="confirmation"><p>Leave {options.name}? Private Circles require an admin invitation to rejoin.</p><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => setConfirmLeave(false)}>Cancel</button><button className="button danger-button" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/groups/${options.id}/join`, { method: 'DELETE' }); setOptionsId(null); await onRefresh(); } catch (err) { notify(err.message, true); } finally { setBusy(false); } }}>Leave Circle</button></div></div>}
      </div>
    </Modal>}
  </div>;
}
