import React, { useEffect, useRef, useState } from 'react';
import { api, post } from './api';
import { Field, Modal } from './components';
import { useNestScope, NestFilter } from './RecipientFilters';
import { ScheduleFields, ScheduleSummary, initialSchedule } from './ScheduleControls';
import { queueScheduled, localDate,scheduleZone } from './scheduled-client';
import { scheduleTime } from '../shared/scheduling';
import { sealPrivate } from './encryption/client';
import { hasFirstNameToken, personalizeMessage } from '../shared/personalization';
import UsernameContact from './UsernameContact';
import PersonalizedMessageField from './PersonalizedMessageField';
import {isMobileMessagingDevice} from './message-keyboard';

export default function ComposeMessage({ user, source, single, phoneFirst, onClose, onStart, onDone, onPhoneDraft }) {
  const [when, setWhen] = useState(() => initialSchedule());
  const [trees, setTrees] = useState([]), [tree, setTree] = useState(source?.community_id || ''), [nest, setNest] = useState('');
  const scope = useNestScope(tree);
  const [people, setPeople] = useState(null), [contacts, setContacts] = useState(null), [selected, setSelected] = useState([]), [search, setSearch] = useState(''), [category, setCategory] = useState(phoneFirst ? 'contacts' : 'members');
  const [step, setStep] = useState(0), [body, setBody] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [results, setResults] = useState([]), [phoneId, setPhoneId] = useState(null);
  const pending = useRef(new Map()), phoneRequest = useRef(null), phoneResult = useRef(null), scheduled = useRef(false);
  const confirmButton=useRef(null);
  useEffect(()=>{if(step===2&&!isMobileMessagingDevice())confirmButton.current?.focus({preventScroll:true});},[step]);
  useEffect(() => { let active = true; Promise.all([api('/private/people'), api('/contacts'), source ? api(`/groups/${source.id}/individual-recipients`) : Promise.resolve(null)]).then(([p, c, s]) => { if (active) { setPeople(p.people); setTrees(p.trees || []); setContacts(c); if (s) setSelected(s.people.map(p => `u:${p.id}`)); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [source?.id]);
  const all = new Map((people || []).map(p => [`u:${p.id}`, { key: `u:${p.id}`, id: p.id, name: p.name, channel: 'Churp', tree_ids: p.tree_ids, blocked: !!p.messaging_blocked||!!p.requires_parent_approval&&!p.can_introduce, reason: p.messaging_blocked?'Conversation blocked':p.requires_parent_approval ? p.can_introduce?'First message goes to linked parents for review':'Awaiting parent approval' : '' }]));
  for (const c of contacts?.contacts || []) {
    const key = c.linked_user_id ? `u:${c.linked_user_id}` : `c:${c.id}`;
    if (!all.has(key)) all.set(key, c.linked_user_id ? { key, name: c.name, blocked: true, reason: 'Churp account setup required', channel: 'Unavailable' } : { key, contactId: c.id, name: c.name, phone: c.phone, channel: 'Phone', blocked: !c.phone || !!user.family?.protected, reason: user.family?.protected ? 'Phone drafts are for adult accounts' : !c.phone ? 'Add a phone number first' : '' });
  }
  const chosen = selected.map(key => all.get(key)).filter(Boolean), eligible = chosen.filter(r => r.id && !r.blocked), phones = chosen.filter(r => r.contactId && !r.blocked), unavailable = chosen.filter(r => r.blocked);
  let rows = [...all.values()];
  if (category === 'members') rows = rows.filter(r => r.id);
  else { let cs = contacts?.contacts || []; if (category !== 'contacts') { const ids = new Set(contacts?.memberships.filter(m => m.birdhouse_id === category).map(m => m.contact_id)); cs = cs.filter(c => ids.has(c.id)); } const keys = new Set(cs.map(c => c.linked_user_id ? `u:${c.linked_user_id}` : `c:${c.id}`)); rows = rows.filter(r => keys.has(r.key)); }
  rows = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) && (!tree || r.channel === 'Phone' || r.tree_ids?.includes(tree)) && (!nest || scope.nests.find(n => n.id === nest)?.member_ids.includes(r.id)));
  function change() { pending.current.clear(); phoneRequest.current = null; phoneResult.current = null; scheduled.current = false; setResults([]); setPhoneId(null); }
  function review(){try{chosen.filter(r=>!r.blocked).forEach(r=>personalizeMessage(body,r.name));setError('');setStep(2);}catch(e){setError(e.message);}}
  async function send() {
    setBusy(true); setError('');
    const outcome = results.filter(r => ['Sent', 'Scheduled','Awaiting parent approval'].includes(r.status) && r.id);
    try {
      const readyAt = when.enabled ? scheduleTime(new Date(when.sendAt).getTime()) : null;
      if (when.enabled && localDate(readyAt) !== when.sendAt.slice(0, 16)) throw new Error('That local time does not exist because the clocks change. Choose another time.');
      if (phones.length && !phoneResult.current) {
        if (!phoneRequest.current) phoneRequest.current = { client_id: crypto.randomUUID(), contact_ids: phones.map(r => r.contactId), body, tree_id: tree || null, source_nest: source?.id || null, filter_nest: nest || null, ready_at: readyAt,recurrence:when.recurrence||null,time_zone:scheduleZone() };
        phoneResult.current = await post('/phone-drafts', phoneRequest.current); setPhoneId(phoneResult.current.id);
      }
      if (when.enabled && eligible.length && !scheduled.current) {
        const entries = [], names = {};
        for (const r of eligible) { const c = await post('/private/conversations', { user_id: r.id }); names[c.conversation.id] = r.name; entries.push({ channel: 'private', target_id: c.conversation.id, request: await sealPrivate(c.conversation.id, personalizeMessage(body,r.name), [], undefined, source?.id || null) }); }
        await queueScheduled(entries, { body, attachments: [], labels: eligible.map(r => r.name), personalization: {kind:'first-name',names} }, when); scheduled.current = true;
      }
      for (const recipient of eligible) {
        if (outcome.some(r => r.key === recipient.key)) continue;
        if (when.enabled) { outcome.push({ ...recipient, status: 'Scheduled' }); continue; }
        try {
          let draft = pending.current.get(recipient.key);
          if (!draft) { const c = await post('/private/conversations', { user_id: recipient.id }); draft = { id: c.conversation.id, sealed: await sealPrivate(c.conversation.id, personalizeMessage(body,recipient.name), [], undefined, source?.id || null) }; pending.current.set(recipient.key, draft); }
          const stored=await post(`/private/conversations/${draft.id}/messages`, draft.sealed); outcome.push({ ...recipient, status: stored.status==='pending_approval'?'Awaiting parent approval':'Sent' });
        } catch (e) { outcome.push({ ...recipient, status: 'Failed', error: e.message }); }
        setResults([...outcome]);
      }
      outcome.push(...phones.map(r => ({ ...r, status: when.enabled ? 'Phone reminder scheduled' : 'Phone draft ready' })), ...unavailable.map(r => ({ ...r, status: 'Unavailable', error: r.reason })));
      setResults(outcome); setStep(3); onDone();
    } catch (e) { setError(e.message); if (phoneResult.current) setError(`${e.message} Your phone drafts are already saved in Messages → Phone drafts. Retry here to finish the Churp messages.`); }
    finally { setBusy(false); }
  }
  const title = step === 0 ? single ? 'New Message' : 'Choose recipients' : step === 1 ? 'Write your message' : step === 2 ? 'Review & send' : 'Individual message results';
  return <Modal title={title} onClose={busy ? () => {} : onClose}>
    {source && <p className="small-text muted">From {source.name} · Nest members are selected individually.</p>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {!people ? <p role="status">Finding your people…</p> : step === 0 ? <>
      <p className="small-text muted">Churp members receive private Churp messages. Phone-only contacts get individual drafts for you to send from your own messaging app.</p>
      {single&&<UsernameContact onStart={onStart}/>}
      <div className="recipient-filters"><Field label="Tree"><select value={tree} onChange={e => { setTree(e.target.value); setNest(''); setSelected([]); change(); }}><option value="">All my Trees</option>{trees.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></Field>{tree && <NestFilter scope={scope} nest={nest} onChange={n => { setNest(n); setSelected([]); change(); }}/>}</div>
      <div className="recipient-categories"><button className={category === 'members' ? 'selected' : ''} onClick={() => setCategory('members')}>Members</button><button className={category === 'contacts' ? 'selected' : ''} onClick={() => setCategory('contacts')}>Contacts</button>{contacts?.birdhouses.map(b => <button className={category === b.id ? 'selected' : ''} key={b.id} onClick={() => setCategory(b.id)}>{b.name}</button>)}</div>
      <Field label="Find recipients" value={search} onChange={e => setSearch(e.target.value)}/>
      {!single&&<button type="button" className="text-button select-all-recipients" disabled={!rows.some(r=>!r.blocked)} onClick={()=>{const keys=rows.filter(r=>!r.blocked).map(r=>r.key);if(keys.length>500){setError('Choose a smaller set: you can send to 500 people at a time.');return;}setSelected(keys.every(key=>selected.includes(key))?selected.filter(key=>!keys.includes(key)):keys);setError('');change();}}>{rows.some(r=>!r.blocked)&&rows.filter(r=>!r.blocked).every(r=>selected.includes(r.key))?'Deselect All':'Select All'}</button>}
      <div className="selection-list">{rows.map(r => single ? <button key={r.key} className="personal-contact" disabled={r.blocked && !r.id} onClick={() => { if (r.id) onStart(r.id); else { setSelected([r.key]); setStep(1); } }}><strong>{r.name}</strong><small>{r.reason || (r.id ? 'Message in Churp' : 'Draft for your phone')}</small></button> : <label key={r.key}><input type="checkbox" disabled={r.blocked || (!selected.includes(r.key) && selected.length >= 500)} checked={selected.includes(r.key)} onChange={e => { setSelected(v => e.target.checked ? [...v, r.key] : v.filter(k => k !== r.key)); change(); }}/><span><strong>{r.name}</strong><small>{r.reason || (r.id ? 'Churp' : 'Your phone · you tap Send')}</small></span></label>)}</div>
      {!rows.length && <p className="personal-empty">No matching people. Add contacts or choose a different filter.</p>}
      {!single && <div className="personal-actions"><span>{chosen.length} selected</span><button className="button primary" disabled={!chosen.length} onClick={() => setStep(1)}>Next</button></div>}
    </> : step === 1 ? <>
      <p>{eligible.length} via Churp · {phones.length} phone drafts. Each person receives a separate message.</p>
      <PersonalizedMessageField label="Your message" value={body} onChange={value => { setBody(value); change(); }} onDesktopEnter={review} sendDisabled={busy||!body.trim()}/>
      <ScheduleFields value={when} onChange={v => { setWhen(v); change(); }} phoneDrafts={phones.length > 0}/>
      <div className="personal-actions"><button className="button secondary" onClick={() => setStep(0)}>Back</button><button className="button primary" disabled={!body.trim()} onClick={review}>Review</button></div>
    </> : step === 2 ? <>
      <p className="info-banner">{eligible.length} via Churp · {phones.length} drafts for your phone{unavailable.length ? ` · ${unavailable.length} unavailable` : ''}.</p><ScheduleSummary value={when}/>
      {hasFirstNameToken(body)&&<p className="small-text muted">Your template · each person’s version is shown below.</p>}
      <div className="message-preview">{body}</div>
      {phones.length > 0 && <p className="small-text muted">Phone drafts add your name and {tree ? 'a short invitation to the selected Tree' : 'a Churp sign-in link'}. You review each full text before opening Messages and tap Send yourself. Replies stay in your phone’s messaging app.{when.enabled ? ' At the scheduled time, Churp reminds you to open these drafts; it cannot send them automatically.' : ''}</p>}
      <div className="selection-list">{chosen.map(r => <div key={r.key}><strong>{r.name}</strong><small>{r.reason || (r.id ? 'Private Churp message' : 'Phone draft · manual Send required')}</small>{hasFirstNameToken(body)&&!r.blocked&&<p className="message-preview personalized-recipient-preview">{personalizeMessage(body,r.name)}</p>}</div>)}</div>
      <div className="personal-actions"><button className="button secondary" disabled={busy || !!phoneResult.current} onClick={() => setStep(1)}>Edit</button><button ref={confirmButton} className="button primary" disabled={busy || (!eligible.length && !phones.length)} onKeyDown={event=>{if(event.key==='Enter'&&event.repeat)event.preventDefault();}} onClick={send}>{busy ? 'Preparing…' : phones.length ? when.enabled ? 'Schedule messages & phone reminders' : 'Send Churp messages & prepare phone drafts' : `${when.enabled ? 'Schedule' : 'Send'} ${eligible.length} private messages`}</button></div>
      <p className="small-text muted">Sent means saved in the recipient’s Churp conversation. Awaiting parent approval means only the sender and linked parents can read the first message until approval. A phone draft is not a sent or delivered text.</p>
    </> : <>
      <div className="selection-list">{results.map(r => <div key={r.key}><strong>{r.name} · {r.status}</strong>{r.error && <small>{r.error}</small>}</div>)}</div>
      {results.some(r => r.status === 'Failed') && <button className="button secondary" disabled={busy} onClick={send}>Retry failed messages</button>}
      {phoneId && <button className="button primary" onClick={() => onPhoneDraft(phoneId)}>Open phone drafts</button>}
      <button className="button secondary" disabled={busy} onClick={onClose}>Done</button>
    </>}
  </Modal>;
}
