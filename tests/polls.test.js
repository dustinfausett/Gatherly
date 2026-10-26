import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import * as enc from '../shared/encryption.js';
import { validatePoll, parsePoll, validateAnswers, encodeVote, parseVote } from '../shared/polls.js';

const definition = () => validatePoll({ title: 'Our next get-together', questions: [
  { text: 'Which day?', type: 'single', options: ['Saturday', 'Sunday'] },
  { text: 'What should we bring?', type: 'multiple', options: ['Picnic', 'Games', 'Blankets'] },
] });
test('poll validation supports only choice questions and complete, unique answers', () => {
  const poll = definition(); assert.deepEqual(parsePoll(JSON.stringify(poll)), poll);
  for (const type of ['text', 'yes/no']) assert.throws(() => validatePoll({ ...poll, questions: [{ ...poll.questions[0], type }] }));
  assert.throws(() => validatePoll({ ...poll, questions: [{ ...poll.questions[0], options: ['Yes', 'yes'] }] }));
  for (const answers of [[], [[0]], [[0, 1], [0]], [[2], [0]], [[0], [1, 1]], [[0], []]]) assert.throws(() => validateAnswers(poll, answers));
  assert.deepEqual(validateAnswers(poll, [[1], [2, 0]]), [[1], [0, 2]]);
  assert.deepEqual(parseVote(encodeVote(7, poll, [[0], [0, 2]]), 7, poll), [[0], [0, 2]]);
  assert.equal(parseVote(encodeVote(7, poll, [[0], [0, 2]]), 8, poll), null);
});

