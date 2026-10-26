import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Asterisk, ArrowRight, BellOff, Check, ChevronDown, ChevronRight, Info, ClipboardCheck, Heart, Link, Menu, Plus, Search, Settings2, Sprout, Users, X } from 'lucide-react';
import { api, patch, post } from './api';
import { Avatar, Logo, Toast } from './components';
import Auth from './Auth';
import { AccountLink } from './AccountSecurity';
import { InvitationIcon } from './Invitations';
import Contacts,{NavigationArt} from './Contacts';
import PrivateMessages from './PrivateMessages';
import './personal.css';
import EncryptionGate from './encryption/EncryptionGate';
import PrivacyShield from './encryption/PrivacyShield';
import { forget as forgetEncryption } from './encryption/client';
import Chat from './Chat';
import CommunityHome from './CommunityHome';
import CommunityDetails from './CommunityDetails';
import CreationRequests from './CreationRequests';
import SpaceIcon from './SpaceIcon';
import BirdJourney, { NEST_MOTION } from './BirdJourney';
import { InviteDialog, JoinDialog, MembersDialog, ProfileDialog, SpaceDialog } from './Dialogs';

const initialParams = new URLSearchParams(window.location.search);
const invited = initialParams.get('invite');
if (invited) sessionStorage.setItem('gatherly_invite', invited);

