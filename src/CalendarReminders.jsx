import React, {useEffect, useState} from 'react';
import {api} from './api';

export const reminderLabel = minutes => minutes === 0 ? 'At the start' : minutes % 1440 === 0 ? `${minutes / 1440} day${minutes === 1440 ? '' : 's'} before` : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'} before` : `${minutes} minutes before`;
export function CalendarNotificationSettings() {
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  function assign(offsets) { setRows(offsets.map(n => ({amount: n % 60 === 0 ? n / 60 : n, unit: n % 60 === 0 ? 60 : 1}))); }
  useEffect(() => { let active = true; api('/calendar/notification-settings').then(r => {if (active) assign(r.offsets);}).catch(e => {if (active) setError(e.message);}); return () => {active = false;}; }, []);
  return <section className="settings-section calendar-notification-settings">
    <h4>Calendar event notifications</h4>
    <p className="small-text muted">Remind me before activities in Nests where I have notifications on. The default is 24 hours before each event. These settings apply on all my devices; device notifications must be enabled. You can also add a personal one-time reminder from an event’s details.</p>
    {rows && <form onSubmit={async e => {e.preventDefault();setBusy(true);setError('');setNotice('');try {const offsets = rows.map(r => Number(r.amount) * Number(r.unit)); const r = await api('/calendar/notification-settings', {method: 'PUT', body: {offsets}}); assign(r.offsets); setNotice('Calendar notification settings saved.');} catch (e) {setError(e.message);} finally {setBusy(false);}}}>
      <fieldset disabled={busy} className="calendar-reminder-fields"><legend className="visually-hidden">Default calendar reminders</legend>
        {rows.map((row, i) => <div className="calendar-reminder-row" key={i}>
          <input type="number" min="0" max={Math.floor(43200 / row.unit)} step="1" required aria-label={`Reminder ${i + 1} amount`} value={row.amount} onChange={e => setRows(rows.map((r,j) => j === i ? {...r,amount:e.target.value} : r))}/>
          <select aria-label={`Reminder ${i + 1} unit`} value={row.unit} onChange={e => setRows(rows.map((r,j) => j === i ? {...r,unit:Number(e.target.value)} : r))}><option value="1">minutes before</option><option value="60">hours before</option><option value="1440">days before</option></select>
          <button type="button" className="text-button danger" aria-label={`Remove reminder ${i + 1}`} onClick={() => setRows(rows.filter((_,j) => j !== i))}>Remove</button>
        </div>)}
        {!rows.length && <p>No default calendar reminders.</p>}
        <div className="calendar-actions"><button type="button" className="button secondary small" disabled={rows.length >= 5} onClick={() => setRows([...rows,{amount:1,unit:60}])}>Add reminder</button><button className="button primary small">Save calendar notifications</button></div>
      </fieldset>
    </form>}
    {!rows && !error && <p role="status">Loading calendar notifications…</p>}
    {error && <p role="alert" className="field-error">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
