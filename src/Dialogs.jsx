import React, { useEffect, useState } from 'react';
import { Check, CheckCheck, Copy, Crown, Link, LogOut, Shield, UserPlus, BellRing, BellOff, Trash2, ArrowRight, Users } from 'lucide-react';
import { api, post, patch } from './api';
import { Avatar, AvatarEditor, Empty, Field, Form, Modal, Toggle, formatTime } from './components';

export function SpaceDialog({ modal, community, onClose, onSave }) {
  const { type, entity, parent } = modal;
  const editing = !!entity;
  const [avatarId, setAvatarId] = useState(entity?.avatar_id || null);
  const [privateCircle, setPrivate] = useState(!!entity?.private);
  const [adminOnly, setAdminOnly] = useState(!!entity?.admin_only);
  const [name, setName] = useState(entity?.name || '');
  const [location, setLocation] = useState(entity?.subcommunity_id || parent?.id || '');
  const label = { community: 'Community', subcommunity: 'Group', group: 'Circle' }[type];
  return <Modal title={`${editing ? 'Edit' : 'Create a'} ${label}`} subtitle={type === 'community' ? 'Give your people a place to gather.' : type === 'subcommunity' ? 'A little organization for a growing Community.' : 'A dedicated space for a conversation.'} onClose={onClose}>
    <Form submit={editing ? 'Save changes' : `Create ${label}`} onSubmit={async form => {
      const payload = { name: form.get('name'), description: form.get('description') };
      if (type === 'group') Object.assign(payload, { private: privateCircle, admin_only: adminOnly, subcommunity_id: location || null });
      let result;
      if (editing) { payload.avatar_id = avatarId; result = await patch(`/${type === 'community' ? 'communities' : type === 'subcommunity' ? 'subcommunities' : 'groups'}/${entity.id}`, payload); }
      else {
        const url = type === 'community' ? '/communities' : type === 'subcommunity' ? `/communities/${community.id}/subcommunities` : `/communities/${community.id}/circles`;
        result = await post(url, payload);
        if (avatarId) {
          const item = result[type];
          await patch(`/${type === 'community' ? 'communities' : type === 'subcommunity' ? 'subcommunities' : 'groups'}/${item.id}`, { avatar_id: avatarId });
        }
      }
      await onSave(result, type); onClose();
    }}>
      <AvatarEditor name={name || label} value={avatarId} onChange={setAvatarId} />
      <Field label={`${label} name`}><input name="name" value={name} onChange={e => setName(e.target.value)} placeholder={type === 'community' ? 'e.g. The Neighborhood' : type === 'subcommunity' ? 'e.g. Community life' : 'e.g. The daily catch-up'} required maxLength={80} /></Field>
      <Field label="Description" hint="A short introduction helps everyone feel at home."><textarea name="description" defaultValue={entity?.description} placeholder="What brings you together?" maxLength={500} rows={3} /></Field>
      {type === 'group' && (!editing || community.is_admin) && <Field label="Group (optional)" hint={editing ? 'Moving a Circle changes which Group admins inherit access. Existing Circle members and Circle admins keep access.' : 'Leave at Community level, or place this Circle in a Group.'}><select value={location} onChange={e => setLocation(e.target.value)}>
        {community.is_admin && <option value="">Community level · no Group</option>}
        {community.subcommunities.filter(s => community.is_admin || s.is_admin).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></Field>}
      {type === 'group' && <div className="settings-section"><h4>Make it your own</h4>
        <Toggle label="Private Circle" description="Only admins can invite people. Hidden from everyone else." checked={privateCircle} onChange={setPrivate} />
        <Toggle label="Only admins can post" description="Members can read. Only admins can send messages or replies." checked={adminOnly} onChange={setAdminOnly} />
      </div>}
    </Form>
  </Modal>;
}
export function InviteDialog({ community, group, onClose }) {
  const [link, setLink] = useState(''), [copied, setCopied] = useState(false);
  return <Modal title={`Invite to ${group ? 'Circle' : 'Community'}`} subtitle={`Good conversations are better with company. Invite someone to ${group?.name || community.name}.`} onClose={onClose}>
    <div className="invite-art"><UserPlus size={35} strokeWidth={1.5} /><span>Make a little more room.</span></div>
    {group && <div className="info-banner">Circle invitations work for existing Community members. Invite someone to the Community first if they haven’t joined yet.</div>}
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
export function ProfileDialog({ user, config, onClose, onSave, onLogout, notify }) {
  const [avatarId, setAvatarId] = useState(user.avatar_id), [pushState, setPushState] = useState('');
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(async r => setSubscribed(!!await r.pushManager?.getSubscription())); }, []);
  async function enablePush() {
    try {
      if (!config.vapidPublicKey) throw new Error('Device notifications are awaiting server setup. Your in-app notifications already work.');
      if (!('PushManager' in window) || !window.isSecureContext) throw new Error('Device notifications need a supported browser and HTTPS. On iPhone, add Gatherly to your Home Screen first.');
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
    <Form submit="Save profile" onSubmit={async form => { await onSave({ name: form.get('name'), avatar_id: avatarId }); notify('Profile updated. Looking good!'); onClose(); }}>
      <AvatarEditor name={user.name} value={avatarId} onChange={setAvatarId} /><Field label="Display name" name="name" defaultValue={user.name} required maxLength={80} /><Field label="Username" value={user.username} disabled />
    </Form>
    <div className="settings-section"><h4><BellRing size={17} /> Stay in the loop</h4><p className="muted small-text">Joined Circles send in-app notifications. Mute any Circle to take a breather.</p>
      <button className="button secondary" onClick={subscribed ? disablePush : enablePush}>{subscribed ? <BellOff size={16} /> : <BellRing size={16} />}{subscribed ? 'Turn off device notifications' : 'Enable device notifications'}</button>
      {!config.vapidPublicKey && <p className="small-text muted">Device push is awaiting server configuration.</p>}{pushState && <p className="info-banner" role="status">{pushState}</p>}
    </div><button className="text-button danger logout" onClick={onLogout}><LogOut size={17} /> Sign out of Gatherly</button>
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
      <Avatar name={m.name} id={m.avatar_id} /><div className="member-name"><strong>{m.name} {m.id === user.id && <small>(you)</small>}</strong><small>@{m.username}</small></div>
      <span className={`role-badge ${m.role}`}>{m.role === 'owner' ? <Crown size={12} /> : m.role === 'admin' ? <Shield size={12} /> : null}{m.role}</span>
      {(community.is_admin || scopes.some(s => s.can)) && m.role !== 'owner' && m.id !== user.id && <button className="button secondary small" onClick={() => { setTarget(m.id); setScope(community.role === 'owner' ? 'community' : scopes.find(s => s.can) ? `${scopes.find(s => s.can).type}:${scopes.find(s => s.can).id}` : ''); }}>Manage</button>}
    </div>)}</div>
    {!members.length && !error && <p className="muted">Loading members…</p>}
    {currentTarget && <div className="member-management"><h4>Manage {currentTarget.name}</h4><Field label="Admin scope"><select value={scope} onChange={e => setScope(e.target.value)}>
      {community.role === 'owner' && <option value="community">Entire Community</option>}{scopes.filter(s => s.can).map(s => <option key={s.id} value={`${s.type}:${s.id}`}>{s.type === 'group' ? 'Circle' : 'Group'}: {s.name}</option>)}
    </select></Field><p className="muted small-text">Admins manage the selected space and everything beneath it.</p>
      {scope && <button className="button secondary" disabled={busy} onClick={() => {
        if (scope === 'community') action(() => patch(`/communities/${community.id}/members/${target}`, { role: currentTarget.role === 'admin' ? 'member' : 'admin' }), 'Community role updated.');
        else { const [type, id] = scope.split(':'); const enabled = !assignments.some(a => a.scope_type === type && a.scope_id === id && a.user_id === target); action(() => api(`/admins/${type}/${id}/${target}`, { method: 'PUT', body: { enabled } }), 'Admin assignment updated.'); }
      }}><Shield size={16} />{(scope === 'community' ? currentTarget.role === 'admin' : assignments.some(a => `${a.scope_type}:${a.scope_id}` === scope && a.user_id === target)) ? 'Remove admin rights' : 'Appoint as admin'}</button>}
      {community.role === 'owner' && <button className="text-button" disabled={busy} onClick={() => setConfirm({ type: 'transfer', member: currentTarget })}><Crown size={15} /> Transfer Community ownership</button>}
      {community.is_admin && (currentTarget.role !== 'admin' || community.role === 'owner') && <button className="text-button danger" disabled={busy} onClick={() => setConfirm({ type: 'remove', member: currentTarget })}><Trash2 size={15} /> Remove from Community</button>}
    </div>}
    {confirm && <div className="confirmation" role="alert"><strong>{confirm.type === 'transfer' ? `Make ${confirm.member.name} the owner?` : `Remove ${confirm.member.name}?`}</strong><p>{confirm.type === 'transfer' ? 'They will control this Community and its admins. You will remain a Community admin.' : 'They will lose access to the Community and all of its Circles. A new invitation will be needed to rejoin.'}</p><div className="button-row"><button className="button secondary" onClick={() => setConfirm(null)}>Cancel</button><button className="button danger-button" disabled={busy} onClick={() => action(async () => { if (confirm.type === 'transfer') await post(`/communities/${community.id}/transfer`, { user_id: confirm.member.id }); else await api(`/communities/${community.id}/members/${confirm.member.id}`, { method: 'DELETE' }); setTarget(null); }, confirm.type === 'transfer' ? 'Ownership transferred.' : 'Member removed.')}>{busy ? 'Working…' : 'Confirm'}</button></div></div>}
  </Modal>;
}
export function NotificationsDialog({ notifications, onClose, onOpen, onMarkRead }) {
  return <Modal title="A little heads-up." subtitle="Catch up on conversations in your joined Circles." onClose={onClose}>
    {notifications.length ? <><button className="text-button mark-all" onClick={onMarkRead}><CheckCheck size={16} /> Mark all as read</button><div className="notification-list">{notifications.map(n => <button key={n.id} className={`notification ${n.seen ? '' : 'unseen'}`} onClick={() => { onOpen(n.community_id, n.group_id); onClose(); }}><span className="notification-dot" /><div><strong>{n.sender} <small>in {n.group_name}</small></strong><p>{n.body || 'Shared an attachment'}</p><small>{new Date(n.created_at).toLocaleDateString()} · {formatTime(n.created_at)}</small></div><ArrowRight size={16} /></button>)}</div></> : <Empty icon={BellRing} title="You’re all caught up.">New messages from Circles you join will appear here. Muted Circles stay quiet.</Empty>}
  </Modal>;
}
