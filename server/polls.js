import { rateLimit } from 'express-rate-limit';
import { parsePoll, parseVote } from '../shared/polls.js';

export function installPolls({ app, db, encryption, encryptionRequired, visibleCircle, joined, groupAdmin, transaction, refresh, testing }) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  function access(req) {
    const poll = one('SELECT m.*,p.closed FROM polls p JOIN messages m ON m.id=p.message_id WHERE p.message_id=? AND m.deleted=0', req.params.id) || fail(404, 'Poll not found.');
    const g = visibleCircle(req.user.id, poll.group_id);
    if (!joined(req.user.id, g.id)) fail(403, 'Join this Nest to open its polls.');
    if (encryptionRequired && !encryption.canRead(req.user.id, poll)) fail(404, 'This poll was sent before you joined this Nest.');
    return { poll, g, canManage: poll.user_id === req.user.id || !!groupAdmin(req.user.id, g) };
  }
  app.get('/api/messages/:id/poll', (req, res) => {
    const { poll, canManage } = access(req);
    const votes = all(`SELECT m.*,u.name,COALESCE(kh.public_key,ei.public_key) AS signer_key,
      COALESCE(m.signer_fingerprint,ei.fingerprint) AS signer_fingerprint
      FROM poll_votes v JOIN messages m ON m.id=v.message_id JOIN users u ON u.id=m.user_id
      LEFT JOIN e2ee_identities ei ON ei.user_id=m.encrypted_by
      LEFT JOIN e2ee_key_history kh ON kh.user_id=m.encrypted_by AND kh.fingerprint=m.signer_fingerprint
      WHERE v.poll_id=? AND m.deleted=0 ORDER BY m.id`, poll.id)
      .filter(m => !encryptionRequired || encryption.canRead(req.user.id, m)).map(m => ({ ...m, files: [] }));
    res.json({ closed: !!poll.closed, can_manage: canManage, votes });
  });
  app.patch('/api/messages/:id/poll', (req, res) => {
    const { poll, g, canManage } = access(req);
    if (!canManage) fail(403, 'Only the poll creator or a Nest admin can close or reopen this poll.');
    if (typeof req.body.closed !== 'boolean') fail(400, 'Closed must be true or false.');
    run('UPDATE polls SET closed=? WHERE message_id=?', Number(req.body.closed), poll.id);
    refresh(g.community_id); res.json({ ok: true });
  });
  app.post('/api/messages/:id/poll/vote', rateLimit({ windowMs: 60_000, limit: testing ? 1000 : 30, keyGenerator: req => req.user.id, message: { error: 'Please wait a moment before updating your answers again.' } }), async (req, res) => {
    const { poll, g } = access(req);
    if (req.body.reply_to !== poll.id) fail(400, 'The response must belong to this poll.');
    if (req.body.files?.length || req.body.urgent) fail(400, 'A poll response cannot include attachments or urgency.');
    if (encryptionRequired && req.body.body !== undefined) fail(400, 'Poll answers must be encrypted on your device.');
    if (encryptionRequired && typeof req.body.clientId === 'string') {
      const existing = one('SELECT * FROM messages WHERE client_id=?', req.body.clientId);
      if (existing) {
        if (existing.user_id !== req.user.id || existing.group_id !== g.id || existing.reply_to !== poll.id || existing.message_kind !== 'poll_vote' || existing.ciphertext !== req.body.ciphertext) fail(409, 'That encrypted response ID is already in use.');
        return res.status(201).json({ id: existing.id });
      }
    }
    if (poll.closed) fail(409, 'This poll is closed.');
    const checked = encryptionRequired ? await encryption.validateSend(req, g.id) : null;
    const body = encryptionRequired ? '' : req.body.body;
    if (!encryptionRequired && !parseVote(body, poll.id, parsePoll(poll.body))) fail(400, 'Choose valid answers for every question.');
    let id;
    transaction(() => {
      // Membership, history and closure may change while cryptography is checked.
      const fresh = access(req); if (fresh.poll.closed) fail(409, 'This poll is closed.');
      if (checked) encryption.assertRoster(req, g.id, checked.rosterHash);
      id = Number(run(`INSERT INTO messages(group_id,user_id,body,reply_to,message_kind,ciphertext,client_id,encrypted_by,e2ee_version,recipient_hash,signer_fingerprint,self_encrypted)
        VALUES (?,?,?,?,'poll_vote',?,?,?,?,?,?,?)`, g.id, req.user.id, body, poll.id,
      checked?.ciphertext ?? null, checked?.clientId ?? null, checked ? req.user.id : null, checked ? 1 : 0,
      checked?.rosterHash ?? null, checked ? encryption.identity(req.user.id).fingerprint : null, checked?.rs.self_encrypted ? 1 : 0).lastInsertRowid);
      if (checked) encryption.recordRecipients(id, checked.rs);
      run(`INSERT INTO poll_votes(poll_id,user_id,message_id) VALUES (?,?,?)
        ON CONFLICT(poll_id,user_id) DO UPDATE SET message_id=excluded.message_id`, poll.id, req.user.id, id);
    });
    // Responses refresh the open poll without creating chat bubbles, unread eggs or push alerts.
    refresh(g.community_id); res.status(201).json({ id });
  });
}
