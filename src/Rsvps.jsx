import {ScheduleFields,initialSchedule} from './ScheduleControls';
import {publishNest} from './scheduled-client';
import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, MapPin } from 'lucide-react';
import { Field, Modal } from './components';
import { api, patch, post } from './api';
import { useEncryption } from './encryption/EncryptionGate';
import { decryptMessages, sealEdit, sealMessage } from './encryption/client';
import { RSVP_CHOICES, encodeResponse, parseResponse, parseRsvp, responseSummary, validateResponse, validateRsvp } from '../shared/rsvps';
import './rsvps.css';
import { activityArtwork } from './activityArtwork';
import './activity-cards.css';

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const localInput = value => { if (!value) return ''; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export function eventDate(event) {
  if (event.allDay) {
    const format = d => new Date(d + 'T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return `${format(event.start)}${event.end && event.end !== event.start ? ` – ${format(event.end)}` : ''} · All day`;
  }
  const format = d => new Date(d).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return `${format(event.start)}${event.end ? ` – ${format(event.end)}` : ''}`;
}
export function RsvpBuilder({ group, message, onClose, onSent, initialValue=null, scheduledRecord=null }) {
  const [when,setWhen]=useState(()=>initialSchedule(scheduledRecord?.next_at||scheduledRecord?.send_at,scheduledRecord?.recurrence));
  const initial = initialValue || (message && parseRsvp(message.body)), { enabled } = useEncryption();
  const [title, setTitle] = useState(initial?.title || ''), [allDay, setAllDay] = useState(initial?.allDay || false);
  const [start, setStart] = useState(initial ? initial.allDay ? initial.start : localInput(initial.start) : ''), [end, setEnd] = useState(initial ? initial.allDay ? initial.end || '' : localInput(initial.end) : '');
  const [location, setLocation] = useState(initial?.location || ''), [description, setDescription] = useState(initial?.description || ''), [responseDeadline, setDeadline] = useState(localInput(initial?.responseDeadline));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const prepared = useRef(null), sent = useRef(false), saving = useRef(false);
  async function submit(e) {
    e.preventDefault(); if (busy || sent.current) return;
    setBusy(true); saving.current = true; setError('');
    try {
      const value = validateRsvp({ title, allDay, start: allDay ? start : start && new Date(start).toISOString(), end: end ? allDay ? end : new Date(end).toISOString() : null, location, description, timeZone: zone(), responseDeadline: responseDeadline ? new Date(responseDeadline).toISOString() : null });
      const body = JSON.stringify(value);
      if (prepared.current?.body !== body) prepared.current = { body, request: enabled ? message ? await sealEdit(message, body) : await sealMessage(group.id, body, [], null, null, 'rsvp') : { body, ...(message ? { expectedVersion: message.edit_version || 0 } : {}) } };
      const request = { ...prepared.current.request, response_deadline: value.responseDeadline };
      if (message) await api(`/messages/${message.id}/content`, { method: 'PUT', body: request });
      else await publishNest(group,{...request,message_kind:'rsvp'},{body,attachments:[]},when,scheduledRecord);
      await onSent(); sent.current = true; onClose();
    } catch (e) { if (e.status === 409) prepared.current = null; setError(e.message); } finally { saving.current = false; setBusy(false); }
  }
  return <Modal title={message ? 'Edit event' : 'Create an RSVP'} subtitle="A little invitation for your Nest." onClose={() => { if (!saving.current) onClose(); }} wide>
    <form className="form rsvp-builder" onSubmit={submit}><fieldset disabled={busy}>
      <Field label="Event title" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} placeholder="e.g. Our family picnic" required />
      <label className="rsvp-all-day"><input type="checkbox" checked={allDay} onChange={e => { setAllDay(e.target.checked); setStart(''); setEnd(''); }} />All day</label>
      <div className="rsvp-date-fields"><Field label={allDay ? 'Start date' : 'Start date and time'} type={allDay ? 'date' : 'datetime-local'} value={start} onChange={e => setStart(e.target.value)} required /><Field label={allDay ? 'End date (optional)' : 'End date and time (optional)'} type={allDay ? 'date' : 'datetime-local'} value={end} onChange={e => setEnd(e.target.value)} /></div>
      {!allDay && <p className="poll-help">Times entered in {zone()}. Members see the time in their own time zone.</p>}
      <Field label="Location or meeting link (optional)" value={location} onChange={e => setLocation(e.target.value)} maxLength={500} />
      <Field label="Description (optional)"><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={3000} /></Field>
      <Field label="Response deadline (optional)" type="datetime-local" value={responseDeadline} onChange={e => setDeadline(e.target.value)} />
      <p className="poll-help">Members can change their response until responses close. Going and Maybe each allow 0–99 additional guests. Invitations aren’t shared with later joiners.</p>
      {message && <p className="poll-help">Existing responses are kept. Members will see that the event was edited.</p>}
      {!message&&<ScheduleFields value={when} onChange={setWhen} forced={!!scheduledRecord}/>}
    </fieldset>{error && <div className="error-banner" role="alert">{error}</div>}<div className="form-footer"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy} type="submit">{busy ? 'Saving…' : message ? 'Save event' : scheduledRecord?'Save scheduled invitation':when.enabled?'Schedule invitation':'Send invitation'}</button></div></form>
  </Modal>;
}
function Hatch({ selected, mood }) {
  return <span className={`rsvp-hatch ${selected ? 'is-hatched' : ''}`} aria-hidden="true"><img className="rsvp-egg" src={activityArtwork.egg} alt="" width="80" height="80" /><img className="rsvp-hatchling" src={activityArtwork.hatchlings[mood]} alt="" width="80" height="80" /></span>;
}
export function RsvpDialog({ message, group, user, version, onClose }) {
  const { enabled } = useEncryption();
  const [data, setData] = useState(null), [choice, setChoice] = useState(''), [guests, setGuests] = useState('0'), [tab, setTab] = useState('invitation'), [list, setList] = useState('going');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [editing, setEditing] = useState(false), [cancelConfirm, setCancelConfirm] = useState(false), [now, setNow] = useState(Date.now());
  const dirty = useRef(false), prepared = useRef(null), active = useRef(true);
  async function read() {
    const result = await api(`/messages/${message.id}/rsvp`);
    const [latest] = enabled ? await decryptMessages(group.id, [result.message]) : [result.message];
    const event = !latest.decryptionError && parseRsvp(latest.body);
    if (!event || event.responseDeadline !== result.response_deadline) throw new Error('This invitation could not be verified. Try reopening it.');
    const decoded = enabled ? await decryptMessages(group.id, result.responses) : result.responses;
    const responses = decoded.map(m => ({ userId: m.user_id, name: m.name, ...(!m.decryptionError && parseResponse(m.body, message.id)) })).filter(r => r.choice);
    return { ...result, message: latest, event, responses, unverified: decoded.length !== responses.length };
  }
  function apply(result) {
    setData(result); setError('');
    if (!dirty.current) { const mine = result.responses.find(r => r.userId === user.id); setChoice(mine?.choice || ''); setGuests(String(mine?.guests || 0)); }
  }
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { let current = true; read().then(r => { if (current) apply(r); }).catch(e => { if (current) setError(e.message); }); return () => { current = false; }; }, [message.id, version]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const event = data?.event || parseRsvp(message.body), mine = data?.responses.find(r => r.userId === user.id);
  const closed = !data || data.closed || data.canceled || data.deadline_passed || (event?.responseDeadline && Date.parse(event.responseDeadline) <= now);
  async function submit() {
    if (busy || closed) return; setBusy(true); setError('');
    try {
      const response = validateResponse({ choice, guests: choice === 'declined' ? 0 : guests === '' ? NaN : Number(guests) });
      const body = encodeResponse(message.id, response), key = `${data.event_version}:${body}`;
      if (prepared.current?.key !== key) prepared.current = { key, request: enabled ? await sealMessage(group.id, body, [], message.id, null, 'rsvp_response') : { body, reply_to: message.id } };
      await post(`/messages/${message.id}/rsvp/respond`, { ...prepared.current.request, eventVersion: data.event_version });
      dirty.current = false; prepared.current = null; const result = await read(); if (active.current) apply(result);
    } catch (e) { if (e.status === 409) { prepared.current = null; try { apply(await read()); } catch {} } if (active.current) setError(e.message); } finally { if (active.current) setBusy(false); }
  }
  async function status(values) {
    if (busy) return; setBusy(true); setError('');
    try { await patch(`/messages/${message.id}/rsvp`, values); apply(await read()); setCancelConfirm(false); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  if (editing) return <RsvpBuilder group={group} message={data.message} onClose={() => setEditing(false)} onSent={async () => { apply(await read()); setEditing(false); }} />;
  if (!event) return <Modal title="Invitation unavailable" onClose={onClose}><p>This invitation could not be opened.</p></Modal>;
  const summary = responseSummary(data?.responses || []), selectedList = list === 'none' ? (data?.eligible || []).filter(u => !data.responses.some(r => r.userId === u.id)) : (data?.responses || []).filter(r => r.choice === list);
  return <Modal title={event.title} onClose={onClose} wide><div className="rsvp-view">
    {error && <div className="error-banner" role="alert">{error}<button type="button" className="text-button" onClick={() => read().then(apply).catch(e => setError(e.message))}>Try again</button></div>}
    {!data ? <p role="status">Opening invitation…</p> : <>
      {data.canceled && <p className="rsvp-canceled" role="status">Canceled · This event is no longer happening.</p>}
      <div className="rsvp-tabs" role="group" aria-label="Invitation views"><button className={tab === 'invitation' ? 'active' : ''} type="button" aria-pressed={tab === 'invitation'} onClick={() => setTab('invitation')}>Invitation</button><button className={tab === 'responses' ? 'active' : ''} type="button" aria-pressed={tab === 'responses'} onClick={() => setTab('responses')}>Responses</button></div>
      {tab === 'invitation' ? <>
        <p className="rsvp-event-detail"><CalendarDays size={19} /><span>{eventDate(event)}{!event.allDay && <small>Event time zone: {event.timeZone}</small>}</span></p>
        {event.location && <p className="rsvp-event-detail"><MapPin size={19} /><span>{/^https?:\/\/\S+$/i.test(event.location) ? <a href={event.location} target="_blank" rel="noreferrer">{event.location}</a> : event.location}</span></p>}
        {event.description && <p className="rsvp-description">{event.description}</p>}
        {event.responseDeadline && <p className="poll-help">Respond by {new Date(event.responseDeadline).toLocaleString()} ({zone()}).</p>}
        <fieldset className="rsvp-choices" disabled={busy || closed}><legend>Will you be there?</legend>{RSVP_CHOICES.map(c => <label key={c.id} className={`rsvp-choice ${choice === c.id ? 'is-selected' : ''}`}><input type="radio" name={`rsvp-${message.id}`} value={c.id} checked={choice === c.id} onChange={() => { dirty.current = true; setChoice(c.id); }} /><Hatch selected={choice === c.id} mood={c.mood} /><strong>{c.label}</strong></label>)}</fieldset>
        {['going', 'maybe'].includes(choice) && <div className="rsvp-guests"><Field label="Additional guests" hint="Do not include yourself. Enter 0 if you’re coming alone."><input type="number" min="0" max="99" step="1" inputMode="numeric" value={guests} disabled={busy || closed} onChange={e => { dirty.current = true; setGuests(e.target.value); }} /></Field><p>{choice === 'going' ? 'Going' : 'Maybe'} party: {guests !== '' && Number.isInteger(Number(guests)) && Number(guests) >= 0 && Number(guests) <= 99 ? Number(guests) + 1 : '—'} including you.</p></div>}
        <p className="poll-response-status" role="status">{closed ? data.canceled ? 'Responses are disabled for this canceled event.' : 'Responses are closed.' : mine ? `Your response is saved: ${RSVP_CHOICES.find(c => c.id === mine.choice).label}.${dirty.current ? ' You have unsaved changes.' : ''}` : 'Choose an egg, then save your response.'}</p>
        {!closed && <div className="form-footer"><button type="button" className="button primary" disabled={busy || !choice} onClick={submit}>{busy ? 'Saving…' : mine ? 'Update response' : 'Save response'}</button></div>}
      </> : <>
        <div className="rsvp-totals">{RSVP_CHOICES.map(c => <section key={c.id}><strong>{summary[c.id].total}</strong><span>{c.label}</span><small>{summary[c.id].members} {summary[c.id].members === 1 ? 'member' : 'members'}{c.id !== 'declined' && ` + ${summary[c.id].guests} guests`}</small></section>)}</div>
        <p className="poll-help">Going and Maybe totals are separate. Each includes the responding member and their additional guests.</p>
        {data.can_manage && <><div className="rsvp-response-filters" role="group" aria-label="Response lists">{[...RSVP_CHOICES, { id: 'none', label: 'No response' }].map(c => <button type="button" className={list === c.id ? 'active' : ''} aria-pressed={list === c.id} key={c.id} onClick={() => setList(c.id)}>{c.label}{c.id === 'none' ? ` (${data.eligible.filter(u => !data.responses.some(r => r.userId === u.id)).length})` : ''}</button>)}</div><ul className="rsvp-response-list">{selectedList.map(r => <li key={r.userId || r.id}><strong>{r.name}{(r.userId || r.id) === user.id ? ' (you)' : ''}</strong>{list !== 'none' && list !== 'declined' && <span>{r.guests} additional {r.guests === 1 ? 'guest' : 'guests'} · party of {r.guests + 1}</span>}</li>)}</ul>{!selectedList.length && <p className="poll-help">No members in this list yet.</p>}</>}
        {data.unverified && <p role="alert" className="field-error">Some responses could not be verified and are excluded from the totals. Try again to reload them.</p>}
      </>}
      <p className="poll-help">Responses are linked to members’ accounts and encrypted for the Nest. The creator and admins have a named response list in this view.</p>
      {data.can_manage && <div className="poll-manage rsvp-manage"><button type="button" className="text-button" disabled={busy} onClick={() => setEditing(true)}>Edit event</button><button type="button" className="text-button" disabled={busy || data.canceled || data.deadline_passed} onClick={() => status({ closed: !data.closed })}>{data.closed ? 'Reopen responses' : 'Close responses'}</button>{data.canceled ? <button type="button" className="text-button" disabled={busy} onClick={() => status({ canceled: false })}>Restore event</button> : <button type="button" className="text-button danger" disabled={busy} onClick={() => setCancelConfirm(true)}>Cancel event</button>}{cancelConfirm && <div className="inline-confirm"><span>Cancel this event?</span><button type="button" disabled={busy} onClick={() => status({ canceled: true })}>Yes, cancel event</button><button type="button" disabled={busy} onClick={() => setCancelConfirm(false)}>Keep event</button></div>}</div>}
    </>}
  </div></Modal>;
}
export function RsvpEnvelope({ message, group, user, version, onOpen }) {
  const event = parseRsvp(message.body), { enabled } = useEncryption();
  const [opening, setOpening] = useState(false), [open, setOpen] = useState(false), [ready, setReady] = useState(false), [status, setStatus] = useState(null);
  const timer = useRef(null), openArt = useRef(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  useEffect(() => { let active = true;
    api(`/messages/${message.id}/rsvp/status`).then(async r => { const decoded = enabled ? await decryptMessages(group.id, r.responses) : r.responses; const mine = decoded.find(m => m.user_id === user.id && !m.decryptionError); if (active) setStatus({ ...r, mine: mine && parseResponse(mine.body, message.id) }); }).catch(() => { if (active) setStatus(null); });
    return () => { active = false; };
  }, [message.id, version, enabled, user.id]);
  async function touch() {
    if (opening) return; setOpening(true);
    try { await openArt.current?.decode(); } catch {}
    if (!mounted.current) return;
    setReady(!!openArt.current?.naturalWidth);
    timer.current = setTimeout(() => { setOpening(false); onOpen ? onOpen(message) : setOpen(true); }, 250);
  }
  if (!event) return <p role="alert">This invitation could not be opened.</p>;
  return <div className="rsvp-card"><button type="button" className={`poll-envelope rsvp-envelope activity-card ${opening && ready ? 'is-opening' : ''}`} aria-label={`Open RSVP: ${event.title}`} aria-haspopup="dialog" aria-busy={opening} disabled={opening} onClick={touch}>
    <span className="activity-card-art"><img className="envelope-closed" src={activityArtwork.rsvp} alt="" width="1254" height="1254" /><img className="envelope-open" ref={openArt} src={activityArtwork.rsvpOpen} onLoad={() => setReady(true)} alt="" width="1254" height="1254" /></span><span className="activity-card-copy"><strong>{event.title}</strong><small className="rsvp-card-date">{eventDate(event)}</small>{status?.canceled ? <span className="rsvp-card-status canceled">Canceled</span> : status?.mine && <span className="rsvp-card-status">{status.mine.choice === 'going' ? 'You’re going' : status.mine.choice === 'maybe' ? 'You might go' : 'You can’t go'}</span>}</span>
  </button>
    {open && <RsvpDialog message={message} group={group} user={user} version={version} onClose={() => setOpen(false)} />}
  </div>;
}