test('encrypted polls enforce membership, history, one current response, closure and quiet updates', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'churp-polls-'));
  const runtime = createApp({ dataDir: dir, testing: true, googleClientId: '', pushEnabled: false });
  const server = createServer(runtime.app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => { runtime.close(); await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); });
  async function req(path, actor, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { ...(actor ? { cookie: actor.cookie, 'x-churp-device': actor.deviceId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }
  async function ok(...args) { const result = await req(...args); assert.ok(result.status < 300, JSON.stringify(result)); return result.data; }
  async function actor(name, self = false) {
    const response = await fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({birth_date:'1990-01-01', username: name, name, password: 'Poll fixture password!' }) });
    const a = { ...(await response.json()).user, cookie: response.headers.get('set-cookie').split(';')[0], deviceId: randomUUID() };
    if (self) {
      const keys = await enc.generateIdentity(a.id), backup = await enc.protectPrivate(keys.privateKey, enc.randomSecret());
      const payload = enc.enrollmentPayload({ userId: a.id, publicKey: keys.publicKey, backupHash: await enc.digest(backup), deviceId: a.deviceId, deviceName: 'Poll fixture' });
      await ok('/e2ee/identity', a, 'POST', { ...payload, backup, signature: await enc.sign(keys.privateKey, 'enroll', payload) }); a.privateKey = keys.privateKey;
    } else { const result = await ok('/e2ee/managed-device', a, 'POST', { deviceId: a.deviceId, deviceName: 'Poll fixture' }); a.privateKey = await enc.readPrivate(result.privateKey); }
    return a;
  }
  const owner = await actor('poll_owner', true), member = await actor('poll_member'), outsider = await actor('poll_outsider');
  const tree = (await ok('/communities', owner, 'POST', { name: 'Poll Tree' })).community;
  const invite = (await ok('/invitations', owner, 'POST', { community_id: tree.id })).path.split('invite=')[1];
  await ok('/invitations/accept', member, 'POST', { token: invite });
  const nest = (await ok(`/communities/${tree.id}/circles`, owner, 'POST', { name: 'Announcements', admin_only: true })).group;
  await ok(`/groups/${nest.id}/join`, member, 'POST');
  async function prepare(a, body, kind, replyTo = null) {
    const rs = await ok(`/groups/${nest.id}/e2ee/roster`, a), clientId = randomUUID();
    const ciphertext = await enc.seal(a.privateKey, rs.readers.map(r => r.public_key), { version: 1, kind: 'nest-message', groupId: nest.id, clientId, senderId: a.id, signerId: a.id, rosterHash: rs.roster_hash, replyTo, migrated: false, selfEncrypted: rs.self_encrypted, contentType: kind, body, attachments: [] });
    const payload = enc.sendPayload({ groupId: nest.id, clientId, rosterHash: rs.roster_hash, cipherHash: await enc.digest(ciphertext), files: [], replyTo });
    return { ciphertext, clientId, rosterHash: rs.roster_hash, files: [], reply_to: replyTo, signature: await enc.sign(a.privateKey, 'send', payload) };
  }
  const body = JSON.stringify(definition());
  assert.equal((await req(`/groups/${nest.id}/messages`, member, 'POST', { ...await prepare(member, body, 'poll'), message_kind: 'poll' })).status, 403);
  const sent = await prepare(owner, body, 'poll');
  const pollId = (await ok(`/groups/${nest.id}/messages`, owner, 'POST', { ...sent, message_kind: 'poll' })).id;
  assert.equal((await ok(`/groups/${nest.id}/messages`, owner, 'POST', { ...sent, message_kind: 'poll' })).id, pollId);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM polls').get().n, 1);
  await ok(`/groups/${nest.id}/membership`, member, 'PATCH', { read_to: pollId });
  const notifications = runtime.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
  const vote = await prepare(member, encodeVote(pollId, definition(), [[0], [0, 2]]), 'poll_vote', pollId);
  assert.equal((await req(`/messages/${pollId}/poll/vote`, member, 'POST', { body: 'Private answer', reply_to: pollId })).status, 400);
  assert.equal((await req(`/groups/${nest.id}/messages`, member, 'POST', { ...vote, message_kind: 'poll_vote' })).status, 400);
  const response = await ok(`/messages/${pollId}/poll/vote`, member, 'POST', vote);
  assert.equal((await ok(`/messages/${pollId}/poll/vote`, member, 'POST', vote)).id, response.id);
  const updated = await prepare(member, encodeVote(pollId, definition(), [[1], [1]]), 'poll_vote', pollId);
  await ok(`/messages/${pollId}/poll/vote`, member, 'POST', updated);
  const results = await ok(`/messages/${pollId}/poll`, owner);
  assert.equal(results.votes.length, 1); assert.equal(results.votes[0].body, '');
  const contents = await enc.open(owner.privateKey, results.votes[0].signer_key, results.votes[0].ciphertext);
  assert.deepEqual(parseVote(contents.body, pollId, definition()), [[1], [1]]);
  assert.equal(contents.contentType, 'poll_vote');
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, notifications);
  assert.equal((await ok(`/communities/${tree.id}`, owner)).community.circles[0].unread, 0);
  assert.equal((await ok(`/communities/${tree.id}`, member)).community.circles[0].unread, 0);
  assert.equal((await ok(`/groups/${nest.id}/messages`, member)).messages.length, 1);
  assert.equal((await ok(`/groups/${nest.id}/threads/${pollId}`, member)).messages.length, 1);
  assert.equal((await req(`/groups/${nest.id}/threads/${response.id}`, member)).status, 404);
  for (const m of runtime.db.prepare('SELECT * FROM messages').all()) { assert.equal(m.body, ''); assert.ok(!m.ciphertext.includes('Saturday')); }
  assert.equal((await req(`/messages/${pollId}/poll`, outsider)).status, 403);
  assert.equal((await req(`/messages/${pollId}/poll`, member, 'PATCH', { closed: true })).status, 403);
  await ok(`/messages/${pollId}/poll`, owner, 'PATCH', { closed: true });
  assert.equal((await req(`/messages/${pollId}/poll/vote`, member, 'POST', await prepare(member, encodeVote(pollId, definition(), [[0], [1]]), 'poll_vote', pollId))).status, 409);
  await ok(`/messages/${pollId}/poll`, owner, 'PATCH', { closed: false });
  const late = await actor('poll_late'); await ok('/invitations/accept', late, 'POST', { token: invite }); await ok(`/groups/${nest.id}/join`, late, 'POST');
  assert.equal((await req(`/messages/${pollId}/poll`, late)).status, 404);
  assert.equal((await req(`/messages/${pollId}/poll/vote`, late, 'POST', { reply_to: pollId })).status, 404);
  await ok(`/groups/${nest.id}/join`, member, 'DELETE');
  assert.equal((await req(`/messages/${pollId}/poll`, member)).status, 403);
  await ok(`/groups/${nest.id}/join`, member, 'POST'); assert.equal((await req(`/messages/${pollId}/poll`, member)).status, 404);
  await ok(`/messages/${pollId}`, owner, 'DELETE');
  assert.equal((await req(`/messages/${pollId}/poll`, owner)).status, 404);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM poll_votes').get().n, 0);
  assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE message_kind='poll_vote' AND (body<>'' OR ciphertext IS NOT NULL)").get().n, 0);
  assert.deepEqual(runtime.db.prepare('PRAGMA foreign_key_check').all(), []);
});
