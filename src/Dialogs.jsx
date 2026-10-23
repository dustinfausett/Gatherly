import React, { useEffect, useState } from 'react';
import { Check, Copy, Crown, Link, LogOut, Shield, UserPlus, BellRing, BellOff, Trash2, Users } from 'lucide-react';
import { api, post, patch } from './api';
import { Avatar, AvatarEditor, Empty, Field, Form, Modal, Toggle } from './components';
import BirdPicker from './BirdPicker';
import { EncryptionSettings } from './encryption/EncryptionGate';
import { getBird } from '../shared/birds';

export function SpaceDialog({ modal, community, onClose, onSave, onDelete }) {
  const { type, entity, parent } = modal;
  const editing = !!entity;
  const [avatarId, setAvatarId] = useState(entity?.avatar_id || null);
  const [deleting,setDeleting]=useState(!!modal.delete);
  const [privateCircle, setPrivate] = useState(!!entity?.private);
  const [adminOnly, setAdminOnly] = useState(!!entity?.admin_only);
  const [branchApproval, setBranchApproval] = useState(!!(entity?.branch_approval_required ?? true));
  const [nestApproval, setNestApproval] = useState(!!(entity?.nest_approval_required ?? true));
  const [name, setName] = useState(entity?.name || '');
  const [location, setLocation] = useState(entity?.subcommunity_id || parent?.id || '');
  const label = { community: 'Tree', subcommunity: 'Branch', group: 'Nest' }[type];
  const parentAdmin = type === 'group' && location ? community?.subcommunities.find(s => s.id === location)?.is_admin : false;
  const needsApproval = !editing && (type !== 'community' || community?.role === 'owner') && !community.is_admin && !parentAdmin && (type === 'subcommunity' ? community.branch_approval_required : community.nest_approval_required);
  return <Modal title={deleting ? `Delete ${label}` : `${editing ? 'Edit' : 'Create a'} ${label}`} subtitle={deleting ? entity.name : type === 'community' ? 'Give your people a place to gather.' : type === 'subcommunity' ? 'A little organization for a growing Tree.' : 'A dedicated space for a conversation.'} onClose={onClose}>
    {deleting ? <DeleteSpaceForm type={type} entity={entity} onCancel={()=>setDeleting(false)} onDeleted={async result=>{await onDelete(result,type,entity);onClose();}}/> : <>
    <Form submit={editing ? 'Save changes' : needsApproval ? 'Submit for Approval' : `Create ${label}`} onSubmit={async form => {
      const payload = { name: form.get('name'), description: form.get('description'), avatar_id: avatarId };
      if (type === 'community' && editing) Object.assign(payload,{branch_approval_required:branchApproval,nest_approval_required:nestApproval});
      if (type === 'group') Object.assign(payload, { private: privateCircle, admin_only: adminOnly, subcommunity_id: location || null });
      let result;
      if (editing) { payload.avatar_id = avatarId; result = await patch(`/${type === 'community' ? 'communities' : type === 'subcommunity' ? 'subcommunities' : 'groups'}/${entity.id}`, payload); }
      else {
        const url = type === 'community' ? '/communities' : type === 'subcommunity' ? `/communities/${community.id}/subcommunities` : `/communities/${community.id}/circles`;
        result = await post(url, payload);
      }
      await onSave(result, type); onClose();
    }}>
      {needsApproval && <div className="info-banner">An admin will review this before it appears in the Tree. Follow its status in Creation requests.</div>}
      {!editing && (type !== 'community' || community?.role === 'owner') && <p className="small-text muted">Creators can manage their own {label.toLowerCase()}. Tree-wide settings stay with Tree admins.</p>}
      <AvatarEditor name={name || label} value={avatarId} onChange={setAvatarId} />
      <Field label={`${label} name`}><input name="name" value={name} onChange={e => setName(e.target.value)} placeholder={type === 'community' ? 'e.g. The Neighborhood' : type === 'subcommunity' ? 'e.g. Tree life' : 'e.g. The daily catch-up'} required maxLength={80} /></Field>
      <Field label="Description" hint="A short introduction helps everyone feel at home."><textarea name="description" defaultValue={entity?.description} placeholder="What brings you together?" maxLength={500} rows={3} /></Field>
      {type === 'group' && (!editing || community.is_admin) && <Field label="Branch (optional)" hint={editing ? 'Moving a Nest changes which Branch admins inherit access. Existing Nest members and Nest admins keep access.' : 'Leave at Tree level, or place this Nest in a Branch.'}><select value={location} onChange={e => setLocation(e.target.value)}>
        <option value="">Tree level · no Branch</option>
        {community.subcommunities.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></Field>}
      {type === 'community' && editing && <div className="settings-section"><h4>Member creation</h4>
        <p className="muted small-text">Everyone can add Branches and Nests. Require a review first, or let members create immediately. Admins create directly within the areas they manage. Changing this does not approve existing requests.</p>
        <Toggle label="Require approval for Branches" description="Tree admins review new Branch requests." checked={branchApproval} onChange={setBranchApproval} />
        <Toggle label="Require approval for Nests" description="Tree admins, or admins of the selected Branch, review new Nest requests." checked={nestApproval} onChange={setNestApproval} />
      </div>}
      {type === 'group' && <div className="settings-section"><h4>Make it your own</h4>
        <Toggle label="Private Nest" description="Only admins can invite people. Hidden from everyone else." checked={privateCircle} onChange={setPrivate} />
        <Toggle label="Only admins can post" description="Members can read. Only admins can send messages or replies." checked={adminOnly} onChange={setAdminOnly} />
      </div>}
    </Form>
    {editing && (type !== 'community' || community?.role === 'owner') && <div className="delete-space-section"><h4>Delete this {label.toLowerCase()}</h4><p>{type === 'community' ? 'Permanently remove this Tree, all Branches, Nests and conversations for everyone.' : type === 'subcommunity' ? 'Remove the Branch and keep its Nests at Tree level.' : 'Remove this Nest and its chat history for everyone.'}</p><button className="button danger-button" onClick={()=>setDeleting(true)}><Trash2 size={16}/>Delete {label}</button></div>}
    </>}
  </Modal>;
}
function DeleteSpaceForm({ type, entity, onCancel, onDeleted }) {
  const tree=type === 'community', branch=type === 'subcommunity', label=tree ? 'Tree' : branch ? 'Branch' : 'Nest';
  const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const same=confirmation === entity.name;
  return <form className="form delete-space-confirm" onSubmit={async e=>{
    e.preventDefault();if(busy || !same)return;
    setBusy(true);setError('');
    try {
      const result=await api(`/${tree ? 'communities' : branch ? 'subcommunities' : 'groups'}/${entity.id}`,{method:'DELETE',body:{confirm_name:confirmation}});
      await onDeleted(result);
    } catch(err){setError(err.message);}finally{setBusy(false);}
  }}>
    <div className="deletion-warning"><strong>{tree ? 'This permanently deletes the entire Tree for everyone.' : branch ? 'Your Nests and conversations will be kept.' : 'This removes the Nest and its chat history for everyone.'}</strong>
      <p>{tree ? 'All Branches, Nests, messages, replies, memberships, invitations and requests in this Tree will be removed. Accounts and other Trees remain available. This action cannot be undone.' : branch ? 'Its Nests move to Tree level, keeping their messages, members, privacy, pins and mute preferences. Branch admin roles are removed; explicit Nest admins and Tree admins keep their rights. Pending Nest requests in this Branch are cancelled.' : 'Messages, replies, memberships, invitations, unread indicators and pinned preferences for this Nest will be removed. This action cannot be undone.'}</p>
    </div>
    <Field label={`Type “${entity.name}” to confirm`} hint="Enter the name exactly as shown."><input autoFocus value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off" disabled={busy}/></Field>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="button-row"><button className="button secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="button danger-button" type="submit" disabled={busy || !same}><Trash2 size={16}/>{busy ? 'Deleting…' : `Delete ${label}`}</button></div>
  </form>;
}
export function InviteDialog({ community, group, onClose }) {
  const [link, setLink] = useState(''), [copied, setCopied] = useState(false);
  return <Modal title={`Invite to ${group ? 'Nest' : 'Tree'}`} subtitle={`Good conversations are better with company. Invite someone to ${group?.name || community.name}.`} onClose={onClose}>
    <div className="invite-art"><UserPlus size={35} strokeWidth={1.5} /><span>Make a little more room.</span></div>
    {group && <div className="info-banner">Nest invitations work for existing Tree members. Invite someone to the Tree first if they haven’t joined yet.</div>}
    {!link ? <Form submit="Create invitation link" onSubmit={async () => {
      const result = await post('/invitations', { community_id: community.id, group_id: group?.id });
      setLink(`${window.location.origin}${result.path}`);
    }}><p className="muted">Anyone with the link can join. Links expire after 7 days and grant member access only.</p></Form> : <div className="form"><Field label="Your invitation link"><div className="copy-field"><input value={link} readOnly aria-label="Invitation link" onFocus={e => e.target.select()} /><button className="icon-button" aria-label="Copy invitation link" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* input can be manually copied */ } }}>{copied ? <Check size={19} /> : <Copy size={19} />}</button></div></Field><p className="muted small-text">{copied ? 'Copied! Share it with someone you’d like to invite.' : 'Share this link privately. It expires in 7 days.'}</p></div>}
  </Modal>;
}
export function JoinDialog({ onClose, onJoin, initialToken = '' }) {
  return <Modal title="Come on in." subtitle="Have an invitation? There’s a place waiting for you." onClose={onClose}>
    <div className="invite-art"><Link size={34} strokeWidth={1.5} /><span>Every connection starts somewhere.</span></div>
    <Form submit="Accept invitation" onSubmit={async form => {
      let value = form.get('invitation').trim();
      try { value = new URL(value).searchParams.get('invite') || value; } catch { /* raw token */ }
      await onJoin(value); onClose();
    }}><Field label="Invitation link" name="invitation" placeholder="Paste your invitation link" defaultValue={initialToken} required /></Form>
  </Modal>;
}
export function ProfileDialog({ user, config, onClose, onSave, onAccountUpdate, onLogout, notify }) {
  const [avatarId, setAvatarId] = useState(user.avatar_id), [pushState, setPushState] = useState('');
  const [birdId, setBirdId] = useState(user.bird_id || 'blue'), [avatarStyle,setAvatarStyle] = useState(user.avatar_style || 'photo');
  const [unlocked,setUnlocked] = useState(user.unlocked_birds || ['blue','gold']);
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(async r => setSubscribed(!!await r.pushManager?.getSubscription())); }, []);
  async function enablePush() {
    try {
      if (!config.vapidPublicKey) throw new Error('Device notifications are awaiting server setup. Your Nest unread indicators still work.');
      if (!('PushManager' in window) || !window.isSecureContext) throw new Error('Device notifications need a supported browser and HTTPS. On iPhone, add Churp to your Home Screen first.');
      const allowed = await Notification.requestPermission(); setPermission(allowed);
      if (allowed !== 'granted') throw new Error('Notifications are blocked. You can allow them in your browser’s site settings.');
      const registration = await navigator.serviceWorker.ready;
      const raw = atob(config.vapidPublicKey.replaceAll('-', '+').replaceAll('_', '/'));
      const applicationServerKey = Uint8Array.from(raw, c => c.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      await post('/push/subscribe', { subscription: subscription.toJSON() });
      setSubscribed(true); setPushState('Device notifications are on for this browser.');
    } catch (error) { setPushState(error.message); }
  }
  async function disablePush() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) { await api('/push/subscribe', { method: 'DELETE', body: { endpoint: subscription.endpoint } }); await subscription.unsubscribe(); }
      setSubscribed(false); setPushState('Device notifications are off for this browser.');
    } catch (error) { setPushState(error.message); }
  }
  return <Modal title="Your little corner." subtitle="Make yourself at home." onClose={onClose}>
    <Form submit="Save profile" onSubmit={async form => { await onSave({ name: form.get('name'), avatar_id: avatarId, bird_id:birdId, avatar_style:avatarStyle }); notify('Profile updated. Looking good!'); onClose(); }}>
      <div className="profile-bird-preview"><Avatar name={user.name} id={avatarId} birdId={avatarStyle === 'bird' ? birdId : undefined} size={76}/><div><strong>{getBird(birdId)?.name}</strong><p className="muted small-text">Your companion in every Tree.</p></div></div>
      <BirdPicker selected={avatarStyle === 'bird' ? birdId : null} unlocked={unlocked} onSelect={id=>{setBirdId(id);setAvatarStyle('bird');}}/>
      <details className="profile-photo-option" open={avatarStyle === 'photo'}><summary>Use a profile photo instead</summary><p className="muted small-text">Your selected bird will still join you in the banner.</p><AvatarEditor name={user.name} value={avatarId} onChange={id=>{setAvatarId(id);setAvatarStyle('photo');}}/>{avatarId && <button type="button" className="text-button" onClick={()=>setAvatarStyle('photo')}>Use this photo</button>}</details>
      <Field label="Display name" name="name" defaultValue={user.name} required maxLength={80} /><Field label="Username" value={user.username} disabled />
    </Form>
    <div className="settings-section bird-unlock"><h4>Grow your bird collection</h4>
      {unlocked.length < 12 ? <Form submit="Redeem code" onSubmit={async form=>{
        const result=await post('/me/birds/unlock',{code:form.get('code')});setUnlocked(result.user.unlocked_birds);onAccountUpdate(result.user);notify('All 12 birds are unlocked. Choose your favorite and save your profile.');
      }}><p className="muted small-text">Have an unlock code? Add more birds to your collection.</p><Field label="Unlock code" name="code" autoComplete="off" required maxLength={64}/></Form> : <p className="bird-unlocked-message" role="status"><Check size={16}/>All 12 birds are unlocked for your account.</p>}
      <button className="button secondary small" disabled>Purchases coming soon</button>
    </div>
    <EncryptionSettings/><div className="settings-section"><h4><BellRing size={17} /> Stay in the loop</h4><p className="muted small-text">Joined Nests show unread indicators. Enable device notifications for alerts, or mute an individual Nest to take a breather.</p>
      <button className="button secondary" onClick={subscribed ? disablePush : enablePush}>{subscribed ? <BellOff size={16} /> : <BellRing size={16} />}{subscribed ? 'Turn off device notifications' : 'Enable device notifications'}</button>
      {!config.vapidPublicKey && <p className="small-text muted">Device push is awaiting server configuration.</p>}{pushState && <p className="info-banner" role="status">{pushState}</p>}
    </div><button className="text-button danger logout" onClick={onLogout}><LogOut size={17} /> Sign out of Churp</button>
  </Modal>;
}
export function MembersDialog({ community, user, onClose, onRefresh, notify }) {
  const [members, setMembers] = useState([]), [assignments, setAssignments] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(null), [scope, setScope] = useState('community'), [confirm, setConfirm] = useState(null);
  const scopes = [...community.circles.filter(g => !g.subcommunity_id).map(g => ({ type: 'group', id: g.id, name: g.name, can: community.is_admin })), ...community.subcommunities.flatMap(s => [{ type: 'subcommunity', id: s.id, name: s.name, can: community.is_admin }, ...s.groups.map(g => ({ type: 'group', id: g.id, name: `${s.name} / ${g.name}`, can: s.is_admin }))])];
  async function load() { try { const data = await api(`/communities/${community.id}/members`); setMembers(data.members); setAssignments(data.assignments); } catch (err) { setError(err.message); } }
  useEffect(() => { load(); }, [community.id]);
  async function action(fn, message) {
    setBusy(true); setError(''); try { await fn(); await load(); await onRefresh(); notify(message); setConfirm(null); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const currentTarget = members.find(m => m.id === target);
  return <Modal title="The people make the place." subtitle={`${community.name} · ${members.length} ${members.length === 1 ? 'member' : 'members'}`} onClose={onClose} wide>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="member-list">{members.map(m => <div className="member-row" key={m.id}>
      <Avatar name={m.name} id={m.avatar_id} birdId={m.avatar_style === 'bird' ? m.bird_id : undefined} /><div className="member-name"><strong>{m.name} {m.id === user.id && <small>(you)</small>}</strong><small>@{m.username}</small></div>
      <span className={`role-badge ${m.role}`}>{m.role === 'owner' ? <Crown size={12} /> : m.role === 'admin' ? <Shield size={12} /> : null}{m.role}</span>
      {(community.is_admin || scopes.some(s => s.can)) && m.role !== 'owner' && m.id !== user.id && <button className="button secondary small" onClick={() => { setTarget(m.id); setScope(community.role === 'owner' ? 'community' : scopes.find(s => s.can) ? `${scopes.find(s => s.can).type}:${scopes.find(s => s.can).id}` : ''); }}>Manage</button>}
    </div>)}</div>
    {!members.length && !error && <p className="muted">Loading members…</p>}
    {currentTarget && <div className="member-management"><h4>Manage {currentTarget.name}</h4><Field label="Admin scope"><select value={scope} onChange={e => setScope(e.target.value)}>
      {community.role === 'owner' && <option value="community">Entire Tree</option>}{scopes.filter(s => s.can).map(s => <option key={s.id} value={`${s.type}:${s.id}`}>{s.type === 'group' ? 'Nest' : 'Branch'}: {s.name}</option>)}
    </select></Field><p className="muted small-text">Admins manage the selected space and everything beneath it.</p>
      {scope && <button className="button secondary" disabled={busy} onClick={() => {
        if (scope === 'community') action(() => patch(`/communities/${community.id}/members/${target}`, { role: currentTarget.role === 'admin' ? 'member' : 'admin' }), 'Tree role updated.');
        else { const [type, id] = scope.split(':'); const enabled = !assignments.some(a => a.scope_type === type && a.scope_id === id && a.user_id === target); action(() => api(`/admins/${type}/${id}/${target}`, { method: 'PUT', body: { enabled } }), 'Admin assignment updated.'); }
      }}><Shield size={16} />{(scope === 'community' ? currentTarget.role === 'admin' : assignments.some(a => `${a.scope_type}:${a.scope_id}` === scope && a.user_id === target)) ? 'Remove admin rights' : 'Appoint as admin'}</button>}
      {community.role === 'owner' && <button className="text-button" disabled={busy} onClick={() => setConfirm({ type: 'transfer', member: currentTarget })}><Crown size={15} /> Transfer Tree ownership</button>}
      {community.is_admin && (currentTarget.role !== 'admin' || community.role === 'owner') && <button className="text-button danger" disabled={busy} onClick={() => setConfirm({ type: 'remove', member: currentTarget })}><Trash2 size={15} /> Remove from Tree</button>}
    </div>}
    {confirm && <div className="confirmation" role="alert"><strong>{confirm.type === 'transfer' ? `Make ${confirm.member.name} the owner?` : `Remove ${confirm.member.name}?`}</strong><p>{confirm.type === 'transfer' ? 'They will control this Tree and its admins. You will remain a Tree admin.' : 'They will lose access to the Tree and all of its Nests. A new invitation will be needed to rejoin.'}</p><div className="button-row"><button className="button secondary" onClick={() => setConfirm(null)}>Cancel</button><button className="button danger-button" disabled={busy} onClick={() => action(async () => { if (confirm.type === 'transfer') await post(`/communities/${community.id}/transfer`, { user_id: confirm.member.id }); else await api(`/communities/${community.id}/members/${confirm.member.id}`, { method: 'DELETE' }); setTarget(null); }, confirm.type === 'transfer' ? 'Ownership transferred.' : 'Member removed.')}>{busy ? 'Working…' : 'Confirm'}</button></div></div>}
  </Modal>;
}
