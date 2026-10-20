import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import webPush from 'web-push';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openDatabase } from './database.js';
import { token, hash, passwordHash, passwordMatches } from './security.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const SESSION_AGE = 30 * 86400 * 1000;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const publicUser = u => ({ id: u.id, username: u.username, name: u.name, avatar_id: u.avatar_id, last_community_id: u.last_community_id });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function text(value, label, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label} must be between 1 and ${max} characters.`);
  return value.trim();
}
function description(value = '') {
  if (typeof value !== 'string' || value.length > 500) fail(400, 'Descriptions can contain up to 500 characters.');
  return value.trim();
}
function boolean(value, name) {
  if (typeof value !== 'boolean') fail(400, `${name} must be true or false.`);
  return Number(value);
}

export function createApp(options = {}) {
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || '.data');
  const uploadDir = join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const db = openDatabase(options.database || join(dataDir, 'gatherly.sqlite'));
  const app = express();
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY ?? '0';
  if (!/^\d+$/.test(String(trustProxy)) || Number(trustProxy) > 10) throw new Error('TRUST_PROXY must be a proxy hop count between 0 and 10.');
  app.set('trust proxy', Number(trustProxy));
  const googleClientId = options.googleClientId ?? process.env.GOOGLE_CLIENT_ID;
  const google = new OAuth2Client(googleClientId);
  const appUrl = options.appUrl || process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const pushEnabled = options.pushEnabled ?? !!(vapidPublic && vapidPrivate && process.env.VAPID_SUBJECT);
  if (pushEnabled) webPush.setVapidDetails(process.env.VAPID_SUBJECT, vapidPublic, vapidPrivate);
  const streams = new Map();
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const transaction = fn => {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function refreshUser(userId) {
    for (const res of streams.get(userId) || []) res.write('event: refresh\ndata: {}\n\n');
  }
  function refresh(communityId) {
    const users = communityId ? all('SELECT user_id FROM community_members WHERE community_id=?', communityId).map(x => x.user_id) : [...streams.keys()];
    for (const id of users) refreshUser(id);
  }
  const community = id => one('SELECT * FROM communities WHERE id=?', id) || fail(404, 'Community not found.');
  function membership(userId, communityId) {
    return one('SELECT * FROM community_members WHERE user_id=? AND community_id=?', userId, communityId) || fail(403, 'You are not a member of this Community.');
  }
  function communityAdmin(userId, id) {
    return ['owner', 'admin'].includes(membership(userId, id).role);
  }
  function sub(id) { return one('SELECT * FROM subcommunities WHERE id=?', id) || fail(404, 'Group not found.'); }
  function group(id) {
    return one('SELECT * FROM groups WHERE id=?', id) || fail(404, 'Circle not found.');
  }
  function subAdmin(userId, s) {
    return communityAdmin(userId, s.community_id) || !!one("SELECT 1 FROM scoped_admins WHERE user_id=? AND scope_type='subcommunity' AND scope_id=?", userId, s.id);
  }
  function groupAdmin(userId, g) {
    return communityAdmin(userId, g.community_id) || (g.subcommunity_id && subAdmin(userId, sub(g.subcommunity_id))) || !!one("SELECT 1 FROM scoped_admins WHERE user_id=? AND scope_type='group' AND scope_id=?", userId, g.id);
  }
  const joined = (userId, id) => one('SELECT * FROM group_members WHERE user_id=? AND group_id=?', userId, id);
  function visibleCircle(userId, id) {
    const g = group(id);
    membership(userId, g.community_id);
    if (g.private && !joined(userId, id) && !groupAdmin(userId, g)) fail(404, 'Circle not found.');
    return g;
  }
  function avatar(userId, id) {
    if (id === null) return null;
    const f = one('SELECT * FROM files WHERE id=? AND user_id=?', id, userId);
    if (!f || !imageTypes.has(f.mime)) fail(400, 'Choose an uploaded PNG, JPEG, GIF, or WebP image.');
    return f.id;
  }
  function session(res, user) {
    const value = token();
    run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    run('INSERT INTO sessions VALUES (?,?,?)', hash(value), user.id, Date.now() + SESSION_AGE);
    res.cookie('gatherly_session', value, { httpOnly: true, sameSite: 'lax', secure: production, maxAge: SESSION_AGE, path: '/' });
    return publicUser(user);
  }
  function auth(req, res, next) {
    const value = req.cookies.gatherly_session;
    const record = typeof value === 'string' && one('SELECT u.*,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?', hash(value));
    if (!record || record.expires_at < Date.now()) return res.status(401).json({ error: 'Please sign in to continue.' });
    req.user = record;
    next();
  }

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: production ? {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://accounts.google.com'],
      frameSrc: ['https://accounts.google.com'], connectSrc: ["'self'", 'https://accounts.google.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com'],
      imgSrc: ["'self'", 'data:', 'blob:'], upgradeInsecureRequests: null,
    },
  } : false, crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, strictTransportSecurity: production }));
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
      // An explicit APP_URL supports a reverse proxy; same-origin requests use the actual Host.
      if (origin && origin !== new URL(appUrl).origin && ![`${req.protocol}://${req.get('host')}`, `https://${req.get('host')}`].includes(origin)) return res.status(403).json({ error: 'Untrusted request origin.' });
    }
    next();
  });
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: options.testing ? 1000 : 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please try again in 15 minutes.' } });
  app.get('/api/health', (req, res) => res.json({ status: one('SELECT 1 AS ok').ok === 1 ? 'ok' : 'error' }));
  app.get('/api/config', (req, res) => res.json({ googleClientId: googleClientId || null, vapidPublicKey: pushEnabled ? vapidPublic : null }));
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const username = text(req.body.username, 'Username', 30).toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(username)) fail(400, 'Use 3–30 letters, numbers, or underscores for your username.');
    const name = text(req.body.name, 'Display name');
    const password = req.body.password;
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) fail(400, 'Use a password between 8 and 128 characters.');
    const hashed = await passwordHash(password);
    if (one('SELECT 1 FROM users WHERE username=?', username)) fail(409, 'That username is already taken.');
    const id = randomUUID();
    run('INSERT INTO users(id,username,name,password) VALUES (?,?,?,?)', id, username, name, hashed);
    res.status(201).json({ user: session(res, one('SELECT * FROM users WHERE id=?', id)) });
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const username = text(req.body.username, 'Username', 30);
    const password = req.body.password;
    if (typeof password !== 'string' || password.length > 128) fail(400, 'Enter a valid password.');
    const user = one('SELECT * FROM users WHERE username=?', username);
    // The dummy hash avoids a fast path for unknown usernames.
    const valid = await passwordMatches(password, user?.password || '00000000000000000000000000000000:' + '00'.repeat(64));
    if (!user || !valid || !user.password) fail(401, 'Your username or password is incorrect.');
    res.json({ user: session(res, user) });
  });
  app.post('/api/auth/google', authLimit, async (req, res) => {
    if (!googleClientId) fail(503, 'Google Sign-in is not configured yet. Use a username and password.');
    if (typeof req.body.credential !== 'string') fail(400, 'Missing Google credential.');
    let payload;
    try { payload = (await google.verifyIdToken({ idToken: req.body.credential, audience: googleClientId })).getPayload(); }
    catch { fail(401, 'Google could not verify this sign-in. Please try again.'); }
    if (!payload?.sub || !payload.email_verified) fail(401, 'A verified Google account is required.');
    let user = one('SELECT * FROM users WHERE google_id=?', payload.sub);
    if (!user) {
      const id = randomUUID();
      run('INSERT INTO users(id,username,name,google_id) VALUES (?,?,?,?)', id, `g_${id.replaceAll('-', '').slice(0,20)}`, (payload.name || 'New member').slice(0,80), payload.sub);
      user = one('SELECT * FROM users WHERE id=?', id);
    }
    res.json({ user: session(res, user) });
  });
  app.post('/api/auth/logout', auth, (req, res) => {
    run('DELETE FROM sessions WHERE token_hash=?', hash(req.cookies.gatherly_session));
    for (const stream of streams.get(req.user.id) || []) stream.end();
    res.clearCookie('gatherly_session', { path: '/' });
    res.json({ ok: true });
  });
  app.use('/api', auth);
  app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) }));
  app.patch('/api/me', (req, res) => {
    const name = req.body.name === undefined ? req.user.name : text(req.body.name, 'Display name');
    const avatarId = req.body.avatar_id === undefined ? req.user.avatar_id : avatar(req.user.id, req.body.avatar_id);
    const last = req.body.last_community_id === undefined ? req.user.last_community_id : req.body.last_community_id;
    if (last !== null) membership(req.user.id, last);
    run('UPDATE users SET name=?,avatar_id=?,last_community_id=? WHERE id=?', name, avatarId, last, req.user.id);
    refresh();
    res.json({ user: publicUser(one('SELECT * FROM users WHERE id=?', req.user.id)) });
  });
  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', 'Cache-Control': 'no-store' });
    res.flushHeaders();
    res.write('event: connected\ndata: {}\n\n');
    const set = streams.get(req.user.id) || new Set();
    set.add(res); streams.set(req.user.id, set);
    const heartbeat = setInterval(() => {
      if (!one('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?', hash(req.cookies.gatherly_session), Date.now())) return res.end();
      res.write(': heartbeat\n\n');
    }, 25000);
    req.on('close', () => { clearInterval(heartbeat); set.delete(res); if (!set.size) streams.delete(req.user.id); });
  });
  app.get('/api/communities', (req, res) => res.json({ communities: all(`SELECT c.*,m.role,
    (SELECT COUNT(*) FROM community_members WHERE community_id=c.id) AS member_count
    FROM communities c JOIN community_members m ON m.community_id=c.id WHERE m.user_id=? ORDER BY c.name`, req.user.id) }));
  app.post('/api/communities', (req, res) => {
    const name = text(req.body.name, 'Community name');
    const desc = description(req.body.description);
    const id = randomUUID();
    transaction(() => {
      run('INSERT INTO communities(id,name,description,owner_id) VALUES (?,?,?,?)', id, name, desc, req.user.id);
      run("INSERT INTO community_members VALUES (?,?,'owner')", id, req.user.id);
      run('UPDATE users SET last_community_id=? WHERE id=?', id, req.user.id);
    });
    res.status(201).json({ community: community(id) });
  });
  app.get('/api/communities/:id', (req, res) => {
    const c = community(req.params.id);
    const m = membership(req.user.id, c.id);
    const circles = all(`SELECT g.*,(SELECT COUNT(*) FROM group_members WHERE group_id=g.id) AS member_count
      FROM groups g WHERE community_id=? ORDER BY name COLLATE NOCASE`, c.id).map(g => {
      const gm = joined(req.user.id, g.id), admin = groupAdmin(req.user.id, g);
      if (g.private && !gm && !admin) return null;
      const counts = gm ? one(`SELECT COUNT(*) AS unread,COALESCE(SUM(urgent),0) AS urgent_unread FROM messages
        WHERE group_id=? AND id>? AND user_id<>? AND deleted=0`, g.id, gm.last_read, req.user.id) : { unread: 0, urgent_unread: 0 };
      return { ...g, is_admin: !!admin, joined: !!gm, muted: !!gm?.muted, pin_position: gm?.pin_position ?? null,
        marked_unread: !!gm?.marked_unread, ...counts };
    }).filter(Boolean);
    const subs = all('SELECT * FROM subcommunities WHERE community_id=? ORDER BY name COLLATE NOCASE', c.id)
      .map(s => {
        const children = circles.filter(g => g.subcommunity_id === s.id);
        return { ...s, is_admin: subAdmin(req.user.id, s), groups: children,
          joined: !!one('SELECT 1 FROM collection_members WHERE subcommunity_id=? AND user_id=?', s.id, req.user.id),
          unread: children.reduce((n,g) => n + g.unread,0), marked_unread: children.some(g => g.marked_unread),
          urgent_unread: children.reduce((n,g) => n + g.urgent_unread,0) };
      });
    res.json({ community: { ...c, role: m.role, is_admin: ['owner','admin'].includes(m.role),
      member_count: one('SELECT COUNT(*) AS n FROM community_members WHERE community_id=?', c.id).n,
      subcommunities: subs, circles } });
  });
  function updateSpace(req, res, type) {
    const table = { community: 'communities', subcommunity: 'subcommunities', group: 'groups' }[type];
    const entity = type === 'community' ? community(req.params.id) : type === 'subcommunity' ? sub(req.params.id) : group(req.params.id);
    const allowed = type === 'community' ? communityAdmin(req.user.id, entity.id) : type === 'subcommunity' ? subAdmin(req.user.id, entity) : groupAdmin(req.user.id, entity);
    if (!allowed) fail(403, 'Only an admin of this space can change its settings.');
    const name = req.body.name === undefined ? entity.name : text(req.body.name, 'Name');
    const desc = req.body.description === undefined ? entity.description : description(req.body.description);
    const pic = req.body.avatar_id === undefined || req.body.avatar_id === entity.avatar_id ? entity.avatar_id : avatar(req.user.id, req.body.avatar_id);
    let priv, adminOnly;
    if (type === 'group') {
      priv = req.body.private === undefined ? entity.private : boolean(req.body.private, 'Private');
      adminOnly = req.body.admin_only === undefined ? entity.admin_only : boolean(req.body.admin_only, 'Admin-only posting');
    }
    let parentId = entity.subcommunity_id;
    if (type === 'group' && req.body.subcommunity_id !== undefined && req.body.subcommunity_id !== parentId) {
      if (!communityAdmin(req.user.id, entity.community_id)) fail(403, 'Only Community admins can move Circles.');
      parentId = req.body.subcommunity_id;
      if (parentId !== null && (typeof parentId !== 'string' || sub(parentId).community_id !== entity.community_id)) fail(400, 'Choose a Group in this Community.');
    }
    transaction(() => {
      run(`UPDATE ${table} SET name=?,description=?,avatar_id=? WHERE id=?`, name, desc, pic, entity.id);
      if (type === 'group') run('UPDATE groups SET private=?,admin_only=?,subcommunity_id=? WHERE id=?', priv, adminOnly, parentId, entity.id);
    });
    refresh(type === 'community' ? entity.id : entity.community_id);
    res.json({ ok: true });
  }
  app.patch('/api/communities/:id', (req, res) => updateSpace(req, res, 'community'));
  app.patch('/api/subcommunities/:id', (req, res) => updateSpace(req, res, 'subcommunity'));
  app.patch('/api/groups/:id', (req, res) => updateSpace(req, res, 'group'));
  app.post('/api/communities/:id/subcommunities', (req, res) => {
    if (!communityAdmin(req.user.id, req.params.id)) fail(403, 'Only Community admins can create Groups.');
    const id = randomUUID();
    transaction(() => {
      run('INSERT INTO subcommunities(id,community_id,name,description) VALUES (?,?,?,?)', id, req.params.id, text(req.body.name, 'Group name'), description(req.body.description));
      run('INSERT INTO collection_members VALUES (?,?)',id,req.user.id);
    });
    refresh(req.params.id);
    res.status(201).json({ subcommunity: sub(id) });
  });
  app.post('/api/subcommunities/:id/join', (req, res) => {
    const s = sub(req.params.id); membership(req.user.id,s.community_id);
    run('INSERT OR IGNORE INTO collection_members VALUES (?,?)',s.id,req.user.id);
    refreshUser(req.user.id); res.json({ ok:true });
  });
  app.delete('/api/subcommunities/:id/join', (req, res) => {
    const s = sub(req.params.id); membership(req.user.id,s.community_id);
    // Leaving the collection keeps Circle membership, pins, and notification choices.
    run('DELETE FROM collection_members WHERE subcommunity_id=? AND user_id=?',s.id,req.user.id);
    refreshUser(req.user.id); res.json({ ok:true });
  });
  function joinParent(userId, g) {
    if (g.subcommunity_id) run('INSERT OR IGNORE INTO collection_members VALUES (?,?)',g.subcommunity_id,userId);
  }
  function createCircle(req, res, cid, parentId = null) {
    if (parentId ? !subAdmin(req.user.id, sub(parentId)) : !communityAdmin(req.user.id, cid)) fail(403, 'Only admins of the parent space can create Circles.');
    const id = randomUUID();
    transaction(() => {
      run('INSERT INTO groups(id,community_id,subcommunity_id,name,description,private,admin_only) VALUES (?,?,?,?,?,?,?)',
        id, cid, parentId, text(req.body.name, 'Circle name'), description(req.body.description), boolean(req.body.private ?? false, 'Private'), boolean(req.body.admin_only ?? false, 'Admin-only posting'));
      run('INSERT INTO group_members(group_id,user_id) VALUES (?,?)', id, req.user.id);
      if (parentId) run('INSERT OR IGNORE INTO collection_members VALUES (?,?)',parentId,req.user.id);
    });
    refresh(cid); res.status(201).json({ group: group(id) });
  }
  app.post('/api/subcommunities/:id/groups', (req, res) => { const s = sub(req.params.id); createCircle(req, res, s.community_id, s.id); });
  app.post('/api/communities/:id/circles', (req, res) => {
    const cid = req.params.id, parentId = req.body.subcommunity_id ?? null;
    membership(req.user.id, cid);
    if (parentId !== null && (typeof parentId !== 'string' || sub(parentId).community_id !== cid)) fail(400, 'Choose a Group in this Community.');
    createCircle(req, res, cid, parentId);
  });
  app.get('/api/communities/:id/members', (req, res) => {
    membership(req.user.id, req.params.id);
    res.json({ members: all(`SELECT u.id,u.name,u.username,u.avatar_id,m.role FROM users u
      JOIN community_members m ON m.user_id=u.id WHERE m.community_id=? ORDER BY u.name`, req.params.id),
      assignments: all(`SELECT a.* FROM scoped_admins a WHERE
        (a.scope_type='subcommunity' AND a.scope_id IN (SELECT id FROM subcommunities WHERE community_id=?)) OR
        (a.scope_type='group' AND a.scope_id IN (SELECT id FROM groups WHERE community_id=?))`, req.params.id, req.params.id)
        .filter(a => a.scope_type !== 'group' || (() => { try { visibleCircle(req.user.id, a.scope_id); return true; } catch { return false; } })()) });
  });
  app.patch('/api/communities/:id/members/:userId', (req, res) => {
    const c = community(req.params.id);
    if (c.owner_id !== req.user.id) fail(403, 'Only the Community owner can appoint Community admins.');
    const target = membership(req.params.userId, c.id);
    if (target.role === 'owner') fail(400, 'Transfer ownership before changing the owner’s role.');
    if (!['admin', 'member'].includes(req.body.role)) fail(400, 'Choose admin or member.');
    run('UPDATE community_members SET role=? WHERE community_id=? AND user_id=?', req.body.role, c.id, req.params.userId);
    refresh(c.id); res.json({ ok: true });
  });
  app.post('/api/communities/:id/transfer', (req, res) => {
    const c = community(req.params.id);
    if (c.owner_id !== req.user.id) fail(403, 'Only the owner can transfer this Community.');
    membership(req.body.user_id, c.id);
    if (req.body.user_id === req.user.id) fail(400, 'Choose another member to become the owner.');
    transaction(() => {
      run("UPDATE community_members SET role='admin' WHERE community_id=? AND user_id=?", c.id, req.user.id);
      run("UPDATE community_members SET role='owner' WHERE community_id=? AND user_id=?", c.id, req.body.user_id);
      run('UPDATE communities SET owner_id=? WHERE id=?', req.body.user_id, c.id);
    });
    refresh(c.id); res.json({ ok: true });
  });
  app.delete('/api/communities/:id/members/:userId', (req, res) => {
    const c = community(req.params.id);
    if (!communityAdmin(req.user.id, c.id)) fail(403, 'Only Community admins can remove members.');
    const target = membership(req.params.userId, c.id);
    if (target.role === 'owner' || req.params.userId === req.user.id) fail(400, 'You cannot remove the owner or yourself.');
    if (target.role === 'admin' && c.owner_id !== req.user.id) fail(403, 'Only the owner can remove another Community admin.');
    refresh(c.id);
    transaction(() => {
      run('DELETE FROM collection_members WHERE user_id=? AND subcommunity_id IN (SELECT id FROM subcommunities WHERE community_id=?)', req.params.userId, c.id);
      run('DELETE FROM group_members WHERE user_id=? AND group_id IN (SELECT id FROM groups WHERE community_id=?)', req.params.userId, c.id);
      run(`DELETE FROM scoped_admins WHERE user_id=? AND ((scope_type='subcommunity' AND scope_id IN (SELECT id FROM subcommunities WHERE community_id=?)) OR (scope_type='group' AND scope_id IN (SELECT id FROM groups WHERE community_id=?)))`, req.params.userId, c.id, c.id);
      run('DELETE FROM community_members WHERE community_id=? AND user_id=?', c.id, req.params.userId);
      run('UPDATE users SET last_community_id=NULL WHERE id=? AND last_community_id=?', req.params.userId, c.id);
    });
    res.json({ ok: true });
  });
  app.put('/api/admins/:type/:id/:userId', (req, res) => {
    const { type, id, userId } = req.params;
    if (!['subcommunity','group'].includes(type)) fail(400, 'Invalid admin scope.');
    const entity = type === 'group' ? group(id) : sub(id);
    membership(userId, entity.community_id);
    const canAssign = type === 'subcommunity' || !entity.subcommunity_id ? communityAdmin(req.user.id, entity.community_id) : subAdmin(req.user.id, sub(entity.subcommunity_id));
    if (!canAssign) fail(403, 'An admin of the parent space must assign this role.');
    const enabled = boolean(req.body.enabled, 'Admin assignment');
    if (enabled) {
      run('INSERT OR IGNORE INTO scoped_admins VALUES (?,?,?)', type, id, userId);
      if (type === 'group') { run('INSERT OR IGNORE INTO group_members(group_id,user_id) VALUES (?,?)', id, userId); joinParent(userId,entity); }
      else run('INSERT OR IGNORE INTO collection_members VALUES (?,?)',id,userId);
    } else run('DELETE FROM scoped_admins WHERE scope_type=? AND scope_id=? AND user_id=?', type, id, userId);
    refresh(entity.community_id); res.json({ ok: true });
  });
  app.post('/api/invitations', (req, res) => {
    const { community_id: cid, group_id: gid } = req.body;
    membership(req.user.id, cid);
    if (gid) {
      const g = group(gid);
      if (g.community_id !== cid || !groupAdmin(req.user.id, g)) fail(403, 'Only Circle admins can invite people into this Circle.');
    } else if (!communityAdmin(req.user.id, cid)) fail(403, 'Only Community admins can invite new members.');
    const value = token();
    const expires = Date.now() + 7 * 86400 * 1000;
    run('INSERT INTO invitations VALUES (?,?,?,?,?)', hash(value), cid, gid || null, req.user.id, expires);
    res.status(201).json({ path: `/?invite=${value}`, expires_at: expires });
  });
  app.post('/api/invitations/accept', (req, res) => {
    if (typeof req.body.token !== 'string') fail(400, 'Paste a valid invitation link.');
    const inv = one('SELECT * FROM invitations WHERE token_hash=?', hash(req.body.token));
    if (!inv || inv.expires_at < Date.now()) fail(410, 'This invitation is invalid or has expired. Ask an admin for a new link.');
    // Revoked admin rights also revoke outstanding invitations from that admin.
    let stillAdmin = false;
    try { stillAdmin = inv.group_id ? groupAdmin(inv.created_by, group(inv.group_id)) : communityAdmin(inv.created_by, inv.community_id); } catch { /* removed creator */ }
    if (!stillAdmin) fail(410, 'This invitation has been revoked. Ask an admin for a new link.');
    if (inv.group_id && !one('SELECT 1 FROM community_members WHERE community_id=? AND user_id=?', inv.community_id, req.user.id)) fail(403, 'Join the Community with a Community invitation before accepting a Circle invitation.');
    transaction(() => {
      if (!inv.group_id) run("INSERT OR IGNORE INTO community_members VALUES (?,?,'member')", inv.community_id, req.user.id);
      if (inv.group_id) { run('INSERT OR IGNORE INTO group_members(group_id,user_id) VALUES (?,?)', inv.group_id, req.user.id); joinParent(req.user.id,group(inv.group_id)); }
      run('UPDATE users SET last_community_id=? WHERE id=?', inv.community_id, req.user.id);
    });
    refresh(inv.community_id);
    res.json({ community_id: inv.community_id, group_id: inv.group_id });
  });
  app.post('/api/groups/:id/join', (req, res) => {
    const g = visibleCircle(req.user.id, req.params.id);
    if (g.private && !groupAdmin(req.user.id, g) && !joined(req.user.id, g.id)) fail(403, 'A Circle admin must invite you.');
    transaction(() => {
      run('INSERT OR IGNORE INTO group_members(group_id,user_id,last_read) VALUES (?,?,?)', g.id, req.user.id, one('SELECT COALESCE(MAX(id),0) AS n FROM messages WHERE group_id=?', g.id).n);
      joinParent(req.user.id,g);
    });
    refresh(g.community_id); res.json({ ok: true });
  });
  app.delete('/api/groups/:id/join', (req, res) => {
    const g = visibleCircle(req.user.id, req.params.id);
    run('DELETE FROM group_members WHERE group_id=? AND user_id=?', g.id, req.user.id);
    refresh(g.community_id); res.json({ ok: true });
  });
  app.patch('/api/groups/:id/membership', (req, res) => {
    const g = visibleCircle(req.user.id, req.params.id);
    const previous = joined(req.user.id, g.id);
    if (!previous) fail(403, 'Join this Circle first.');
    // Validate every field before writing any preferences.
    const mute = req.body.muted === undefined ? previous.muted : boolean(req.body.muted, 'Muted');
    const unread = req.body.marked_unread === undefined ? previous.marked_unread : boolean(req.body.marked_unread, 'Unread');
    if (req.body.pinned !== undefined) boolean(req.body.pinned, 'Pinned');
    if (req.body.pin_position !== undefined && (!Number.isSafeInteger(req.body.pin_position) || req.body.pin_position < 0)) fail(400, 'Invalid pinned position.');
    if (req.body.read_to !== undefined && (!Number.isSafeInteger(req.body.read_to) || req.body.read_to < 0)) fail(400, 'Invalid read position.');
    if (req.body.read_to !== undefined && req.body.marked_unread === true) fail(400, 'Choose read or unread.');
    if (req.body.pin_position !== undefined && previous.pin_position === null && req.body.pinned !== true) fail(400, 'Pin this Circle before changing its position.');
    let changed = false;
    transaction(() => {
      const preferences = run('UPDATE group_members SET muted=?,marked_unread=? WHERE group_id=? AND user_id=? AND (muted<>? OR marked_unread<>?)', mute, unread, g.id, req.user.id, mute, unread);
      changed = !!preferences.changes;
      if (req.body.pinned !== undefined || req.body.pin_position !== undefined) {
        const pins = all(`SELECT gm.group_id FROM group_members gm JOIN groups g ON g.id=gm.group_id
          WHERE gm.user_id=? AND g.community_id=? AND gm.pin_position IS NOT NULL ORDER BY gm.pin_position,g.id`, req.user.id, g.community_id).map(x => x.group_id);
        const old = pins.indexOf(g.id);
        if (old !== -1) pins.splice(old,1);
        if (req.body.pinned !== false) pins.splice(Math.min(req.body.pin_position ?? (old === -1 ? pins.length : old), pins.length),0,g.id);
        run('UPDATE group_members SET pin_position=NULL WHERE group_id=? AND user_id=?',g.id,req.user.id);
        pins.forEach((id,i) => run('UPDATE group_members SET pin_position=? WHERE group_id=? AND user_id=?',i,id,req.user.id));
        changed = true;
      }
      if (req.body.read_to !== undefined) {
        const max = one('SELECT COALESCE(MAX(id),0) AS n FROM messages WHERE group_id=?', g.id).n;
        const readTo = Math.min(max, req.body.read_to);
        const read = run('UPDATE group_members SET last_read=MAX(last_read,?),marked_unread=0 WHERE group_id=? AND user_id=? AND (last_read<? OR marked_unread<>0)',readTo,g.id,req.user.id,readTo);
        const seen = run('UPDATE notifications SET seen=1 WHERE user_id=? AND seen=0 AND message_id IN (SELECT id FROM messages WHERE group_id=? AND id<=?)', req.user.id, g.id, readTo);
        changed ||= !!read.changes || !!seen.changes;
      }
    });
    if (changed) refreshUser(req.user.id);
    res.json({ ok: true });
  });
  app.get('/api/groups/:id/messages', (req, res) => {
    visibleCircle(req.user.id, req.params.id);
    const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : Number(req.query.before);
    if (!Number.isSafeInteger(before) || before < 1) fail(400, 'Invalid message cursor.');
    const messages = all(`SELECT m.*,u.name,u.avatar_id,p.body AS parent_body,pu.name AS parent_name FROM messages m JOIN users u ON u.id=m.user_id
      LEFT JOIN messages p ON p.id=m.reply_to LEFT JOIN users pu ON pu.id=p.user_id
      WHERE m.group_id=? AND m.id<? ORDER BY m.id DESC LIMIT 100`, req.params.id, before).reverse();
    for (const m of messages) m.files = all('SELECT f.id,f.name,f.mime,f.size FROM files f JOIN message_files mf ON mf.file_id=f.id WHERE mf.message_id=?', m.id);
    res.json({ messages, has_more: messages.length === 100 });
  });
  app.get('/api/groups/:id/threads/:messageId', (req, res) => {
    visibleCircle(req.user.id, req.params.id);
    const root = one('SELECT * FROM messages WHERE id=? AND group_id=?', req.params.messageId, req.params.id) || fail(404, 'Thread not found.');
    const rootId = root.reply_to || root.id;
    const messages = all('SELECT m.*,u.name,u.avatar_id FROM messages m JOIN users u ON u.id=m.user_id WHERE m.group_id=? AND (m.id=? OR m.reply_to=?) ORDER BY m.id LIMIT 500', req.params.id, rootId, rootId);
    for (const m of messages) m.files = all('SELECT f.id,f.name,f.mime,f.size FROM files f JOIN message_files mf ON mf.file_id=f.id WHERE mf.message_id=?', m.id);
    res.json({ messages });
  });
  app.post('/api/groups/:id/messages', rateLimit({ windowMs: 60_000, limit: options.testing ? 1000 : 90, keyGenerator: req => req.user.id, message: { error: 'Please slow down and try again in a moment.' } }), (req, res) => {
    const g = visibleCircle(req.user.id, req.params.id);
    if (!joined(req.user.id, g.id)) fail(403, 'Join this Circle to send messages.');
    if (g.admin_only && !groupAdmin(req.user.id, g)) fail(403, 'Only admins can post or reply in this Circle.');
    const body = req.body.body ?? '';
    const files = req.body.files ?? [];
    const urgent = boolean(req.body.urgent ?? false, 'Urgent');
    if (typeof body !== 'string' || body.length > 10000) fail(400, 'Messages can contain up to 10,000 characters.');
    if (!Array.isArray(files) || files.length > 5 || files.some(id => typeof id !== 'string') || new Set(files).size !== files.length) fail(400, 'Attach up to five files.');
    if (!body.trim() && !files.length) fail(400, 'Write a message or attach a file.');
    for (const id of files) if (!one('SELECT 1 FROM files WHERE id=? AND user_id=?', id, req.user.id) || one('SELECT 1 FROM message_files WHERE file_id=?', id)) fail(400, 'An attachment is unavailable. Please upload it again.');
    let reply = req.body.reply_to ?? null;
    if (reply !== null) {
      if (!Number.isSafeInteger(reply)) fail(400, 'Invalid reply.');
      const parent = one('SELECT * FROM messages WHERE id=? AND group_id=?', reply, g.id);
      if (!parent || parent.deleted) fail(400, 'That message is no longer available to reply to.');
      reply = parent.reply_to || parent.id;
    }
    let id;
    const recipients = all('SELECT user_id FROM group_members WHERE group_id=? AND user_id<>? AND muted=0', g.id, req.user.id);
    transaction(() => {
      id = Number(run('INSERT INTO messages(group_id,user_id,body,reply_to,urgent) VALUES (?,?,?,?,?)', g.id, req.user.id, body.trim(), reply, urgent).lastInsertRowid);
      for (const fid of files) run('INSERT INTO message_files VALUES (?,?)', id, fid);
      run('UPDATE group_members SET last_read=?,marked_unread=0 WHERE group_id=? AND user_id=?', id, g.id, req.user.id);
      for (const r of recipients) run('INSERT INTO notifications(user_id,message_id) VALUES (?,?)', r.user_id, id);
    });
    refresh(g.community_id);
    if (pushEnabled) for (const recipient of recipients) for (const s of all('SELECT * FROM push_subscriptions WHERE user_id=?', recipient.user_id)) {
      // No message contents in device notifications; access is checked when the app opens.
      webPush.sendNotification(JSON.parse(s.subscription), JSON.stringify({ title: 'New message on Gatherly', body: 'You have a new message in a Circle you joined.', url: `/?community=${g.community_id}&group=${g.id}` }), { TTL: 3600, timeout: 10000, proxy: process.env.HTTPS_PROXY || process.env.https_proxy }).catch(error => {
        if ([404,410].includes(error.statusCode)) run('DELETE FROM push_subscriptions WHERE endpoint=?', s.endpoint);
      });
    }
    res.status(201).json({ id });
  });
  app.patch('/api/messages/:id', (req, res) => {
    const m = one('SELECT * FROM messages WHERE id=? AND deleted=0', req.params.id) || fail(404, 'Message not found.');
    const g = visibleCircle(req.user.id, m.group_id);
    if (m.user_id !== req.user.id && !groupAdmin(req.user.id, g)) fail(403, 'Only the author or a Circle admin can change urgency.');
    if (!joined(req.user.id, g.id) || (g.admin_only && !groupAdmin(req.user.id,g))) fail(403, 'Posting permissions are required to change urgency.');
    run('UPDATE messages SET urgent=? WHERE id=?', boolean(req.body.urgent, 'Urgent'), m.id);
    refresh(g.community_id); res.json({ ok: true });
  });
  app.delete('/api/messages/:id', (req, res) => {
    const m = one('SELECT * FROM messages WHERE id=?', req.params.id) || fail(404, 'Message not found.');
    const g = visibleCircle(req.user.id, m.group_id);
    if (m.user_id !== req.user.id && !groupAdmin(req.user.id, g)) fail(403, 'You can only delete your own messages.');
    transaction(() => {
      run("UPDATE messages SET deleted=1,body='' WHERE id=?", m.id);
      run('DELETE FROM message_files WHERE message_id=?', m.id);
      run('DELETE FROM notifications WHERE message_id=?', m.id);
    });
    refresh(g.community_id); res.json({ ok: true });
  });
  const upload = multer({ dest: uploadDir, limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 0 } });
  app.post('/api/uploads', rateLimit({ windowMs: 3600_000, limit: options.testing ? 1000 : 100, keyGenerator: req => req.user.id, message: { error: 'Upload limit reached. Please try again later.' } }), upload.single('file'), (req, res) => {
    if (!req.file) fail(400, 'Choose a file to upload.');
    const file = req.file;
    // Only recognized raster formats render inline. All other uploads download as attachments.
    const header = Buffer.alloc(16);
    const fd = openSync(file.path, 'r');
    try { readSync(fd, header, 0, 16, 0); } finally { closeSync(fd); }
    let mime = 'application/octet-stream';
    if (header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
    else if (header[0] === 255 && header[1] === 216 && header[2] === 255) mime = 'image/jpeg';
    else if (['GIF87a','GIF89a'].includes(header.toString('ascii',0,6))) mime = 'image/gif';
    else if (header.toString('ascii',0,4) === 'RIFF' && header.toString('ascii',8,12) === 'WEBP') mime = 'image/webp';
    const id = randomUUID();
    run('INSERT INTO files VALUES (?,?,?,?,?,?,?)', id, req.user.id, file.originalname.slice(0,200), file.filename, mime, file.size, Date.now());
    res.status(201).json({ file: { id, name: file.originalname.slice(0,200), mime, size: file.size } });
  });
  app.get('/api/files/:id', (req, res) => {
    const f = one('SELECT * FROM files WHERE id=?', req.params.id) || fail(404, 'File not found.');
    let allowed = f.user_id === req.user.id;
    const attached = one('SELECT m.group_id FROM message_files mf JOIN messages m ON m.id=mf.message_id WHERE mf.file_id=? AND m.deleted=0', f.id);
    if (attached) { try { visibleCircle(req.user.id, attached.group_id); allowed = true; } catch { /* no access */ } }
    if (!allowed && one('SELECT 1 FROM users WHERE avatar_id=?', f.id)) allowed = true;
    if (!allowed) for (const c of all('SELECT id FROM communities WHERE avatar_id=?', f.id)) if (one('SELECT 1 FROM community_members WHERE community_id=? AND user_id=?', c.id, req.user.id)) allowed = true;
    if (!allowed) for (const s of all('SELECT community_id FROM subcommunities WHERE avatar_id=?', f.id)) if (one('SELECT 1 FROM community_members WHERE community_id=? AND user_id=?', s.community_id, req.user.id)) allowed = true;
    if (!allowed) for (const g of all('SELECT id FROM groups WHERE avatar_id=?', f.id)) { try { visibleCircle(req.user.id, g.id); allowed = true; } catch { /* no access */ } }
    if (!allowed) fail(404, 'File not found.');
    res.type(imageTypes.has(f.mime) ? f.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${imageTypes.has(f.mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name).replaceAll("'", '%27')}`);
    res.sendFile(join(uploadDir, f.disk_name));
  });
  app.get('/api/notifications', (req, res) => res.json({ notifications: all(`SELECT n.id,n.seen,m.body,m.created_at,m.group_id,m.id AS message_id,u.name AS sender,g.name AS group_name,g.community_id
    FROM notifications n JOIN messages m ON m.id=n.message_id JOIN users u ON u.id=m.user_id
    JOIN groups g ON g.id=m.group_id
    JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=n.user_id
    JOIN community_members cm ON cm.community_id=g.community_id AND cm.user_id=n.user_id
    WHERE n.user_id=? AND m.deleted=0 ORDER BY n.id DESC LIMIT 80`, req.user.id) }));
  app.patch('/api/notifications', (req, res) => { const r = run('UPDATE notifications SET seen=1 WHERE user_id=? AND seen=0', req.user.id); if (r.changes) refreshUser(req.user.id); res.json({ ok: true }); });
  app.post('/api/push/subscribe', (req, res) => {
    if (!pushEnabled) fail(503, 'Push notifications need VAPID configuration. In-app notifications are available.');
    const s = req.body.subscription;
    if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 2048 || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') fail(400, 'Invalid push subscription.');
    let url; try { url = new URL(s.endpoint); } catch { fail(400, 'Invalid push endpoint.'); }
    const host = url.hostname;
    const allowedHosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-par02p.notify.windows.com'];
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !(allowedHosts.includes(host) || host.endsWith('.notify.windows.com') || host.endsWith('.push.apple.com') || host.endsWith('.push.services.mozilla.com'))) fail(400, 'Unsupported push provider.');
    run('INSERT INTO push_subscriptions VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription=excluded.subscription', s.endpoint, req.user.id, JSON.stringify(s));
    res.json({ ok: true });
  });
  app.delete('/api/push/subscribe', (req, res) => {
    if (typeof req.body.endpoint === 'string') run('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?', req.body.endpoint, req.user.id);
    res.json({ ok: true });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'This endpoint does not exist.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 15 MB or smaller.' : 'Upload one file at a time.' });
    const status = error.status || 500;
    if (status === 500) console.error('Request failed:', error.message);
    res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : error.message });
  });
  if (production && existsSync(resolve('dist/index.html'))) {
    app.use(express.static(resolve('dist'), { setHeaders: (res, path) => { if (path.endsWith('/index.html') || path.endsWith('/sw.js')) res.setHeader('Cache-Control','no-store'); } }));
    app.get('/{*path}', (req, res) => { res.setHeader('Cache-Control','no-store'); res.sendFile(resolve('dist/index.html')); });
  }
  return { app, db, close: () => { for (const set of streams.values()) for (const res of set) res.end(); db.close(); } };
}
