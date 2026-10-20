import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Bell, BellOff, CheckCheck, ChevronRight, LockKeyhole, MessageCircle, MoreHorizontal, Pin, PinOff, Plus, Search, Settings2, Users } from 'lucide-react';
import { api, patch } from './api';
import { Avatar, Modal } from './components';

const unread = circle => circle.unread > 0 || circle.marked_unread;
const alphabetic = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);

function CircleRow({ circle: c, onOpen, onOptions, onChange }) {
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
      <button className="circle-open" aria-label={`Open Circle ${c.name}`} aria-describedby={unread(c) ? `circle-state-${c.id}` : undefined} onClick={() => { if (revealed) setRevealed(false); else onOpen(c.id); }}>
        <span className="row-avatar"><Avatar name={c.name} id={c.avatar_id} size={50} />{unread(c) && <span className={`avatar-status-dot ${c.urgent_unread > 0 ? 'urgent' : ''}`} aria-hidden="true" />}</span>
        <span className="circle-copy"><span className="circle-name">{c.name}{!!c.private && <LockKeyhole size={13} aria-label="Private Circle" />}{c.pin_position !== null && <Pin size={13} aria-label="Pinned" />}</span></span>
        {unread(c) && <span id={`circle-state-${c.id}`} className="visually-hidden">{c.urgent_unread > 0 ? 'Urgent and unread' : 'Unread'} · {c.unread || 'Marked unread'}</span>}
      </button>
      {c.joined && <button data-row-control className={`circle-mute ${c.muted ? 'muted' : ''}`} aria-label={`${c.muted ? 'Unmute' : 'Mute'} ${c.name}`} aria-pressed={c.muted} disabled={busy} title={c.muted ? 'Unmute notifications' : 'Mute notifications'} onClick={async () => { setBusy(true); try { await onChange(c, { muted: !c.muted }); } finally { setBusy(false); } }}>{c.muted ? <BellOff size={19} /> : <Bell size={19} />}</button>}
      <button data-row-control className="circle-more" aria-label={`Options for ${c.name}`} title="Circle options" onClick={() => onOptions(c)}><MoreHorizontal size={21} /></button>
    </div>
  </div>;
}


function GroupRow({ group: g, onOpen }) {
  return <div className={`circle-row group-row ${unread(g) ? 'is-unread' : ''} ${g.urgent_unread > 0 ? 'is-urgent' : ''}`} data-group-id={g.id} data-unread={unread(g)} data-urgent={g.urgent_unread > 0}>
    <div className="circle-row-content">
      <button className="circle-open" aria-label={`Open Group ${g.name}`} aria-describedby={unread(g) ? `group-state-${g.id}` : undefined} onClick={() => onOpen(g.id)}>
        <span className="row-avatar"><Avatar name={g.name} id={g.avatar_id} size={50} /><span className="group-avatar-symbol" aria-hidden="true"><Users size={11} /></span>{unread(g) && <span className={`avatar-status-dot ${g.urgent_unread > 0 ? 'urgent' : ''}`} aria-hidden="true" />}</span>
        <span className="circle-copy"><span className="circle-name">{g.name}</span></span><ChevronRight size={20} className="group-row-chevron" />
        {unread(g) && <span id={`group-state-${g.id}`} className="visually-hidden">{g.urgent_unread > 0 ? 'Urgent and unread' : 'Unread'} Circles in this Group</span>}
      </button>
    </div>
  </div>;
}

