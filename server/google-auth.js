import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'node:crypto';
import { hash, token, passwordMatches } from './security.js';

const challengeAge = 5 * 60 * 1000;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export function installGoogleAuth({ app, db, auth, limited, clientId, production, session, publicUser, refreshUser, transaction, testing, verifyToken }) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const google = new OAuth2Client(clientId);
  const verify = testing && verifyToken ? verifyToken : async credential => (await google.verifyIdToken({ idToken: credential, audience: clientId })).getPayload();
  const cookieName = linking => linking ? 'churp_google_link' : 'churp_google_login';
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: production, path: '/api' };
  function configured() { if (!clientId) fail(503, 'Google Sign-in is not configured yet. Use your username and password.'); }
  async function password(req) {
    if (!req.user.password) fail(400, 'This account already uses Google Sign-in.');
    if (typeof req.body.currentPassword !== 'string' || req.body.currentPassword.length > 128 || !await passwordMatches(req.body.currentPassword, req.user.password)) fail(403, 'Your current password is incorrect.');
    const fresh = one('SELECT * FROM users WHERE id=?', req.user.id);
    if (fresh?.password !== req.user.password || !one('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?', hash(req.cookies.gatherly_session), Date.now())) fail(409, 'Account security changed. Sign in again.');
    return fresh;
  }
  function challenge(req, res, purpose) {
    const linking = purpose === 'link', value = token(), now = Date.now();
    const previous = req.cookies[cookieName(linking)];
    if (typeof previous === 'string') run('DELETE FROM google_auth_challenges WHERE token_hash=?', hash(previous));
    run('DELETE FROM google_auth_challenges WHERE expires_at<=?', now);
    run('INSERT INTO google_auth_challenges(token_hash,user_id,session_hash,purpose,expires_at) VALUES (?,?,?,?,?)', hash(value), linking ? req.user.id : null, linking ? hash(req.cookies.gatherly_session) : null, purpose, now + challengeAge);
    res.cookie(cookieName(linking), value, { ...cookieOptions, maxAge: challengeAge });
    res.json({ nonce: value });
  }
  async function credential(req, res, linking) {
    configured();
    const nonce = req.cookies[cookieName(linking)];
    res.clearCookie(cookieName(linking), cookieOptions);
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) fail(400, 'Google Sign-in expired. Please try again.');
    // Consume before the network call: concurrent requests cannot reuse the proof.
    const entry = one('DELETE FROM google_auth_challenges WHERE token_hash=? RETURNING *', hash(nonce));
    if (!entry || entry.expires_at <= Date.now() || (linking ? entry.purpose !== 'link' || entry.user_id !== req.user.id || entry.session_hash !== hash(req.cookies.gatherly_session) : !['login', 'signup'].includes(entry.purpose))) fail(400, 'Google Sign-in expired. Please try again.');
    if (typeof req.body.credential !== 'string' || !req.body.credential || req.body.credential.length > 16000) fail(400, 'Missing or invalid Google credential.');
    let payload;
    try { payload = await verify(req.body.credential); }
    catch { fail(401, 'Google could not verify this sign-in. Please try again.'); }
    if (typeof payload?.sub !== 'string' || !payload.sub || payload.sub.length > 255 || payload.email_verified !== true || typeof payload.email !== 'string' || payload.email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(payload.email)) fail(401, 'A verified Google account is required.');
    if (payload.nonce !== nonce) fail(401, 'Google Sign-in did not match this browser. Please try again.');
    return { payload, entry };
  }
  app.post('/api/auth/google/challenge', limited, (req, res) => {
    configured();
    if (req.body.createAccount !== undefined && typeof req.body.createAccount !== 'boolean') fail(400, 'Choose sign in or create an account.');
    challenge(req, res, req.body.createAccount === true ? 'signup' : 'login');
  });
  app.post('/api/auth/google', limited, async (req, res) => {
    const { payload, entry } = await credential(req, res, false);
    const email = payload.email.toLowerCase();
    const user = transaction(() => {
      let user = one('SELECT * FROM users WHERE google_id=?', payload.sub);
      if (!user) {
        if (entry.purpose !== 'signup') fail(409, 'This Google account is not connected to Churp yet. Already have an account? Sign in with your username, then open Your corner → Account settings → Connect Google. New here? Choose Create an account first.');
        // Email is a duplicate-account hint, never authorization to merge identities.
        if (one('SELECT 1 FROM users WHERE email=? AND email_verified_at IS NOT NULL', email)) fail(409, 'An existing Churp account uses this email. Sign in with your username, then open Your corner → Account settings → Connect Google.');
        const id = randomUUID();
        run("INSERT INTO users(id,username,name,google_id,google_email,avatar_style) VALUES (?,?,?,?,?,'portrait')", id, `g_${id.replaceAll('-', '').slice(0, 20)}`, (typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'New member').slice(0, 80), payload.sub, email);
        user = one('SELECT * FROM users WHERE id=?', id);
      } else {
        run('UPDATE users SET google_email=? WHERE id=?', email, user.id);
        user.google_email = email;
      }
      return user;
    });
    res.json({ user: session(res, user) });
  });
  app.post('/api/me/google/challenge', auth, limited, async (req, res) => {
    configured();
    const user = await password(req);
    if (user.google_id) fail(409, 'A Google account is already connected.');
    challenge(req, res, 'link');
  });
  app.post('/api/me/google', auth, limited, async (req, res) => {
    const { payload, entry } = await credential(req, res, true);
    transaction(() => {
      // Password resets and logout invalidate a pending connection, including while Google verifies it.
      if (!one('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?', entry.session_hash, req.user.id, Date.now())) fail(401, 'Please sign in again before connecting Google.');
      const fresh = one('SELECT * FROM users WHERE id=?', req.user.id);
      if (!fresh.password || fresh.password !== req.user.password || fresh.google_id) fail(409, 'Account security changed. Reload your settings and try again.');
      if (one('SELECT 1 FROM users WHERE google_id=?', payload.sub)) fail(409, 'That Google account is already connected to another Churp account. No accounts have been merged.');
      run('UPDATE users SET google_id=?,google_email=? WHERE id=?', payload.sub, payload.email.toLowerCase(), req.user.id);
      run('DELETE FROM google_auth_challenges WHERE user_id=?', req.user.id);
      run('DELETE FROM sessions WHERE token_hash=?', entry.session_hash);
    });
    refreshUser(req.user.id);
    res.json({ user: session(res, one('SELECT * FROM users WHERE id=?', req.user.id)) });
  });
  app.delete('/api/me/google', auth, limited, async (req, res) => {
    const fresh = await password(req);
    if (fresh.google_id !== req.user.google_id) fail(409, 'Your connected Google account changed. Reload your settings and try again.');
    transaction(() => {
      run('UPDATE users SET google_id=NULL,google_email=NULL WHERE id=?', req.user.id);
      run('DELETE FROM google_auth_challenges WHERE user_id=?', req.user.id);
    });
    refreshUser(req.user.id);
    res.json({ user: publicUser(one('SELECT * FROM users WHERE id=?', req.user.id)) });
  });
}
