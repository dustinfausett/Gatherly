import React, { useEffect, useState } from 'react';
import { ArrowLeft, Copy, Smartphone } from 'lucide-react';
import { api, post, patch } from './api';
import { Field, Form, Modal } from './components';
import { NavigationArt } from './Contacts';
import { ScheduleFields, initialSchedule } from './ScheduleControls';
import { scheduleLabel,scheduleZone } from './scheduled-client';
import { phoneTextUrl, phoneDraftState } from '../shared/phone-drafts';
import MessageText from './MessageText';
import './phone-drafts.css';
import PersonalizedMessageField,{RecipientMessagePreview} from './PersonalizedMessageField';
import {hasFirstNameToken} from '../shared/personalization';

export function usePhoneDrafts(version) {
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => api('/phone-drafts').then(r => { if (active) { setRows(r.drafts); setError(''); } }).catch(e => { if (active) setError(e.message); });
    load(); const timer = setInterval(load, 15000); return () => { active = false; clearInterval(timer); };
  }, [version, revision]);
  return { rows, error, reload: () => setRevision(n => n + 1) };
}
export function PhoneDraftCards({ state, onOpen, scheduledOnly = false, all = false }) {
  const rows = (state.rows || []).filter(r => (!scheduledOnly || r.reminder) && (all || !['cancelled', 'complete'].includes(r.status)));
  return <section className="phone-draft-cards" aria-label="Saved phone drafts">
    {state.error && <p className="error-banner" role="alert">{state.error}<button className="text-button" onClick={state.reload}>Retry</button></p>}
    {state.rows === null ? <p role="status">Loading phone drafts…</p> : rows.map(row => <button className={`phone-draft-card ${row.status === 'scheduled' ? 'is-scheduled' : ''}`} key={row.id} onClick={() => onOpen(row.id)}>
      <span className="phone-draft-card-heading"><Smartphone size={19}/><strong>{row.recipients.map(r => r.name).join(', ')}</strong></span>
      <small>{({ ready: 'Ready for your phone', scheduled: 'Phone reminder scheduled', needs_review: 'Needs review', cancelled: 'Cancelled', complete: 'Finished' })[row.status]} · {scheduleLabel(row.ready_at)}</small>
      <p>{row.body.slice(0, 180)}</p><small>{row.recipients.filter(r => r.state === 'done').length} marked sent by you · {row.recipients.length} phone drafts</small>
    </button>)}
    {state.rows !== null && !rows.length && <p className="personal-empty">No {scheduledOnly ? 'phone reminders' : 'phone drafts'} here yet.</p>}
  </section>;
}
export default function PhoneDrafts({ version, initialId, onBack, onNew, onOpened }) {
  const state = usePhoneDrafts(version), [current, setCurrent] = useState(initialId || null), [all, setAll] = useState(false);
  useEffect(() => { if (initialId) { setCurrent(initialId); onOpened?.(); } }, [initialId]);
  return <div className="phone-drafts-page">
    <button className="text-button" onClick={onBack}><ArrowLeft size={17}/>Churp chats</button>
    <div className="personal-heading"><div><span className="eyebrow">A LITTLE HELP REACHING YOUR PEOPLE</span><h1>Phone drafts</h1><p>Write in Churp. Send from your own phone.</p></div><NavigationArt kind="broadcast"/></div>
    <p className="info-banner">Open one person’s draft in your messaging app, then tap Send. Replies stay there. Churp cannot send these automatically or confirm delivery.</p>
    <div className="personal-actions"><button className="button primary" onClick={onNew}>Prepare phone texts</button><button className="text-button" onClick={() => setAll(v => !v)}>{all ? 'Show unfinished' : 'Show all drafts'}</button></div>
    <PhoneDraftCards state={state} all={all} onOpen={setCurrent}/>
    {current && <PhoneDraftDialog id={current} onClose={() => { setCurrent(null); state.reload(); }} onChanged={state.reload}/>}
  </div>;
}
export function PhoneDraftDialog({ id, onClose, onChanged }) {
  const [row, setRow] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [prepared, setPrepared] = useState(null), [editing, setEditing] = useState(false), [notice, setNotice] = useState('');
  const [reviewExpired,setReviewExpired]=useState(false);
  const [body, setBody] = useState(''), [when, setWhen] = useState(() => initialSchedule());
  async function load() { const r = await api(`/phone-drafts/${id}`); setRow(r); return r; }
  useEffect(() => { load().catch(e => setError(e.message)); }, [id]);
  useEffect(() => { if (prepared || editing) return; const timer = setInterval(() => load().catch(e => setError(e.message)), 15000); return () => clearInterval(timer); }, [id, prepared, editing]);
  useEffect(() => { setReviewExpired(false); if (!prepared) return; const timer = setTimeout(() => setReviewExpired(true), 60000); return () => clearTimeout(timer); }, [prepared]);
  async function act(fn) { if (busy) return; setBusy(true); setError(''); try { await fn(); onChanged?.(); } catch (e) { setError(e.message); await load().catch(() => {}); } finally { setBusy(false); } }
  async function mark(recipient, state) { return patch(`/phone-drafts/${id}/recipient`, { expected_version: row.version, contact_id: recipient.contact_id, state }); }
  const canEdit = row && !row.cancelled && row.recipients.every(r => !['done', 'opened'].includes(r.state));
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return <Modal title={editing ? 'Edit phone drafts' : prepared ? `Text ${prepared.name}` : 'Your phone drafts'} onClose={busy ? () => {} : onClose}>
    {error && <p className="error-banner" role="alert">{error}</p>}{notice && <p className="info-banner" role="status">{notice}</p>}
    {!row ? <p role="status">Opening your saved draft…</p> : editing ? <Form submit="Save phone drafts" onSubmit={async () => {
      const result = await api(`/phone-drafts/${id}`, { method: 'PUT', body: { expected_version: row.version, body, contact_ids: row.recipients.map(r => r.contact_id), tree_id: row.tree_id, source_nest: row.source_nest, filter_nest: row.filter_nest, recurrence:when.recurrence||null,time_zone:scheduleZone(),ready_at: when.enabled ? new Date(when.sendAt).getTime() : null } });
      setRow(result); setEditing(false); onChanged?.(); setNotice('Phone drafts updated. Nothing has been sent.');
    }}><PersonalizedMessageField label="Phone draft message" value={body} onChange={setBody} required/>{hasFirstNameToken(body)&&<div className="selection-list">{row.recipients.map(r=><div key={r.contact_id}><strong>{r.name}</strong><RecipientMessagePreview body={body} name={r.name}/></div>)}</div>}<ScheduleFields value={when} onChange={setWhen} phoneDrafts/><button type="button" className="text-button" onClick={() => setEditing(false)}>Cancel edit</button></Form> : prepared ? <>
      <p className="small-text muted">{prepared.phone} · One recipient only</p>
      <div className="message-preview phone-text-preview"><MessageText text={prepared.text}/></div>
      <p className="small-text muted">This leaves Churp. Check the recipient and text in your messaging app, then tap Send. Replies go to your own number.</p>
      {reviewExpired?<button className="button primary" disabled={busy} onClick={()=>act(async()=>{const latest=await load();setPrepared(await post(`/phone-drafts/${id}/prepare`,{contact_id:prepared.contact_id,expected_version:latest.version}));})}>Refresh review to open Messages</button>:<a className="button primary phone-handoff" href={phoneTextUrl(prepared.phone, prepared.text, ios)} onClick={() => {
        // A real, directly tapped sms: link preserves iOS's user gesture. This
        // records only the request to open, never an inferred send/delivery.
        mark(prepared, 'opened').then(setRow).catch(e => setError(e.message));
      }}><Smartphone size={18}/>Open in Messages</a>}
      <CopyText label="Copy message" value={prepared.text}/><CopyText label="Copy number" value={prepared.phone}/>
      <details><summary>Messaging app did not open?</summary><p className="small-text muted">On a computer or unsupported browser, copy this text and number into your phone’s messaging app. You can also open Churp on your phone to finish.</p><Field label="Prepared phone text"><textarea readOnly rows={5} value={prepared.text} onFocus={e => e.target.select()}/></Field></details>
      <div className="personal-actions"><button className="button primary" disabled={busy} onClick={() => act(async () => { setRow(await mark(prepared, 'done')); setPrepared(null); setNotice('Marked sent by you. Churp cannot verify phone delivery.'); })}>I sent this text</button><button className="button secondary" disabled={busy} onClick={() => setPrepared(null)}>Back to recipients</button></div>
      <button className="text-button" disabled={busy} onClick={()=>act(async()=>{setRow(await mark(prepared,'ready'));setPrepared(null);setNotice('Kept as an unsent draft. You can edit it before trying again.');})}>I didn’t send it</button>
    </> : <>
      <p className="info-banner">{row.status === 'scheduled' ? `Reminder set for ${scheduleLabel(row.ready_at)}. Your phone still needs you to tap Send.` : row.cancelled ? 'This draft was cancelled. Previously copied or opened texts remain outside Churp.' : 'These are drafts, not sent texts. Open one at a time to avoid creating a group text.'}</p>
      <div className={`message-preview ${row.status === 'scheduled' ? 'phone-draft-faded' : ''}`}><MessageText text={row.body}/></div>
      <div className="selection-list phone-draft-recipients">{row.recipients.map(r => <article key={r.contact_id}><strong>{r.name}</strong><small>{r.phone} · {phoneDraftState(r.state)}</small>{r.reason && <p className="error-banner">{r.reason}</p>}{!row.cancelled && !['done', 'skipped'].includes(r.state) && <div className="personal-actions"><button className="button primary" disabled={busy || !!r.reason || row.ready_at > Date.now()} onClick={() => act(async () => { setNotice(''); setPrepared(await post(`/phone-drafts/${id}/prepare`, { contact_id: r.contact_id, expected_version: row.version })); })}>Review phone text</button><button className="text-button" disabled={busy || row.ready_at > Date.now()} onClick={() => act(async () => setRow(await mark(r, 'skipped')))}>Skip</button></div>}</article>)}</div>
      <div className="personal-actions">{canEdit&&(!row.series_id||row.ready_at>Date.now()) && <button className="button secondary" onClick={() => { setBody(row.body); setWhen(row.ready_at > Date.now() ? initialSchedule(row.ready_at,row.recurrence) : initialSchedule()); setEditing(true); setNotice(''); }}>Edit or reschedule</button>}{!row.cancelled && row.status !== 'complete' && <button className="text-button danger" disabled={busy} onClick={() => act(async () => { setRow(await post(`/phone-drafts/${id}/cancel`, { expected_version: row.version })); setNotice('Remaining phone drafts cancelled.'); })}>Cancel remaining drafts</button>}</div>
      <p className="small-text muted">Phone drafts use Churp-managed storage encryption. SMS/iMessage/RCS behavior and privacy depend on your phone and recipient; these texts do not have Churp’s E2EE shield.</p>
    </>}
  </Modal>;
}
function CopyText({ label, value }) {
  const [copied, setCopied] = useState(false), [fallback, setFallback] = useState(false);
  return <><button className="button secondary phone-copy" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setFallback(true); } }}><Copy size={16}/>{copied ? 'Copied' : label}</button>{fallback && <Field label={label}><textarea readOnly value={value} onFocus={e => e.target.select()}/></Field>}</>;
}