export default function CommunityHome({ community: c, search, onModal, onCircle, onRefresh, notify, selectedGroupId, onGroup, onHome }) {
  const [localSearch, setSearch] = useState(''), [searchOpen, setSearchOpen] = useState(false), [optionsId, setOptionsId] = useState(null), [busy, setBusy] = useState(false), [confirmLeave, setConfirmLeave] = useState(false);
  useEffect(() => { setSearch(''); setSearchOpen(false); setOptionsId(null); }, [selectedGroupId]);
  const activeGroup = c.subcommunities.find(g => g.id === selectedGroupId);
  const query = (localSearch || search).trim().toLowerCase();
  const matches = item => !query || item.name.toLowerCase().includes(query);
  const joined = c.circles.filter(g => g.joined);
  const pinned = joined.filter(g => g.pin_position !== null).sort((a,b) => a.pin_position - b.pin_position || alphabetic(a,b));
  const options = c.circles.find(g => g.id === optionsId);
  const scopeCircles = activeGroup ? activeGroup.groups : c.circles;
  const joinedGroups = activeGroup ? [] : c.subcommunities.filter(g => g.joined);
  const joinedCircles = scopeCircles.filter(g => g.joined && g.pin_position === null && (activeGroup || !g.subcommunity_id || !joinedGroups.some(s => s.id === g.subcommunity_id)));
  const publicGroups = activeGroup ? [] : c.subcommunities.filter(g => !g.joined);
  const publicCircles = scopeCircles.filter(g => !g.joined && (!g.private || g.is_admin) && (activeGroup || !g.subcommunity_id));
  const entries = (groups, circles, unreadFirst) => [
    ...groups.map(g => ({ ...g, rowType:'group' })), ...circles.map(g => ({ ...g, rowType:'circle' })),
  ].filter(item => matches(item) || (item.rowType === 'group' && item.groups.some(matches)))
    .sort((a,b) => (unreadFirst ? Number(unread(b)) - Number(unread(a)) : 0) || alphabetic(a,b));
  const yourEntries = entries(joinedGroups,joinedCircles,true);
  const exploreEntries = entries(publicGroups,publicCircles,false);
  const scopePins = pinned.filter(g => (!activeGroup || g.subcommunity_id === activeGroup.id) && matches(g));
  const canCreate = activeGroup ? activeGroup.is_admin : c.is_admin || c.subcommunities.some(g => g.is_admin);
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
  async function groupMembership() {
    if (busy) return;
    setBusy(true);
    try { await api(`/subcommunities/${activeGroup.id}/join`,{method:activeGroup.joined ? 'DELETE' : 'POST'}); await onRefresh(); }
    catch (err) { notify(err.message,true); } finally { setBusy(false); }
  }
  const circleRow = circle => <CircleRow key={`circle-${circle.id}`} circle={circle} onOpen={onCircle} onOptions={showOptions} onChange={change} />;
  const list = items => items.map(item => item.rowType === 'group' ? <GroupRow key={`group-${item.id}`} group={item} onOpen={onGroup} /> : circleRow(item));
  const createCircle = () => onModal({kind:'space',type:'group',parent:activeGroup || (!c.is_admin ? c.subcommunities.find(s => s.is_admin) : undefined)});
  const banner = activeGroup || c;
  return <div className="community-home circle-home compact-home">
    {activeGroup && <button className="group-back" onClick={onHome}><ArrowLeft size={17} />Back to Community</button>}
    <header className="community-banner"><Avatar name={banner.name} id={banner.avatar_id} size={56} /><h1>{banner.name}</h1><div className="banner-actions">
      <button className="icon-button" aria-label="Search Groups and Circles" aria-expanded={searchOpen} onClick={() => { if (searchOpen) setSearch(''); setSearchOpen(!searchOpen); }}><Search size={19} /></button>
      {(activeGroup ? activeGroup.is_admin : c.is_admin) && <button className="icon-button" aria-label={activeGroup ? 'Group settings' : 'Community settings'} onClick={() => onModal({kind:'space',type:activeGroup ? 'subcommunity' : 'community',entity:banner})}><Settings2 size={19} /></button>}
    </div></header>
    {searchOpen && <label className="circle-search compact-search"><Search size={18} /><input autoFocus aria-label="Search Groups and Circles" placeholder="Search Groups and Circles…" value={localSearch} onChange={e => setSearch(e.target.value)} /></label>}
    <section className="circle-section pinned-circles" aria-label="Pinned Circles"><h2><Pin size={14} />Pinned Circles</h2><div className="circle-list">{scopePins.map(circleRow)}</div>{!scopePins.length && <p className="list-empty">{query ? 'No pinned Circles match your search.' : 'Pin your favorite Circles from Options.'}</p>}</section>
    <section className="circle-section joined-circles" aria-label={activeGroup ? 'Joined Circles' : 'Joined Groups and Circles'}><h2>{activeGroup ? 'Circles you’ve joined' : 'Groups & Circles you’ve joined'}</h2><div className="circle-list">{list(yourEntries)}</div>{!yourEntries.length && <p className="list-empty">{query ? 'No matches here.' : 'Join a Group or Circle from Explore below.'}</p>}</section>
    <section className="circle-section explore-circles" aria-label={activeGroup ? 'Explore Circles' : 'Explore Groups and Circles'}><h2>{activeGroup ? 'Explore Circles' : 'Explore Groups & Circles'}</h2><div className="circle-list">{list(exploreEntries)}</div>{!exploreEntries.length && <p className="list-empty">{query ? 'No matches here.' : 'You’re all caught up. More spaces can be added as your Community grows.'}</p>}</section>
    {activeGroup && <div className="group-membership"><button className={`button ${activeGroup.joined ? 'secondary' : 'primary'}`} disabled={busy} onClick={groupMembership}>{activeGroup.joined ? 'Leave Group' : 'Join Group'}</button><p>{activeGroup.joined ? 'Leaving the Group keeps your Circle memberships, pins, and notifications.' : 'Join this Group to add it to your list. Join individual Circles to chat and receive notifications.'}</p></div>}
    {(canCreate || (!activeGroup && c.is_admin)) && <div className="space-create-actions">{canCreate && <button className="button primary" onClick={createCircle} aria-label={activeGroup ? `Add Circle to ${activeGroup.name}` : 'New Circle'}><Plus size={17} />{activeGroup ? 'Add Circle' : 'New Circle'}</button>}{!activeGroup && c.is_admin && <button className="button secondary" onClick={() => onModal({kind:'space',type:'subcommunity'})}><Users size={17} />New Group</button>}</div>}
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