export default function App() {
  const [accountAction,setAccountAction]=useState(()=>initialParams.get('reset_password')?{kind:'reset',token:initialParams.get('reset_password')}:initialParams.get('verify_email')?{kind:'verify',token:initialParams.get('verify_email')}:null);
  const [user, setUser] = useState(null), [booting, setBooting] = useState(true), [config, setConfig] = useState({});
  const [communities, setCommunities] = useState([]), [community, setCommunity] = useState(null);
  const [view, setView] = useState({ cid: initialParams.get('community'), gid: initialParams.get('group') });
  const [version, setVersion] = useState(0), [modal, setModal] = useState(null), [toast, setToast] = useState(null), [error, setError] = useState('');
  const [switcher, setSwitcher] = useState(false), [mobileNav, setMobileNav] = useState(false), [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [invitationCount,setInvitationCount]=useState(0);
  const [tab,setTab]=useState(initialParams.get('conversation')?'messages':'tree'),[conversationId,setConversationId]=useState(initialParams.get('conversation')),[compose,setCompose]=useState(null),[privateUnread,setPrivateUnread]=useState(0);
  const [openingId,setOpeningId]=useState(null), [journey,setJourney]=useState(null);
  const navigationTimer=useRef(), navigationToken=useRef(0), returnFocus=useRef(null);
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
        const [list, account, inbox, privateList] = await Promise.all([api('/communities'),api('/me'),api('/invitations'),api('/private/conversations')]);
        if (!active) return;
        setCommunities(list.communities); setUser(account.user); setInvitationCount(inbox.invitations.length+(inbox.join_request_count||0));setPrivateUnread(privateList.conversations.reduce((n,c)=>n+c.unread,0));
        let cid = view.cid;
        if (!cid) cid = list.communities.find(c => c.id === account.user.last_community_id)?.id || list.communities[0]?.id;
        if (cid && !list.communities.some(c => c.id === cid)) cid = list.communities[0]?.id;
        if (!cid) { cancelEntry(); setCommunity(null); setView(prev => prev.cid ? { cid: null, gid: null } : prev); setError(''); return; }
        if (cid !== view.cid) { cancelEntry(); setView({ cid, gid: null }); return; }
        const current = await api(`/communities/${cid}`);
        if (!active) return;
        setCommunity(current.community); setError('');
        if (view.gid && !current.community.circles.some(g => g.id === view.gid)) {setJourney(null);setView(prev => ({ ...prev, gid: null }));}
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
  async function finishInvitation(result){sessionStorage.removeItem('gatherly_invite');if(result.pending){await reload();notify('Your request is awaiting Tree or Branch admin approval.');return result;}await chooseCommunity(result.community_id,result.group_id);await reload();notify(result.group_id?'You’ve joined the Nest.':'You’re in. Welcome to the Tree!');}
  async function openPrivate(id){try{const r=await post('/private/conversations',{user_id:id});setConversationId(r.conversation.id);setTab('messages');}catch(e){notify(e.message,true);}}
  function cancelEntry() {clearTimeout(navigationTimer.current);navigationToken.current++;setOpeningId(null);setJourney(null);}
  useEffect(()=>()=>clearTimeout(navigationTimer.current),[]);
  async function chooseCommunity(id, gid = null) {
    setTab('tree');
    cancelEntry();
    setView({ cid: id, gid }); setSwitcher(false); setMobileSwitcher(false); setMobileNav(false); setSearch('');
    if (id !== view.cid) setCommunity(null);
    try { const result = await patch('/me', { last_community_id: id }); setUser(result.user); }
    catch (err) { notify(err.message, true); }
    const url = new URL(window.location.href); url.search = ''; window.history.replaceState({}, '', url);
  }
  const communityHome = () => { setTab('tree');cancelEntry(); setSearch(''); setView(prev => ({ ...prev, gid:null, page:null })); setMobileNav(false); };
  const openGroup = id => { cancelEntry(); setSearch(''); setExpandedGroups(prev => ({...prev,[view.cid]:{...prev[view.cid],[id]:true}})); setView(prev => ({ ...prev, gid:null, page:null })); setMobileNav(false); };
  const toggleGroup = id => setExpandedGroups(prev => ({...prev,[view.cid]:{...prev[view.cid],[id]:!prev[view.cid]?.[id]}}));
  const openDetails = () => { setTab('tree');cancelEntry(); setView(prev => ({ ...prev, gid:null, page:'details' })); setMobileNav(false); };
  const finishJourney=useCallback(()=>setJourney(null),[]);
  const openCircle = id => {
    if(openingId || view.gid === id) return;
    cancelEntry();
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bird=document.querySelector('[data-bird-perch]')?.getBoundingClientRect();
    const token=++navigationToken.current;
    returnFocus.current=id; setOpeningId(id); setMobileNav(false);
    navigationTimer.current=setTimeout(()=>{
      if(token !== navigationToken.current) return;
      if(!reduced && bird && bird.bottom>0 && bird.top<innerHeight) setJourney({id, birdId:user.bird_id, start:{x:bird.x,y:bird.y,width:bird.width,height:bird.height}});
      setView(prev=>({...prev,gid:id,page:null}));setOpeningId(null);
    },reduced ? 0 : NEST_MOTION.press);
  };
  useEffect(()=>{
    if(!view.gid) {
      if(returnFocus.current) {
        document.querySelector(`[data-circle-id="${returnFocus.current}"] .circle-open`)?.focus({preventScroll:true}); returnFocus.current=null;
      }
    } else {
      const frame=requestAnimationFrame(()=>document.querySelector('.chat-heading h1')?.focus({preventScroll:true}));
      return ()=>cancelAnimationFrame(frame);
    }
  },[view.gid,community?.circles.some(g=>g.id === view.gid)]);
  async function logout() {
    cancelEntry();
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        const subscription = await reg?.pushManager?.getSubscription();
        if (subscription) { await api('/push/subscribe', { method: 'DELETE', body: { endpoint: subscription.endpoint } }); await subscription.unsubscribe(); }
      }
      await post('/auth/logout'); await forgetEncryption(user.id); setUser(null); setCommunity(null); setCommunities([]); setModal(null); setView({ cid: null, gid: null });
    } catch (err) { notify(err.message, true); }
  }
  const group = community?.circles.find(g => g.id === view.gid);
  if (booting) return <div className="boot-screen"><Logo /><span className="loading-dot" /><p>Making room for you…</p></div>;
  if (!user && error) return <div className="boot-screen"><Logo /><p className="error-banner">{error}</p><button className="button primary" onClick={boot}>Try again</button></div>;
  if(accountAction)return <AccountLink action={accountAction} onDone={async reset=>{setAccountAction(null);if(reset)setUser(null);await boot();}}/>;
  if (!user) return <Auth config={config} onLogin={(u,notice) => { if(notice)notify(notice);setUser(u); setView({ cid: u.last_community_id, gid: null }); }} />;
  return <EncryptionGate key={user.id} user={user} required={!!config.encryptionRequired} onLogout={logout}><div className={`app phase-one ${tab==='tree'&&group ? 'showing-chat' : ''} ${journey ? 'bird-in-transit' : ''}`} style={{'--nest-entry-duration':`${NEST_MOTION.slide}ms`}}>
    <header className="topbar"><div className="brand-zone"><button className="icon-button mobile-only" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={22} /></button><span className={community&&tab==='tree' ? 'desktop-logo' : ''}><Logo /></span>{community&&tab==='tree' && <div className="mobile-community-switcher" ref={mobileSwitcherRef}>
        <button className="mobile-community-button" aria-label="My Orchard" aria-expanded={mobileSwitcher} onClick={() => setMobileSwitcher(!mobileSwitcher)}><Avatar name={community.name} id={community.avatar_id} size={30} square /><span><strong>{community.name}</strong><small>YOUR TREE</small></span><ChevronDown size={13} /></button>
        {mobileSwitcher && <div className="switcher-menu"><div className="menu-label">My Orchard</div>{communities.map(c => <button className="switcher-item" key={c.id} onClick={() => chooseCommunity(c.id)}><Avatar name={c.name} id={c.avatar_id} size={30} square /><span>{c.name}</span>{view.cid === c.id && <Check size={15} />}</button>)}<div className="menu-divider" /><button onClick={() => { setMobileSwitcher(false); setModal({ kind: 'space', type: 'community' }); }}><Plus size={16} />Create a Tree</button><button onClick={() => { setMobileSwitcher(false); setModal({ kind: 'join' }); }}><InvitationIcon/>Invitations</button></div>}
      </div>}</div><span className="topbar-message">A little closer, together.<Sprout size={15} /></span><div className="topbar-actions"><button className="profile-button" onClick={() => setModal({ kind: 'profile' })} aria-label="Edit your profile"><Avatar name={user.name} id={user.avatar_id} portrait={user.avatar_style !== 'photo' ? user.avatar_choice || 'blue' : undefined} size={33} /><span>{user.name.split(' ')[0]}</span><ChevronDown size={14} /></button></div></header>
    {mobileNav && <div className="mobile-scrim" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}><div className="sidebar-brand"><Logo /></div><div className="community-switcher" ref={switcherRef}><button className="community-switch" aria-label="My Orchard" aria-expanded={switcher} onClick={() => setSwitcher(!switcher)}><Avatar name={community?.name || 'My Orchard'} id={community?.avatar_id} size={43} square /><span><strong>{community?.name || 'My Orchard'}</strong><small>{community ? 'My Orchard' : 'Find a place to belong'}</small></span><ChevronDown size={17} /></button>
      {switcher && <div className="switcher-menu"><div className="menu-label">My Orchard</div>{communities.map(c => <button className="switcher-item" key={c.id} onClick={() => chooseCommunity(c.id)}><Avatar name={c.name} id={c.avatar_id} size={32} square /><span>{c.name}</span>{view.cid === c.id && <Check size={16} />}</button>)}<div className="menu-divider" /><button onClick={() => { setSwitcher(false); setModal({ kind: 'space', type: 'community' }); }}><Plus size={16} /> Create a Tree</button><button onClick={() => { setSwitcher(false); setModal({ kind: 'join' }); }}><InvitationIcon/> Invitations</button></div>}
    </div>
      <nav className="sidebar-nav"><button className={!view.gid && !view.page ? 'selected' : ''} onClick={communityHome}><SpaceIcon kind="tree" size={21} />Tree home</button>{community && <><button className={view.page === 'details' ? 'selected' : ''} onClick={openDetails}><Info size={19} />Tree details</button><button onClick={() => { setModal({ kind: 'members' }); setMobileNav(false); }}><Users size={19} />Members</button><button onClick={()=>{setModal({kind:"creation-requests"});setMobileNav(false);}}><ClipboardCheck size={19}/>Creation requests{community.pending_creation_count > 0 && <span className="request-count">{community.pending_creation_count}</span>}</button></>}</nav>
      <section className="sidebar-invitations" aria-label="Invitations">{community && <button className="sidebar-invite" aria-label="Invite someone to this Tree" onClick={()=>{setMobileNav(false);setModal({kind:'invite'});}}><span className="invite-mini-icon"><InvitationIcon/></span><span><strong>Invite your people</strong><small>Share a QR code, code or link</small></span><Plus size={18}/></button>}<button className="sidebar-join" aria-label="Invitations" aria-description={`${invitationCount} pending invitations`} onClick={()=>{setMobileNav(false);setModal({kind:'join'});}}><InvitationIcon/>Invitations{invitationCount>0 && <span className="invitation-count" aria-label={`${invitationCount} pending invitations`}>{invitationCount}</span>}</button></section>
      <div className="sidebar-bottom"><div className="sidebar-footer"><span><span className="online-dot" /> Your space to connect</span>{community?.is_admin && <button className="icon-button" aria-label="Tree settings" onClick={() => setModal({ kind: 'space', type: 'community', entity: community })}><Settings2 size={17} /></button>}</div></div>
    </aside>
    <main className={`main-content tab-${tab}`}>{tab==='contacts'?<Contacts version={version} notify={notify} onMessage={openPrivate}/>:tab==='messages'?<PrivateMessages user={user} version={version} conversationId={conversationId} onConversation={setConversationId} compose={compose} onCompose={setCompose} notify={notify}/>:<>{error && <div className="workspace-error" role="alert">{error}<button onClick={reload}>Retry</button></div>}{view.page === 'details' && community ? <CommunityDetails community={community} onBack={communityHome} onModal={setModal} /> : group && community ? <Chat key={group.id} community={community} group={group} user={user} version={version} onRefresh={reload} onModal={setModal} notify={notify} onBack={communityHome} onSendIndividually={g=>{cancelEntry();setCompose({kind:'individual',source:g});setTab('messages');}} /> : community ? <CommunityHome key={community.id} community={community} birdId={user.bird_id} openingId={openingId} expandedGroups={expandedGroups[community.id] || {}} onToggleGroup={toggleGroup} search={search} onModal={setModal} onCircle={openCircle} onRefresh={reload} notify={notify} /> : !communities.length ? <Welcome user={user} onModal={setModal} /> : <div className="boot-screen"><span className="loading-dot" /><p>Opening your Tree…</p></div>}</>}</main>
    <nav className="bottom-navigation" aria-label="Main navigation">{[{id:'tree',label:'Tree'},{id:'messages',label:'Messages'},{id:'contacts',label:'Contacts'}].map(t=><button key={t.id} aria-label={t.label} aria-current={tab===t.id?'page':undefined} className={tab===t.id?'active':''} onClick={()=>{cancelEntry();setTab(t.id);setMobileNav(false);}}>{t.id==='tree'?<SpaceIcon kind="tree" size={28}/>:<NavigationArt kind={t.id}/>}<span>{t.label}</span>{t.id==='messages'&&privateUnread>0&&<span className="tab-unread" aria-label={`${privateUnread} unread private messages`}>{privateUnread}</span>}</button>)}</nav>
    {journey && group?.id === journey.id && <BirdJourney journey={journey} onDone={finishJourney}/>}
    <Toast toast={toast} />
    {modal?.kind === 'space' && <SpaceDialog modal={modal} community={community} onClose={() => setModal(null)} onDelete={async (result,type,entity)=>{cancelEntry();if(type === 'community'){setCommunity(null);setCommunities(prev=>prev.filter(c=>c.id !== entity.id));setUser(prev=>({...prev,last_community_id:prev.last_community_id === entity.id ? null : prev.last_community_id}));setView({cid:null,gid:null});}if(type === 'group' && view.gid === entity.id) communityHome();if(type === 'subcommunity')setExpandedGroups(prev=>({...prev,[view.cid]:{...prev[view.cid],[entity.id]:false}}));await reload();notify(type === 'community' ? 'Tree deleted.' : type === 'subcommunity' ? 'Branch deleted. Its Nests are kept at Tree level.' : 'Nest deleted.');}} onSave={async (result,type) => { if (type === 'community' && result.community) await chooseCommunity(result.community.id); if (type === 'group' && result.group) openCircle(result.group.id); if (type === 'subcommunity' && result.subcommunity) openGroup(result.subcommunity.id); await reload(); notify(result.request ? 'Submitted for approval. Follow its status in Creation requests.' : modal.entity ? 'Changes saved.' : `${type === 'subcommunity' ? 'Branch' : type === 'group' ? 'Nest' : 'Tree'} created. Make yourself at home!`); }} />}
    {modal?.kind === 'invite' && community && <InviteDialog community={community} group={modal.group} onClose={() => setModal(null)} />}
    {modal?.kind === 'join' && <JoinDialog version={version} initialToken={modal.token} onClose={() => setModal(null)} onJoined={finishInvitation} onJoin={async value => finishInvitation(await post('/invitations/accept',{token:value}))}/> }
    {modal?.kind === 'profile' && <ProfileDialog user={user} config={config} onClose={() => setModal(null)} onSave={async body => { setUser((await patch('/me',body)).user); await reload(); }} onAccountUpdate={setUser} onLogout={logout} notify={notify} />}
    {modal?.kind === 'members' && community && <MembersDialog community={community} user={user} onClose={() => setModal(null)} onRefresh={reload} notify={notify} />}
    {modal?.kind === 'creation-requests' && community && <CreationRequests community={community} version={version} onClose={()=>setModal(null)} onRefresh={reload} notify={notify}/> }
  </div></EncryptionGate>;
}

