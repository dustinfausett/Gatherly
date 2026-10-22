import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bell, BellOff, CheckCheck, ChevronRight, LockKeyhole, MessageCircle, MoreHorizontal, Pin, PinOff, Plus, Search, Settings2, GitBranch, Bird as BirdIcon, Users } from 'lucide-react';
import { api, patch } from './api';
import { Avatar, Modal } from './components';
import { Bird } from './BirdJourney';

const unread = circle => circle.unread > 0 || circle.marked_unread;
const alphabetic = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);

function CircleRow({ circle: c, onOpen, onOptions, onChange, openingId }) {
  const [offset, setOffset] = useState(0), [revealed, setRevealed] = useState(false), [busy, setBusy] = useState(false);
  const gesture = useRef(null), suppressClick = useRef(false);
  async function markUnread() {
    setBusy(true);
    try { await onChange(c, { marked_unread: true }); } finally { setBusy(false); }
  }
  return <div className={`circle-row ${openingId === c.id ? 'is-opening' : ''} ${unread(c) ? 'is-unread' : ''} ${c.urgent_unread > 0 ? 'is-urgent' : ''}`} data-circle-id={c.id} data-unread={unread(c)} data-urgent={c.urgent_unread > 0}>
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
      <button className="circle-open" aria-label={`Open Nest ${c.name}`} aria-describedby={unread(c) ? `circle-state-${c.id}` : undefined} onClick={() => { if (revealed) setRevealed(false); else onOpen(c.id); }}>
        <span className="row-avatar"><Avatar name={c.name} id={c.avatar_id} size={50} /><span className="nest-avatar-symbol" aria-hidden="true"><BirdIcon size={12}/></span>{unread(c) && <span className={`avatar-status-dot ${c.urgent_unread > 0 ? 'urgent' : ''}`} aria-hidden="true" />}</span>
        <span className="circle-copy"><span className="circle-name">{c.name}{!!c.private && <LockKeyhole size={13} aria-label="Private Nest" />}{c.pin_position !== null && <Pin size={13} aria-label="Pinned" />}</span></span>
        {unread(c) && <span id={`circle-state-${c.id}`} className="visually-hidden">{c.urgent_unread > 0 ? 'Urgent and unread' : 'Unread'} · {c.unread || 'Marked unread'}</span>}
      </button>
      {c.joined && <button data-row-control className={`circle-mute ${c.muted ? 'muted' : ''}`} aria-label={`${c.muted ? 'Unmute' : 'Mute'} ${c.name}`} aria-pressed={c.muted} disabled={busy} title={c.muted ? 'Unmute notifications' : 'Mute notifications'} onClick={async () => { setBusy(true); try { await onChange(c, { muted: !c.muted }); } finally { setBusy(false); } }}>{c.muted ? <BellOff size={19} /> : <Bell size={19} />}</button>}
      <button data-row-control className="circle-more" aria-label={`Options for ${c.name}`} title="Nest options" onClick={() => onOptions(c)}><MoreHorizontal size={21} /></button>
    </div>
  </div>;
}


function GroupRow({ group: g, expanded, onToggle }) {
  return <div className={`circle-row group-row ${unread(g) ? 'is-unread' : ''} ${g.urgent_unread > 0 ? 'is-urgent' : ''}`} data-group-id={g.id} data-unread={unread(g)} data-urgent={g.urgent_unread > 0}>
    <div className="circle-row-content"><span className="branch-row-art" aria-hidden="true"/>
      <button className="circle-open" aria-label={`Open Branch ${g.name}`} aria-expanded={expanded} aria-controls={`group-circles-${g.id}`} aria-describedby={unread(g) ? `group-state-${g.id}` : undefined} onClick={() => onToggle(g.id)}>
        <span className="row-avatar"><Avatar name={g.name} id={g.avatar_id} size={50} /><span className="group-avatar-symbol" aria-hidden="true"><GitBranch size={11} /></span>{unread(g) && <span className={`avatar-status-dot ${g.urgent_unread > 0 ? 'urgent' : ''}`} aria-hidden="true" />}</span>
        <span className="circle-copy"><small className="row-kind"><GitBranch size={11}/>Branch</small><span className="circle-name">{g.name}</span></span><ChevronRight size={20} className={`group-row-chevron ${expanded ? 'expanded' : ''}`} />
        {unread(g) && <span id={`group-state-${g.id}`} className="visually-hidden">{g.urgent_unread > 0 ? 'Urgent and unread' : 'Unread'} Nests in this Branch</span>}
      </button>
    </div>
  </div>;
}

