import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Asterisk, ArrowRight, Bell, BellOff, Check, ChevronDown, ChevronRight, Compass, Hash, Heart, Link, LockKeyhole, Menu, MessageCircle, Plus, Search, Settings2, Sprout, Users, X } from 'lucide-react';
import { api, patch, post } from './api';
import { Avatar, Logo, Toast } from './components';
import Auth from './Auth';
import Chat from './Chat';
import CommunityHome from './CommunityHome';
import { InviteDialog, JoinDialog, MembersDialog, NotificationsDialog, ProfileDialog, SpaceDialog } from './Dialogs';

const initialParams = new URLSearchParams(window.location.search);
const invited = initialParams.get('invite');
if (invited) sessionStorage.setItem('gatherly_invite', invited);

export default function App() {
  const [user, setUser] = useState(null), [booting, setBooting] = useState(true), [config, setConfig] = useState({});
  const [communities, setCommunities] = useState([]), [community, setCommunity] = useState(null), [notifications, setNotifications] = useState([]);
  const [view, setView] = useState({ cid: initialParams.get('community'), gid: initialParams.get('group') });
  const [version, setVersion] = useState(0), [modal, setModal] = useState(null), [toast, setToast] = useState(null), [error, setError] = useState('');
  const [switcher, setSwitcher] = useState(false), [mobileNav, setMobileNav] = useState(false), [filter, setFilter] = useState('joined'), [search, setSearch] = useState(''), [collapsed, setCollapsed] = useState({});
  const [mobileSwitcher, setMobileSwitcher] = useState(false);
  const toastTimer = useRef(), switcherRef = useRef();
  const mobileSwitcherRef = useRef();
  const notify = useCallback((message, error = false) => { clearTimeout(toastTimer.current); setToast({ message, error }); toastTimer.current = setTimeout(() => setToast(null), 5000); }, []);
  async function boot() {
    setBooting(true); setError('');
    try {
      const configuration = await api('/config'); setConfig(configuration);
      try { const data = await api('/me'); setUser(data.user); setView(prev => ({ ...prev, cid: prev.cid || data.user.last_community_id })); }
      catch (err) { if (err.status !== 401) throw err; }
    } catch (err) { setError(err.message); } finally { setBooting(false); }
  }
  useEffect(() => { boot(); return () => clearTimeout(toastTimer.current); }, []);
  const reload = useCallback(async () => { setVersion(v => v + 1); }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const [list, n] = await Promise.all([api('/communities'), api('/notifications')]);
        if (!active) return;
        setCommunities(list.communities); setNotifications(n.notifications);
        let cid = view.cid;
        if (!cid) cid = list.communities.find(c => c.id === user.last_community_id)?.id || list.communities[0]?.id;
        if (cid && !list.communities.some(c => c.id === cid)) cid = list.communities[0]?.id;
        if (!cid) { setCommunity(null); setView(prev => prev.cid ? { cid: null, gid: null } : prev); setError(''); return; }
        if (cid !== view.cid) { setView({ cid, gid: null }); return; }
        const current = await api(`/communities/${cid}`);
        if (!active) return;
        setCommunity(current.community); setError('');
        if (view.gid && !current.community.circles.some(g => g.id === view.gid)) setView(prev => ({ ...prev, gid: null }));
      } catch (err) { if (active) { if (err.status === 401) setUser(null); else setError(err.message); } }
    })();
    return () => { active = false; };
  }, [user?.id, view.cid, version]);
  useEffect(() => {
    if (!user) return;
    const events = new EventSource('/api/events');
    const refresh = () => reload();
    events.addEventListener('refresh', refresh);
    events.addEventListener('connected', refresh);
    const focus = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('online', refresh);
    return () => { events.close(); document.removeEventListener('visibilitychange', focus); window.removeEventListener('online', refresh); };
  }, [user?.id, reload]);
  useEffect(() => {
    if (user && sessionStorage.getItem('gatherly_invite')) setModal({ kind: 'join', token: sessionStorage.getItem('gatherly_invite') });
  }, [user?.id]);
  useEffect(() => {
    const outside = e => { if (switcherRef.current && !switcherRef.current.contains(e.target)) setSwitcher(false); if (mobileSwitcherRef.current && !mobileSwitcherRef.current.contains(e.target)) setMobileSwitcher(false); };
    const escape = e => { if (e.key === 'Escape') { setSwitcher(false); setMobileNav(false); setMobileSwitcher(false); } };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  async function chooseCommunity(id, gid = null) {
    setView({ cid: id, gid }); setSwitcher(false); setMobileSwitcher(false); setMobileNav(false); setSearch(''); setFilter('joined');
    if (id !== view.cid) setCommunity(null);
    try { const result = await patch('/me', { last_community_id: id }); setUser(result.user); }
    catch (err) { notify(err.message, true); }
    const url = new URL(window.location.href); url.search = ''; window.history.replaceState({}, '', url);
  }
  const openCircle = id => { setView(prev => ({ ...prev, gid: id })); setMobileNav(false); };
  async function logout() {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        const subscription = await reg?.pushManager?.getSubscription();
        if (subscription) { await api('/push/subscribe', { method: 'DELETE', body: { endpoint: subscription.endpoint } }); await subscription.unsubscribe(); }
      }
      await post('/auth/logout'); setUser(null); setCommunity(null); setCommunities([]); setModal(null); setView({ cid: null, gid: null });
    } catch (err) { notify(err.message, true); }
  }
  const group = community?.circles.find(g => g.id === view.gid);
  const allCircles = community?.circles || [];
  const unread = notifications.filter(n => !n.seen).length;
  const visibleCircle = g => (filter !== 'joined' || g.joined) && (!search || g.name.toLowerCase().includes(search.toLowerCase()));
  if (booting) return <div className="boot-screen"><Logo /><span className="loading-dot" /><p>Making room for you…</p></div>;
  if (!user && error) return <div className="boot-screen"><Logo /><p className="error-banner">{error}</p><button className="button primary" onClick={boot}>Try again</button></div>;
  if (!user) return <Auth config={config} onLogin={u => { setUser(u); setView({ cid: u.last_community_id, gid: null }); }} />;
  return <div className={`app ${group ? 'showing-chat' : ''}`}>
    <header className="topbar"><div className="brand-zone"><button className="icon-button mobile-only" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={22} /></button><span className={community ? 'desktop-logo' : ''}><Logo /></span>{community && <div className="mobile-community-switcher" ref={mobileSwitcherRef}>
        <button className="mobile-community-button" aria-label="Switch Community" aria-expanded={mobileSwitcher} onClick={() => setMobileSwitcher(!mobileSwitcher)}><Avatar name={community.name} id={community.avatar_id} size={30} square /><span><strong>{community.name}</strong><small>YOUR COMMUNITY</small></span><ChevronDown size={13} /></button>
        {mobileSwitcher && <div className="switcher-menu"><div className="menu-label">YOUR COMMUNITIES</div>{communities.map(c => <button className="switcher-item" key={c.id} onClick={() => chooseCommunity(c.id)}><Avatar name={c.name} id={c.avatar_id} size={30} square /><span>{c.name}</span>{view.cid === c.id && <Check size={15} />}</button>)}<div className="menu-divider" /><button onClick={() => { setMobileSwitcher(false); setModal({ kind: 'space', type: 'community' }); }}><Plus size={16} />Create a Community</button><button onClick={() => { setMobileSwitcher(false); setModal({ kind: 'join' }); }}><Link size={16} />Join with an invitation</button></div>}
      </div>}</div><span className="topbar-message">A little closer, together.<Sprout size={15} /></span><div className="topbar-actions"><button className="icon-button notification-button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setModal({ kind: 'notifications' })}><Bell size={20} />{unread > 0 && <span className="notification-badge">{unread > 9 ? '9+' : unread}</span>}</button><span className="header-divider" /><button className="profile-button" onClick={() => setModal({ kind: 'profile' })} aria-label="Edit your profile"><Avatar name={user.name} id={user.avatar_id} size={33} /><span>{user.name.split(' ')[0]}</span><ChevronDown size={14} /></button></div></header>
    {mobileNav && <div className="mobile-scrim" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}><div className="community-switcher" ref={switcherRef}><button className="community-switch" aria-expanded={switcher} onClick={() => setSwitcher(!switcher)}><Avatar name={community?.name || 'Your communities'} id={community?.avatar_id} size={43} square /><span><strong>{community?.name || 'Your communities'}</strong><small>{community ? `${community.member_count} ${community.member_count === 1 ? 'member' : 'members'} · Your shared space` : 'Find a place to belong'}</small></span><ChevronDown size={17} /></button>
      {switcher && <div className="switcher-menu"><div className="menu-label">YOUR COMMUNITIES</div>{communities.map(c => <button className="switcher-item" key={c.id} onClick={() => chooseCommunity(c.id)}><Avatar name={c.name} id={c.avatar_id} size={32} square /><span>{c.name}</span>{view.cid === c.id && <Check size={16} />}</button>)}<div className="menu-divider" /><button onClick={() => { setSwitcher(false); setModal({ kind: 'space', type: 'community' }); }}><Plus size={16} /> Create a Community</button><button onClick={() => { setSwitcher(false); setModal({ kind: 'join' }); }}><Link size={16} /> Join with an invitation</button></div>}
    </div>
      <nav className="sidebar-nav"><button className={!view.gid && filter === 'joined' ? 'selected' : ''} onClick={() => { setFilter('joined'); setView(prev => ({ ...prev, gid: null })); setMobileNav(false); }}><MessageCircle size={19} />Your Circles<span className="nav-count">{allCircles.filter(g => g.joined).length}</span></button><button className={!view.gid && filter === 'all' ? 'selected' : ''} onClick={() => { setFilter('all'); setView(prev => ({ ...prev, gid: null })); setMobileNav(false); }}><Compass size={19} />Discover Circles</button>{community && <button onClick={() => { setModal({ kind: 'members' }); setMobileNav(false); }}><Users size={19} />Members<span className="nav-count">{community.member_count}</span></button>}</nav>
      <div className="sidebar-search"><Search size={16} /><input aria-label="Find a Circle" placeholder="Find a Circle…" value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="Clear Circle search" onClick={() => setSearch('')}><X size={13} /></button>}</div>
      <div className="sidebar-section-label">GROUPS · OPTIONAL{community?.is_admin && <button className="icon-button" aria-label="Create Group" onClick={() => setModal({ kind: 'space', type: 'subcommunity' })}><Plus size={16} /></button>}</div>
      <div className="space-tree">{allCircles.filter(g => !g.subcommunity_id && visibleCircle(g)).map(g => <button key={g.id} className={`tree-group ${view.gid === g.id ? 'selected' : ''}`} onClick={() => openCircle(g.id)}><MessageCircle size={17} /><span>{g.name}</span>{g.unread > 0 || g.marked_unread ? <span className="unread-badge">{g.unread || '•'}</span> : null}</button>)}{community?.subcommunities.map(s => <div className="tree-section" key={s.id}><div className="tree-heading"><button className="tree-label" onClick={() => setCollapsed(prev => ({ ...prev, [s.id]: !prev[s.id] }))} aria-expanded={!collapsed[s.id]}><ChevronDown size={13} className={collapsed[s.id] ? 'collapsed' : ''} />{s.avatar_id ? <Avatar name={s.name} id={s.avatar_id} size={20} square /> : null}<span>{s.name}</span></button>{s.is_admin && <button className="icon-button" aria-label={`Create Circle in ${s.name}`} onClick={() => setModal({ kind: 'space', type: 'group', parent: s })}><Plus size={14} /></button>}</div>{!collapsed[s.id] && <div className="tree-groups">{s.groups.filter(visibleCircle).map(g => <button key={g.id} className={`tree-group ${view.gid === g.id ? 'selected' : ''} ${!g.joined ? 'not-joined' : ''}`} onClick={() => openCircle(g.id)}>{g.private ? <LockKeyhole size={15} /> : <Hash size={17} />}<span>{g.name}</span>{g.muted ? <BellOff size={13} /> : g.unread > 0 || g.marked_unread ? <span className="unread-badge">{g.unread > 99 ? '99+' : g.unread || '•'}</span> : null}</button>)}{!s.groups.length && <span className="tree-empty">A little room to grow.</span>}</div>}</div>)}
        {community && !community.subcommunities.length && <div className="sidebar-empty"><Sprout size={25} /><p>Your space is ready to grow.</p>{community.is_admin && <button className="text-button" onClick={() => setModal({ kind: 'space', type: 'subcommunity' })}>Add a Group <Plus size={13} /></button>}</div>}
      </div>
      <div className="sidebar-bottom">{community?.is_admin && <button className="sidebar-invite" onClick={() => setModal({ kind: 'invite' })}><span className="invite-mini-icon"><Users size={19} /></span><span><strong>Better with your people</strong><small>Invite someone to join</small></span><Plus size={17} /></button>}<div className="sidebar-footer"><span><span className="online-dot" /> Your space to connect</span>{community?.is_admin && <button className="icon-button" aria-label="Community settings" onClick={() => setModal({ kind: 'space', type: 'community', entity: community })}><Settings2 size={17} /></button>}</div></div>
    </aside>
    <main className="main-content">{error && <div className="workspace-error" role="alert">{error}<button onClick={reload}>Retry</button></div>}{group && community ? <Chat key={group.id} community={community} group={group} user={user} version={version} onRefresh={reload} onModal={setModal} notify={notify} onBack={() => setView(prev => ({ ...prev, gid: null }))} /> : community ? <CommunityHome community={community} user={user} filter={filter} setFilter={setFilter} search={search} onModal={setModal} onCircle={openCircle} onRefresh={reload} notify={notify} /> : !communities.length ? <Welcome user={user} onModal={setModal} /> : <div className="boot-screen"><span className="loading-dot" /><p>Opening your Community…</p></div>}</main>
    <Toast toast={toast} />
    {modal?.kind === 'space' && <SpaceDialog modal={modal} community={community} onClose={() => setModal(null)} onSave={async (result,type) => { if (type === 'community' && result.community) await chooseCommunity(result.community.id); if (type === 'group' && result.group) openCircle(result.group.id); await reload(); notify(modal.entity ? 'Changes saved.' : `${type === 'subcommunity' ? 'Group' : type === 'group' ? 'Circle' : 'Community'} created. Make yourself at home!`); }} />}
    {modal?.kind === 'invite' && community && <InviteDialog community={community} group={modal.group} onClose={() => setModal(null)} />}
    {modal?.kind === 'join' && <JoinDialog initialToken={modal.token} onClose={() => setModal(null)} onJoin={async value => { const result = await post('/invitations/accept', { token: value }); sessionStorage.removeItem('gatherly_invite'); await chooseCommunity(result.community_id, result.group_id); await reload(); notify('You’re in. Welcome to the Community!'); }} />}
    {modal?.kind === 'profile' && <ProfileDialog user={user} config={config} onClose={() => setModal(null)} onSave={async body => { setUser((await patch('/me',body)).user); await reload(); }} onLogout={logout} notify={notify} />}
    {modal?.kind === 'members' && community && <MembersDialog community={community} user={user} onClose={() => setModal(null)} onRefresh={reload} notify={notify} />}
    {modal?.kind === 'notifications' && <NotificationsDialog notifications={notifications} onClose={() => setModal(null)} onOpen={chooseCommunity} onMarkRead={async () => { try { await patch('/notifications', {}); await reload(); } catch (err) { notify(err.message,true); } }} />}
  </div>;
}

