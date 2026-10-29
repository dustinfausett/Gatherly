import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { keyVault } from './key-vault.js';
import { hash } from './security.js';
import { scheduleTime } from '../shared/scheduling.js';
import { phoneDraftText } from '../shared/phone-drafts.js';
import { nestRecipientIds } from './recipient-scopes.js';
import { personalizeMessage } from '../shared/personalization.js';

export function installPhoneDrafts({ app, db, dataDir, appUrl, family, membership, group, groupAdmin, invitations, transaction, refreshUser, notifyReady, testing, now = Date.now, autoProcess = true }) {
  const one = (sql, ...a) => db.prepare(sql).get(...a), all = (sql, ...a) => db.prepare(sql).all(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const vault = keyVault(dataDir, !!one('SELECT 1 FROM phone_drafts LIMIT 1') || !!one('SELECT 1 FROM e2ee_managed_keys LIMIT 1'));
  const seal = (id, value) => vault.seal('phone-draft', id, JSON.stringify(value)), open = row => JSON.parse(vault.open('phone-draft', row.id, row.payload_cipher));
  const saved = one('SELECT * FROM phone_drafts LIMIT 1'); if (saved) open(saved);
  const owned = (id, uid) => one('SELECT * FROM phone_drafts WHERE id=? AND owner_id=?', id, uid) || fail(404, 'Phone draft not found.');
  const limited = rateLimit({ windowMs: 60000, limit: testing ? 1000 : 80, keyGenerator: req => req.user.id, message: { error: 'Please wait before preparing more phone drafts.' } });
  function sender(uid, packet) {
    family.requireReady(uid); if (family.age(uid) < 18) fail(403, 'Phone drafts are available to adult accounts. Keep protected conversations in Churp.');
    if (packet.tree_id) membership(uid, packet.tree_id);
    if (packet.source_nest) { const g = group(packet.source_nest); if (g.community_id !== packet.tree_id || !groupAdmin(uid, g)) fail(403, 'Only Nest admins can send individually from this Nest.'); }
    if (packet.filter_nest) { if (!packet.tree_id) fail(400, 'Choose a Tree for this Nest filter.'); nestRecipientIds(db, groupAdmin, uid, packet.tree_id, packet.filter_nest); }
  }
  function contact(uid, packet, row) {
    sender(uid, packet);
    const c = one('SELECT * FROM personal_contacts WHERE id=? AND owner_id=?', row.contact_id, uid) || fail(404, 'This saved contact was removed.');
    if (!/^\+[1-9]\d{7,14}$/.test(c.phone || '')) fail(400, 'This contact needs a valid phone number.');
    if (row.phone && row.phone !== c.phone) fail(409, 'This contact’s phone number changed. Edit and review the draft again.');
    // An explicitly linked account always stays in Churp. A failed/blocked
    // private message must never silently fall back to an external text.
    if (c.linked_user_id || one('SELECT 1 FROM personal_contacts WHERE owner_id=? AND phone=? AND linked_user_id IS NOT NULL', uid, c.phone)) fail(403, 'This contact is linked to Churp. Use their Churp conversation instead.');
    if (packet.filter_nest) fail(403, 'Phone-only contacts have no verified Nest membership. Clear the Nest filter to select them.');
    if (one("SELECT 1 FROM sms_suppression WHERE mode='live' AND phone=?", c.phone)) fail(403, 'This number previously opted out of Churp phone texts.');
    return c;
  }
  function view(row) {
    const packet = open(row), ready = row.ready_at <= now();
    let problem = ''; try { sender(row.owner_id, packet); } catch (e) { problem = e.message; }
    const recipients = packet.recipients.map(r => { let reason = problem; if (!reason) try { contact(row.owner_id, packet, r); } catch (e) { reason = e.message; } return { ...r, reason }; });
    const complete = recipients.every(r => ['done', 'skipped'].includes(r.state)), needsReview = !!problem || recipients.some(r => r.reason && !['done', 'skipped'].includes(r.state));
    return { id: row.id, version: row.version, created_at: row.created_at, ready_at: row.ready_at, reminder: !!packet.reminder, cancelled: !!row.cancelled_at, notified: !!row.notified_at, body: packet.body, personalization:packet.personalization||null, tree_id: packet.tree_id, source_nest: packet.source_nest, filter_nest: packet.filter_nest, recipients, status: row.cancelled_at ? 'cancelled' : complete ? 'complete' : !ready ? 'scheduled' : needsReview ? 'needs_review' : 'ready' };
  }
  function values(req) {
    const body = req.body, ids = body.contact_ids;
    if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 10000) fail(400, 'Write a message up to 10,000 characters.');
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || id.length > 100) || new Set(ids).size !== ids.length) fail(400, 'Choose between 1 and 50 saved phone contacts.');
    for (const field of ['tree_id', 'source_nest', 'filter_nest']) if (body[field] != null && (typeof body[field] !== 'string' || !body[field] || body[field].length > 100)) fail(400, 'Choose a valid Tree or Nest.');
    const packet = { body: body.body.trim(), personalization:'first-name', reminder: body.ready_at != null, tree_id: body.tree_id || null, source_nest: body.source_nest || null, filter_nest: body.filter_nest || null };
    sender(req.user.id, packet);
    const seen = new Set();
    packet.recipients = ids.map(id => contact(req.user.id, packet, { contact_id: id })).filter(c => { if (seen.has(c.phone)) return false; seen.add(c.phone); return true; }).map(c => ({ contact_id: c.id, name: c.name, phone: c.phone, state: 'ready' }));
    try{for(const r of packet.recipients)personalizeMessage(packet.body,r.name);}catch(e){fail(400,e.message);}
    let readyAt = now(); if (body.ready_at != null) try { readyAt = scheduleTime(body.ready_at, now()); } catch (e) { fail(400, e.message); }
    return { packet, readyAt };
  }
  app.get('/api/phone-drafts', (req, res) => res.json({ drafts: all('SELECT * FROM phone_drafts WHERE owner_id=? ORDER BY created_at DESC LIMIT 200', req.user.id).map(view) }));
  app.get('/api/phone-drafts/:id', (req, res) => res.json(view(owned(req.params.id, req.user.id))));
  app.post('/api/phone-drafts', limited, (req, res) => {
    if (typeof req.body.client_id !== 'string' || !/^[a-f\d-]{36}$/i.test(req.body.client_id)) fail(400, 'A unique phone draft ID is required.');
    const digest = hash(JSON.stringify(req.body)), prior = one('SELECT * FROM phone_drafts WHERE owner_id=? AND client_id=?', req.user.id, req.body.client_id);
    if (prior) { if (prior.request_hash !== digest) fail(409, 'This draft request was already saved. Open Phone drafts to review it.'); return res.json(view(prior)); }
    const { packet, readyAt } = values(req), id = randomUUID();
    if (one('SELECT COUNT(*) n FROM phone_drafts WHERE owner_id=? AND cancelled_at IS NULL', req.user.id).n >= 500) fail(400, 'Cancel older phone drafts before preparing more.');
    run('INSERT INTO phone_drafts(id,owner_id,client_id,request_hash,payload_cipher,ready_at,created_at,notified_at) VALUES (?,?,?,?,?,?,?,?)', id, req.user.id, req.body.client_id, digest, seal(id, packet), readyAt, now(), readyAt <= now() ? now() : null);
    refreshUser(req.user.id); res.status(201).json(view(owned(id, req.user.id)));
  });
  app.put('/api/phone-drafts/:id', limited, (req, res) => {
    const old = owned(req.params.id, req.user.id), original = open(old);
    if (req.body.expected_version !== old.version) fail(409, 'This phone draft changed. Refresh it before editing.');
    if (old.cancelled_at || original.recipients.some(r => r.state === 'done' || r.state === 'opened')) fail(409, 'A phone handoff has already started. Create a new draft to change its text.');
    const { packet, readyAt } = values(req);
    run('UPDATE phone_drafts SET payload_cipher=?,ready_at=?,notified_at=?,version=version+1 WHERE id=?', seal(old.id, packet), readyAt, readyAt <= now() ? now() : null, old.id);
    refreshUser(req.user.id); res.json(view(owned(old.id, req.user.id)));
  });
  app.post('/api/phone-drafts/:id/cancel', limited, (req, res) => {
    const old = owned(req.params.id, req.user.id); if (req.body.expected_version !== old.version) fail(409, 'This phone draft changed. Refresh before cancelling.');
    run('UPDATE phone_drafts SET cancelled_at=?,version=version+1 WHERE id=?', now(), old.id); refreshUser(req.user.id); res.json(view(owned(old.id, req.user.id)));
  });
  app.post('/api/phone-drafts/:id/prepare', limited, async (req, res) => {
    let row = owned(req.params.id, req.user.id); if (row.cancelled_at || row.ready_at > now()) fail(409, 'This phone draft is cancelled or not due yet.');
    const packet = open(row), r = packet.recipients.find(r => r.contact_id === req.body.contact_id) || fail(404, 'Recipient not found in this draft.');
    if (['done', 'skipped'].includes(r.state)) fail(409, 'This recipient is already finished.');
    contact(req.user.id, packet, r);
    const invitation = packet.tree_id ? await invitations.createForText(req.user.id, packet.tree_id) : new URL('/', appUrl).href;
    row = owned(row.id, req.user.id);
    if (row.cancelled_at || row.version !== req.body.expected_version) fail(409, 'This phone draft changed. Refresh it before opening.');
    contact(req.user.id, packet, r);
    const senderName = one('SELECT name FROM users WHERE id=?', req.user.id).name, treeName = packet.tree_id ? one('SELECT name FROM communities WHERE id=?', packet.tree_id)?.name : null;
    res.json({ contact_id: r.contact_id, name: r.name, phone: r.phone, text: phoneDraftText(packet.personalization==='first-name'?personalizeMessage(packet.body,r.name):packet.body, senderName, treeName, invitation), version: row.version });
  });
  app.patch('/api/phone-drafts/:id/recipient', limited, (req, res) => {
    const row = owned(req.params.id, req.user.id); if (row.cancelled_at || row.ready_at > now()) fail(409, 'This draft is not available to send.');
    if (row.version !== req.body.expected_version) fail(409, 'This phone draft changed. Refresh it before continuing.');
    if (!['ready', 'opened', 'done', 'skipped'].includes(req.body.state)) fail(400, 'Choose ready, opening requested, marked sent or skipped.');
    const packet = open(row), r = packet.recipients.find(r => r.contact_id === req.body.contact_id) || fail(404, 'Recipient not found.');
    if (req.body.state !== 'skipped') contact(req.user.id, packet, r);
    if (['done', 'skipped'].includes(r.state) && r.state !== req.body.state) fail(409, 'This recipient is already finished.');
    r.state = req.body.state; run('UPDATE phone_drafts SET payload_cipher=?,version=version+1 WHERE id=?', seal(row.id, packet), row.id); refreshUser(req.user.id); res.json(view(owned(row.id, req.user.id)));
  });
  let closed = false;
  function canNotify(uid, id) { const row = one('SELECT * FROM phone_drafts WHERE id=? AND owner_id=?', id, uid); if (!row || row.cancelled_at || row.ready_at > now()) return false; const v = view(row); return v.recipients.some(r => !r.reason && ['ready', 'opened'].includes(r.state)); }
  async function tick() {
    if (closed) return;
    for (const row of all('SELECT * FROM phone_drafts WHERE cancelled_at IS NULL AND notified_at IS NULL AND ready_at<=? LIMIT 50', now())) {
      run('UPDATE phone_drafts SET notified_at=? WHERE id=? AND notified_at IS NULL', now(), row.id);
      if (canNotify(row.owner_id, row.id)) await notifyReady?.(row.owner_id, row.id);
      refreshUser(row.owner_id);
    }
  }
  const timer = autoProcess ? setInterval(() => { tick().catch(() => {}); }, 1000) : null; timer?.unref();
  return { canNotify, tick, close() { closed = true; clearInterval(timer); } };
}
