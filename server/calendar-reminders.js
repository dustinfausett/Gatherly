const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
export const DEFAULT_CALENDAR_OFFSETS = [1440];
export function calendarOffsets(value) {
  if (!Array.isArray(value) || value.length > 5 || value.some(n => !Number.isSafeInteger(n) || n < 0 || n > 43200)) fail(400, 'Choose up to five reminders, from the event start to 30 days before it.');
  return [...new Set(value)].sort((a, b) => b - a);
}

export function installCalendarReminders({app, db, readEvent, family, notify, now = Date.now, autoProcess = true}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_notification_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      offsets TEXT NOT NULL, changed_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS calendar_event_reminders (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      remind_at INTEGER NOT NULL, PRIMARY KEY(user_id,event_id));
    CREATE TABLE IF NOT EXISTS calendar_reminder_deliveries (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      occurrence TEXT NOT NULL, kind TEXT NOT NULL, timing INTEGER NOT NULL, sent_at INTEGER NOT NULL,
      PRIMARY KEY(user_id,event_id,occurrence,kind,timing));
  `);
  const one = (s, ...a) => db.prepare(s).get(...a), all = (s, ...a) => db.prepare(s).all(...a), run = (s, ...a) => db.prepare(s).run(...a);
  const eventRow = id => one(`SELECT e.*,g.community_id FROM calendar_events e JOIN groups g ON g.id=e.group_id WHERE e.id=?`, id);
  function accessible(uid, e) {
    if (!e || !one(`SELECT 1 FROM users u JOIN community_members cm ON cm.user_id=u.id
      JOIN communities c ON c.id=cm.community_id WHERE u.id=? AND u.deleted_at IS NULL AND c.id=? AND c.archived_at IS NULL`, uid, e.community_id)) return false;
    return family.ready(uid) && (e.visibility === 'public' || !!one('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', e.group_id, uid));
  }
  function canNotify(uid, source) {
    const e = eventRow(source.eventId);
    if (!accessible(uid, e)) return false;
    const start = readEvent(e).start;
    if (start !== source.eventStart || Date.parse(start) + 300000 < now()) return false;
    const member = one('SELECT muted FROM group_members WHERE group_id=? AND user_id=?', e.group_id, uid);
    if (member?.muted) return false;
    return source.reminderKind === 'personal' || !!member;
  }
  const settings = uid => {
    const row = one('SELECT * FROM calendar_notification_settings WHERE user_id=?', uid);
    return {offsets: row ? JSON.parse(row.offsets) : DEFAULT_CALENDAR_OFFSETS, changed_at: row?.changed_at || 0};
  };
  function personal(uid, e) {
    const row = one('SELECT remind_at FROM calendar_event_reminders WHERE user_id=? AND event_id=?', uid, e.id);
    return row ? {remind_at: new Date(row.remind_at).toISOString(), sent: !!one("SELECT 1 FROM calendar_reminder_deliveries WHERE user_id=? AND event_id=? AND kind='personal' AND timing=?", uid, e.id, row.remind_at)} : null;
  }
  function requireEvent(req) {
    const e = eventRow(req.params.id);
    if (!accessible(req.user.id, e)) fail(404, 'Event not found.');
    return e;
  }
  app.get('/api/calendar/notification-settings', (req, res) => res.json({offsets: settings(req.user.id).offsets}));
  app.put('/api/calendar/notification-settings', (req, res) => {
    const offsets = calendarOffsets(req.body.offsets);
    run(`INSERT INTO calendar_notification_settings VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET offsets=excluded.offsets,changed_at=excluded.changed_at`, req.user.id, JSON.stringify(offsets), now());
    res.json({offsets});
  });
  app.put('/api/calendar/events/:id/reminder', (req, res) => {
    const e = requireEvent(req), at = typeof req.body.remind_at === 'string' ? Date.parse(req.body.remind_at) : NaN;
    if (!Number.isFinite(at) || at <= now() || at > Date.parse(readEvent(e).start)) fail(400, 'Choose a future reminder time on or before the event starts.');
    run(`INSERT INTO calendar_event_reminders VALUES (?,?,?) ON CONFLICT(user_id,event_id) DO UPDATE SET remind_at=excluded.remind_at`, req.user.id, e.id, at);
    res.json({reminder: personal(req.user.id, e)});
  });
  app.delete('/api/calendar/events/:id/reminder', (req, res) => {
    const e = requireEvent(req);
    run('DELETE FROM calendar_event_reminders WHERE user_id=? AND event_id=?', req.user.id, e.id);
    res.json({ok: true});
  });

  let working = false, closed = false;
  async function tick() {
    if (working || closed) return;
    working = true;
    try {
      for (const e of all('SELECT e.*,g.community_id FROM calendar_events e JOIN groups g ON g.id=e.group_id')) {
        if (closed) break;
        const data = readEvent(e), start = Date.parse(data.start), time = now();
        if (start + 300000 < time) continue;
        const recipients = all(`SELECT user_id FROM group_members WHERE group_id=? AND muted=0
          UNION SELECT user_id FROM calendar_event_reminders WHERE event_id=?`, e.group_id, e.id);
        for (const {user_id: uid} of recipients) {
          if (closed || !accessible(uid, e)) continue;
          const candidates = [], member = one('SELECT muted FROM group_members WHERE group_id=? AND user_id=?', e.group_id, uid);
          if (member?.muted) continue;
          if (member) {
            const prefs = settings(uid);
            for (const offset of prefs.offsets) {
              const due = start - offset * 60000;
              // Do not send elapsed reminders when an event or preference is newly created/edited.
              if (due <= time && due >= Date.parse(e.updated_at) && due >= prefs.changed_at) candidates.push({kind: 'default', timing: offset});
            }
          }
          const own = one('SELECT remind_at FROM calendar_event_reminders WHERE event_id=? AND user_id=?', e.id, uid);
          if (own && own.remind_at <= time && own.remind_at <= start) candidates.push({kind: 'personal', timing: own.remind_at});
          const unsent = candidates.filter(c => !one('SELECT 1 FROM calendar_reminder_deliveries WHERE event_id=? AND user_id=? AND occurrence=? AND kind=? AND timing=?', e.id, uid, c.kind === 'personal' ? '' : data.start, c.kind, c.timing));
          if (!unsent.length) continue;
          // Claim before dispatch. Persisted receipts prevent repeat alerts after restarts.
          for (const c of unsent) run('INSERT OR IGNORE INTO calendar_reminder_deliveries VALUES (?,?,?,?,?,?)', uid, e.id, c.kind === 'personal' ? '' : data.start, c.kind, c.timing, time);
          const source = {channel: 'calendar', eventId: e.id, eventStart: data.start, reminderKind: unsent.some(c => c.kind === 'personal') ? 'personal' : 'default'};
          if (!canNotify(uid, source)) continue;
          // Several overdue reminders for the same event collapse into a single alert.
          const show=!!one('SELECT notification_previews FROM users WHERE id=?',uid)?.notification_previews;
          const date=new Intl.DateTimeFormat('en-US',{timeZone:data.time_zone||'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(data.start));
          await notify(uid, {title: show?data.title:'Calendar reminder', body: show?date:'An activity is coming up. Open Churp for the details.', ...(show?{calendar_start:data.start}:{}), url: `/?community=${e.community_id}&calendar_event=${e.id}`}, null, source);
        }
      }
    } finally { working = false; }
  }
  const timer = autoProcess ? setInterval(() => tick().catch(() => { if (!closed) console.error('Calendar reminder processing paused; check calendar storage.'); }), 30000) : null;
  timer?.unref();
  return {tick, settings, personal, canNotify, close() { closed = true; clearInterval(timer); }};
}
