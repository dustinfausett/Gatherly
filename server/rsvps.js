import { rateLimit } from 'express-rate-limit';
import { parseResponse } from '../shared/rsvps.js';

export function installRsvps({ app, db, encryption, encryptionRequired, visibleCircle, joined, groupAdmin, transaction, refresh, testing }) {
  const one = (s, ...a) => db.prepare(s).get(...a), all = (s, ...a) => db.prepare(s).all(...a), run = (s, ...a) => db.prepare(s).run(...a);
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  function access(req) {
    const event = one('SELECT m.*,r.closed,r.canceled,r.response_deadline,u.name,COALESCE(kh.public_key,ei.public_key) AS signer_key,COALESCE(m.signer_fingerprint,ei.fingerprint) AS signer_fingerprint FROM rsvps r JOIN messages m ON m.id=r.message_id JOIN users u ON u.id=m.user_id LEFT JOIN e2ee_identities ei ON ei.user_id=m.encrypted_by LEFT JOIN e2ee_key_history kh ON kh.user_id=m.encrypted_by AND kh.fingerprint=m.signer_fingerprint WHERE m.id=? AND m.deleted=0', req.params.id) || fail(404, 'Invitation not found.');
    const g = visibleCircle(req.user.id, event.group_id);
    if (!joined(req.user.id, g.id)) fail(403, 'Join this Nest to open its invitations.');
    if (encryptionRequired && !encryption.canRead(req.user.id, event)) fail(404, 'This invitation is not available to this membership.');
    return { event, g, canManage: event.user_id === req.user.id || !!groupAdmin(req.user.id, g) };
  }
  const isClosed = e => !!(e.closed || e.canceled || (e.response_deadline && Date.parse(e.response_deadline) <= Date.now()));
  function responses(req, id, mine = false) {
    return all(`SELECT m.*,u.name,COALESCE(kh.public_key,ei.public_key) AS signer_key,COALESCE(m.signer_fingerprint,ei.fingerprint) AS signer_fingerprint
      FROM rsvp_responses r JOIN messages m ON m.id=r.message_id JOIN users u ON u.id=m.user_id
      LEFT JOIN e2ee_identities ei ON ei.user_id=m.encrypted_by LEFT JOIN e2ee_key_history kh ON kh.user_id=m.encrypted_by AND kh.fingerprint=m.signer_fingerprint
      WHERE r.event_id=? AND m.deleted=0 ${mine ? 'AND m.user_id=?' : ''} ORDER BY m.id`, id, ...(mine ? [req.user.id] : []))
      .filter(m => !encryptionRequired || encryption.canRead(req.user.id, m)).map(m => ({ ...m, files: [] }));
  }
  for (const mine of [false, true]) app.get(`/api/messages/:id/rsvp${mine ? '/status' : ''}`, (req, res) => {
    const { event, g, canManage } = access(req);
    const eligible = !mine && canManage ? all(`SELECT u.id,u.name FROM group_members gm JOIN users u ON u.id=gm.user_id
      WHERE gm.group_id=? ${encryptionRequired ? 'AND gm.joined_after<? AND EXISTS(SELECT 1 FROM e2ee_recipients er WHERE er.message_id=? AND er.user_id=u.id)' : ''} ORDER BY u.name`, g.id, ...(encryptionRequired ? [event.id, event.id] : [])) : [];
    res.json({ message: mine ? undefined : { ...event, files: [] }, closed: !!event.closed, canceled: !!event.canceled, deadline_passed: !!(event.response_deadline && Date.parse(event.response_deadline) <= Date.now()), response_deadline: event.response_deadline, can_manage: canManage, responses: responses(req, event.id, mine), eligible, event_version: event.edit_version });
  });
  app.patch('/api/messages/:id/rsvp', (req, res) => {
    const { event, g, canManage } = access(req);
    if (!canManage) fail(403, 'Only the event creator or a Nest admin can manage this invitation.');
    const values = ['closed', 'canceled'].filter(k => req.body[k] !== undefined);
    if (!values.length || values.some(k => typeof req.body[k] !== 'boolean')) fail(400, 'Choose a valid invitation status.');
    transaction(() => { for (const k of values) run(`UPDATE rsvps SET ${k}=? WHERE message_id=?`, Number(req.body[k]), event.id); });
    refresh(g.community_id); res.json({ ok: true });
  });
  app.post('/api/messages/:id/rsvp/respond', rateLimit({ windowMs: 60000, limit: testing ? 1000 : 30, keyGenerator: req => req.user.id, message: { error: 'Please wait before updating your response again.' } }), async (req, res) => {
    const { event, g } = access(req);
    if (req.body.reply_to !== event.id || req.body.files?.length || req.body.urgent) fail(400, 'Submit a response to this invitation without attachments or urgency.');
    if (encryptionRequired && req.body.body !== undefined) fail(400, 'RSVP responses must be encrypted on your device.');
    if (encryptionRequired && typeof req.body.clientId === 'string') {
      const prior = one('SELECT * FROM messages WHERE client_id=?', req.body.clientId);
      if (prior) {
        if (prior.user_id !== req.user.id || prior.group_id !== g.id || prior.reply_to !== event.id || prior.message_kind !== 'rsvp_response' || prior.ciphertext !== req.body.ciphertext) fail(409, 'That encrypted response ID is already in use.');
        return res.status(201).json({ id: prior.id });
      }
    }
    if (isClosed(event)) fail(409, event.canceled ? 'This event is canceled.' : 'Responses are closed.');
    if (req.body.eventVersion !== event.edit_version) fail(409, 'The invitation changed. Reopen it before responding.');
    const checked = encryptionRequired ? await encryption.validateSend(req, g.id) : null;
    const body = encryptionRequired ? '' : req.body.body;
    if (!encryptionRequired && !parseResponse(body, event.id)) fail(400, 'Choose a response and a valid guest count.');
    let id;
    transaction(() => {
      const fresh = access(req).event;
      if (isClosed(fresh) || fresh.edit_version !== req.body.eventVersion) fail(409, 'The invitation changed or responses closed. Reopen it to continue.');
      if (checked) encryption.assertRoster(req, g.id, checked.rosterHash);
      id = Number(run(`INSERT INTO messages(group_id,user_id,body,reply_to,message_kind,ciphertext,client_id,encrypted_by,e2ee_version,recipient_hash,signer_fingerprint,self_encrypted)
        VALUES (?,?,?,?,'rsvp_response',?,?,?,?,?,?,?)`, g.id, req.user.id, body, event.id, checked?.ciphertext ?? null, checked?.clientId ?? null, checked ? req.user.id : null, checked ? 1 : 0, checked?.rosterHash ?? null, checked ? encryption.identity(req.user.id).fingerprint : null, checked?.rs.self_encrypted ? 1 : 0).lastInsertRowid);
      if (checked) encryption.recordRecipients(id, checked.rs);
      run('INSERT INTO rsvp_responses(event_id,user_id,message_id) VALUES (?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET message_id=excluded.message_id', event.id, req.user.id, id);
    });
    // Quiet updates: no chat bubble, unread egg, or push notification for a response.
    refresh(g.community_id); res.status(201).json({ id });
  });
}