function Welcome({ user, onModal }) {
  return <div className="welcome-page"><div className="welcome-heading"><span className="eyebrow"><span className="tiny-dot" /> A FRESH LITTLE START</span><h1>Hi {user.name.split(' ')[0]},<br />find your <em>kind of together.</em></h1><p>From your neighborhood to your favorite people,<br />make room for the conversations that matter.</p></div>
    <div className="welcome-options"><button className="welcome-option create" onClick={() => onModal({ kind: 'space', type: 'community' })}><span className="welcome-option-icon"><Sprout size={32} strokeWidth={1.5} /></span><span className="eyebrow">PLANT THE FIRST SEED</span><h2>Start a Tree</h2><p>Bring your people together in a space that’s entirely yours.</p><span className="welcome-option-action">Create your Tree <ArrowRight size={20} /></span><Asterisk className="card-decoration" size={125} strokeWidth={1} aria-hidden="true" /></button>
      <button className="welcome-option join" onClick={() => onModal({ kind: 'join' })}><span className="welcome-option-icon"><Link size={31} strokeWidth={1.5} /></span><span className="eyebrow">THERE’S A PLACE FOR YOU</span><h2>Join your people</h2><p>Have an invitation? Follow it to your next great conversation.</p><span className="welcome-option-action">Use an invitation link or code <ArrowRight size={20} /></span></button></div>
    <div className="how-it-works"><span className="eyebrow">A LITTLE ORGANIZATION. A LOT OF CONNECTION.</span><div><span><span className="step-number">01</span><strong>Tree</strong><p>The place you all call home.</p></span><ChevronRight size={20} /><span><span className="step-number">02</span><strong>Branches · optional</strong><p>Organize Nests and delegate admins.</p></span><ChevronRight size={20} /><span><span className="step-number">03</span><strong>Nests</strong><p>Where the conversation happens.</p></span></div></div><div className="welcome-footnote"><Heart size={14} /> Made for connection, without the noise.</div>
  </div>;
}