export default function CommunityHome({ community: c, search, onModal, onCircle, onRefresh, notify, expandedGroups, onToggleGroup, openingId }) {
  const [localSearch, setSearch] = useState(''), [searchOpen, setSearchOpen] = useState(false), [optionsId, setOptionsId] = useState(null), [busy, setBusy] = useState(false), [confirmLeave, setConfirmLeave] = useState(false);
  const query = (localSearch || search).trim().toLowerCase();
  const matches = item => !query || item.name.toLowerCase().includes(query);
  const joined = c.circles.filter(g => g.joined);
  const pinned = joined.filter(g => g.pin_position !== null).sort((a,b) => a.pin_position - b.pin_position || alphabetic(a,b));
  const options = c.circles.find(g => g.id === optionsId);
  const joinedGroups = c.subcommunities.filter(g => g.joined);
  const joinedCircles = c.circles.filter(g => g.joined && g.pin_position === null && (!g.subcommunity_id || (!joinedGroups.some(s => s.id === g.subcommunity_id) && !expandedGroups[g.subcommunity_id])));
  const publicGroups = c.subcommunities.filter(g => !g.joined);
  const publicCircles = c.circles.filter(g => !g.joined && (!g.private || g.is_admin) && !g.subcommunity_id);
  const entries = (groups, circles, unreadFirst) => [
    ...groups.map(g => ({ ...g, rowType:'group' })), ...circles.map(g => ({ ...g, rowType:'circle' })),
  ].filter(item => matches(item) || (item.rowType === 'group' && item.groups.some(matches)))
    .sort((a,b) => (unreadFirst ? Number(unread(b)) - Number(unread(a)) : 0) || alphabetic(a,b));
  const yourEntries = entries(joinedGroups,joinedCircles,true);
  const exploreEntries = entries(publicGroups,publicCircles,false);
  const scopePins = pinned.filter(matches);
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
  async function groupMembership(group) {
    if (busy) return;
    setBusy(true);
    try { await api(`/subcommunities/${group.id}/join`,{method:group.joined ? 'DELETE' : 'POST'}); await onRefresh(); }
    catch (err) { notify(err.message,true); } finally { setBusy(false); }
  }
  const circleRow = circle => <CircleRow key={`circle-${circle.id}`} circle={circle} onOpen={onCircle} onOptions={showOptions} onChange={change} openingId={openingId} />;
  const createCircle = parent => onModal({kind:'space',type:'group',parent});
  const list = items => items.map(item => {
    if (item.rowType !== 'group') return circleRow(item);
    const expanded = !!expandedGroups[item.id];
    const children = item.groups.filter(g => g.pin_position === null && (matches(item) || matches(g)))
      .sort((a,b) => Number(unread(b)) - Number(unread(a)) || alphabetic(a,b));
    return <div className="group-branch" key={`group-${item.id}`}>
      <GroupRow group={item} expanded={expanded} onToggle={onToggleGroup} />
      {expanded && <div className="group-children" id={`group-circles-${item.id}`} role="group" aria-label={`Nests in ${item.name}`}>
        <div className="circle-list">{children.map(circleRow)}</div>
        {!children.length && <p className="list-empty">{item.groups.some(g => g.pin_position !== null) ? 'Your pinned Nests from this Branch are shown above.' : query ? 'No Nests match your search.' : 'No Nests here yet.'}</p>}
        <div className="inline-group-actions">
          <button className="text-button" disabled={busy} onClick={() => groupMembership(item)}>{item.joined ? 'Leave Branch' : 'Join Branch'}</button>
          <button className="text-button" aria-label={`Add Nest to ${item.name}`} onClick={() => createCircle(item)}><Plus size={15} />Add Nest</button>{item.is_admin && <button className="icon-button" aria-label={`Branch settings for ${item.name}`} onClick={() => onModal({kind:'space',type:'subcommunity',entity:item})}><Settings2 size={16} /></button>}
        </div>
      </div>}
    </div>;
  });
  return <div className="community-home circle-home compact-home">
    <header className="community-banner"><Avatar name={c.name} id={c.avatar_id} size={56} /><div className="tree-banner-title"><h1>{c.name}</h1><span className="banner-perch" aria-hidden="true"><span className="banner-branch-art"/><span className="banner-bird" data-bird-perch><Bird/></span></span></div><div className="banner-actions">
      <button className="icon-button" aria-label="Search Branches and Nests" aria-expanded={searchOpen} onClick={() => { if (searchOpen) setSearch(''); setSearchOpen(!searchOpen); }}><Search size={19} /></button>
      {c.is_admin && <button className="icon-button" aria-label="Tree settings" onClick={() => onModal({kind:'space',type:'community',entity:c})}><Settings2 size={19} /></button>}
    </div></header>
    {searchOpen && <label className="circle-search compact-search"><Search size={18} /><input autoFocus aria-label="Search Branches and Nests" placeholder="Search Branches and Nests…" value={localSearch} onChange={e => setSearch(e.target.value)} /></label>}
    <section className="circle-section pinned-circles" aria-label="Pinned Nests"><h2><Pin size={14} />Pinned Nests</h2><div className="circle-list">{scopePins.map(circleRow)}</div>{!scopePins.length && <p className="list-empty">{query ? 'No pinned Nests match your search.' : 'Pin your favorite Nests from Options.'}</p>}</section>
    <section className="circle-section joined-circles" aria-label="Joined Branches and Nests"><h2>Branches &amp; Nests you’ve joined</h2><div className="circle-list">{list(yourEntries)}</div>{!yourEntries.length && <p className="list-empty">{query ? 'No matches here.' : 'Join a Branch or Nest from Explore below.'}</p>}</section>
    <section className="circle-section explore-circles" aria-label="Explore Branches and Nests"><h2>Explore Branches &amp; Nests</h2><div className="circle-list">{list(exploreEntries)}</div>{!exploreEntries.length && <p className="list-empty">{query ? 'No matches here.' : 'You’re all caught up. More spaces can be added as your Tree grows.'}</p>}</section>
    <div className="space-create-actions"><button className="button primary" onClick={() => createCircle()}><Plus size={17} />New Nest</button><button className="button secondary" onClick={() => onModal({kind:'space',type:'subcommunity'})}><GitBranch size={17} />New Branch</button></div>
    {options && <Modal title={options.name} subtitle="Nest options · your preferences are saved across devices." onClose={() => setOptionsId(null)}>
      <div className="circle-options">
        <button disabled={busy} onClick={() => { setOptionsId(null); onCircle(options.id); }}><MessageCircle size={18} />Open Nest</button>
        {options.joined && <>
          <button disabled={busy} onClick={() => action({ pinned: options.pin_position === null })}>{options.pin_position === null ? <Pin size={18} /> : <PinOff size={18} />}{options.pin_position === null ? 'Pin Nest' : 'Unpin Nest'}</button>
          {options.pin_position !== null && <div className="pin-position-controls"><button disabled={busy || pinned[0]?.id === options.id} onClick={() => action({ pin_position: Math.max(0, pinned.findIndex(g => g.id === options.id) - 1) })}><ArrowUp size={18} />Move up</button><button disabled={busy || pinned.at(-1)?.id === options.id} onClick={() => action({ pin_position: pinned.findIndex(g => g.id === options.id) + 1 })}><ArrowDown size={18} />Move down</button></div>}
          <button disabled={busy} onClick={() => action(unread(options) ? { read_to: Number.MAX_SAFE_INTEGER } : { marked_unread: true })}><CheckCheck size={18} />{unread(options) ? 'Mark as read' : 'Mark as unread'}</button>
          <button disabled={busy} onClick={() => action({ muted: !options.muted })}>{options.muted ? <Bell size={18} /> : <BellOff size={18} />}{options.muted ? 'Unmute notifications' : 'Mute notifications'}</button>
        </>}
        {options.is_admin && <button onClick={() => { setOptionsId(null); onModal({ kind: 'space', type: 'group', entity: options }); }}><Settings2 size={18} />Nest settings</button>}
        {options.joined && <button className="danger" disabled={busy} onClick={() => setConfirmLeave(true)}>Leave Nest</button>}
        {confirmLeave && <div className="confirmation"><p>Leave {options.name}? Private Nests require an admin invitation to rejoin.</p><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => setConfirmLeave(false)}>Cancel</button><button className="button danger-button" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/groups/${options.id}/join`, { method: 'DELETE' }); setOptionsId(null); await onRefresh(); } catch (err) { notify(err.message, true); } finally { setBusy(false); } }}>Leave Nest</button></div></div>}
      </div>
    </Modal>}
  </div>;
}