function Welcome({ user, onModal }) {
  return <div className="welcome-page"><div className="welcome-heading"><span className="eyebrow"><span className="tiny-dot" /> A FRESH LITTLE START</span><h1>Hi {user.name.split(' ')[0]},<br />find your <em>kind of together.</em></h1><p>From your neighborhood to your favorite people,<br />make room for the conversations that matter.</p></div>
    <div className="welcome-options"><button className="welcome-option create" onClick={() => onModal({ kind: 'space', type: 'community' })}><span className="welcome-option-icon"><Sprout size={32} strokeWidth={1.5} /></span><span className="eyebrow">PLANT THE FIRST SEED</span><h2>Start a Community</h2><p>Bring your people together in a space that’s entirely yours.</p><span className="welcome-option-action">Create your Community <ArrowRight size={20} /></span><Asterisk className="card-decoration" size={125} strokeWidth={1} aria-hidden="true" /></button>
      <button className="welcome-option join" onClick={() => onModal({ kind: 'join' })}><span className="welcome-option-icon"><Link size={31} strokeWidth={1.5} /></span><span className="eyebrow">THERE’S A PLACE FOR YOU</span><h2>Join your people</h2><p>Have an invitation? Follow it to your next great conversation.</p><span className="welcome-option-action">Use an invitation link <ArrowRight size={20} /></span></button></div>
    <div className="how-it-works"><span className="eyebrow">A LITTLE ORGANIZATION. A LOT OF CONNECTION.</span><div><span><span className="step-number">01</span><strong>Community</strong><p>The place you all call home.</p></span><ChevronRight size={20} /><span><span className="step-number">02</span><strong>Groups · optional</strong><p>Organize Circles and delegate admins.</p></span><ChevronRight size={20} /><span><span className="step-number">03</span><strong>Circles</strong><p>Where the conversation happens.</p></span></div></div><div className="welcome-footnote"><Heart size={14} /> Made for connection, without the noise.</div>
  </div>;
}
