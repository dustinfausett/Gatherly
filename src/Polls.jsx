import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, Field } from './components';
import { api, patch, post } from './api';
import { useEncryption } from './encryption/EncryptionGate';
import { sealMessage, decryptMessages } from './encryption/client';
import { POLL_LIMITS, validatePoll, parsePoll, validateAnswers, encodeVote, parseVote } from '../shared/polls';
import './polls.css';

const art = '/brand/polls/';
const newQuestion = () => ({ text: '', type: 'single', options: ['', ''] });
export const messagePreview = m => m?.message_kind === 'poll' ? parsePoll(m.body)?.title || 'Poll' : m?.body;

export function PollBuilder({ group, onClose, onSent }) {
  const { enabled } = useEncryption();
  const [title, setTitle] = useState(''), [questions, setQuestions] = useState([newQuestion()]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const prepared = useRef(null), submitted = useRef(false);
  function updateQuestion(index, values) { setQuestions(prev => prev.map((q, i) => i === index ? { ...q, ...values } : q)); }
  async function send(event) {
    event.preventDefault(); if (busy || submitted.current) return;
    setBusy(true); setError('');
    try {
      const body = JSON.stringify(validatePoll({ title, questions }));
      if (prepared.current?.body !== body) prepared.current = { body, request: enabled ? await sealMessage(group.id, body, [], null, null, 'poll') : { body } };
      await post(`/groups/${group.id}/messages`, { ...prepared.current.request, message_kind: 'poll' });
      submitted.current = true; onClose(); await onSent();
    } catch (e) { if (e.status === 409) prepared.current = null; setError(e.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Create a poll" subtitle="One quick question, or a few. Your poll arrives in an envelope." onClose={() => { if (!busy) onClose(); }} wide>
    <form className="form poll-builder" onSubmit={send}>
      <fieldset disabled={busy}>
        <Field label="Poll title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Our next family get-together" maxLength={POLL_LIMITS.title} required />
        {questions.map((q, i) => <section className="poll-question-editor" key={i}>
          <div className="poll-question-heading"><h3>Question {i + 1}</h3>{questions.length > 1 && <button className="icon-button" type="button" aria-label={`Remove question ${i + 1}`} onClick={() => setQuestions(prev => prev.filter((_, n) => n !== i))}><Trash2 size={17} /></button>}</div>
          <Field label={`Question ${i + 1}`} value={q.text} onChange={e => updateQuestion(i, { text: e.target.value })} placeholder="What would you like to ask?" maxLength={POLL_LIMITS.question} required />
          <Field label={`Answer type for question ${i + 1}`}><select value={q.type} onChange={e => updateQuestion(i, { type: e.target.value })}><option value="single">Choose one answer</option><option value="multiple">Choose multiple answers</option></select></Field>
          <div className="poll-option-editors">{q.options.map((option, n) => <div key={n}><img src={`${art}basket.png`} alt="" width="40" height="40" /><Field label={`Question ${i + 1}, option ${n + 1}`} value={option} onChange={e => updateQuestion(i, { options: q.options.map((o, j) => j === n ? e.target.value : o) })} placeholder={`Answer ${n + 1}`} maxLength={POLL_LIMITS.option} required />{q.options.length > 2 && <button type="button" className="icon-button" aria-label={`Remove option ${n + 1} from question ${i + 1}`} onClick={() => updateQuestion(i, { options: q.options.filter((_, j) => j !== n) })}><Trash2 size={15} /></button>}</div>)}</div>
          {q.options.length < POLL_LIMITS.options && <button className="text-button" type="button" onClick={() => updateQuestion(i, { options: [...q.options, ''] })}><Plus size={15} />Add answer</button>}
        </section>)}
        {questions.length < POLL_LIMITS.questions && <button className="button secondary" type="button" onClick={() => setQuestions(prev => [...prev, newQuestion()])}><Plus size={17} />Add another question</button>}
      </fieldset>
      <p className="poll-help">Nest members can respond, including in announcement-only Nests. Responses are linked to their accounts. Members joining later won’t see this poll.</p>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="form-footer"><button className="button primary" disabled={busy} type="submit">{busy ? 'Sending…' : 'Send poll'}</button></div>
    </form>
  </Modal>;
}

function Basket({ selected }) {
  return <span className={`poll-basket ${selected ? 'has-egg' : ''}`} aria-hidden="true">
    {selected && <img className="poll-choice-egg" src={`${art}egg.png`} alt="" width="40" height="40" />}
    <img className="poll-choice-basket" src={`${art}basket.png`} alt="" width="76" height="76" />
    {selected && <img className="poll-choice-basket-front" src={`${art}basket.png`} alt="" width="76" height="76" />}
  </span>;
}

function PollView({ poll, message, group, user, version, onClose }) {
  const { enabled } = useEncryption();
  const [data, setData] = useState(null), [answers, setAnswers] = useState(poll.questions.map(() => []));
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dirty = useRef(false), prepared = useRef(null);
  const q = poll.questions[step];
  async function read() {
    const result = await api(`/messages/${message.id}/poll`);
    const messages = enabled ? await decryptMessages(group.id, result.votes) : result.votes;
    const votes = messages.map(m => ({ userId: m.user_id, answers: !m.decryptionError && parseVote(m.body, message.id, poll) })).filter(v => v.answers);
    return { ...result, votes, unverified: votes.length !== messages.length };
  }
  function apply(result) {
    setData(result); setError('');
    if (!dirty.current) setAnswers(result.votes.find(v => v.userId === user.id)?.answers || poll.questions.map(() => []));
  }
  useEffect(() => { let active = true; read().then(result => { if (active) apply(result); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [message.id, version]);
  const mine = data?.votes.find(v => v.userId === user.id);
  const showResults = !!mine || !!data?.closed;
  let complete = false; try { validateAnswers(poll, answers); complete = true; } catch { /* Some questions still need an answer. */ }
  function choose(option) {
    dirty.current = true;
    setAnswers(prev => prev.map((a, i) => i !== step ? a : q.type === 'single' ? [option] : a.includes(option) ? a.filter(n => n !== option) : [...a, option]));
  }
  async function submit() {
    if (busy || !complete || data?.closed) return;
    setBusy(true); setError('');
    try {
      const body = encodeVote(message.id, poll, answers);
      if (prepared.current?.body !== body) prepared.current = { body, request: enabled ? await sealMessage(group.id, body, [], message.id, null, 'poll_vote') : { body, reply_to: message.id } };
      await post(`/messages/${message.id}/poll/vote`, prepared.current.request);
      prepared.current = null; dirty.current = false; apply(await read());
    } catch (e) { if (e.status === 409) { prepared.current = null; try { apply(await read()); } catch { /* Keep the submission error visible. */ } } setError(e.message); }
    finally { setBusy(false); }
  }
  async function changeStatus() {
    setBusy(true); setError('');
    try { await patch(`/messages/${message.id}/poll`, { closed: !data.closed }); apply(await read()); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title={poll.title} onClose={onClose} wide>
    <div className="poll-view">
      {error && <div className="error-banner" role="alert">{error}<button type="button" className="text-button" onClick={() => read().then(apply).catch(e => setError(e.message))}>Try again</button></div>}
      {!data ? <p role="status">Opening your poll…</p> : <>
        <div className="poll-progress"><span>Question {step + 1} of {poll.questions.length}</span><span>{data.closed ? 'Closed' : 'Open'}</span></div>
        <h3 className="poll-question-title">{q.text}</h3><p className="poll-help">{q.type === 'single' ? 'Choose one basket.' : 'Choose all the baskets that fit.'}</p>
        <fieldset className="poll-answers" disabled={busy || data.closed}>
          <legend className="visually-hidden">{q.text}</legend>
          {q.options.map((option, i) => {
            const count = data.votes.filter(v => v.answers[step].includes(i)).length;
            return <label className={`poll-answer ${answers[step].includes(i) ? 'is-selected' : ''}`} key={`${step}:${i}`}>
              <input type={q.type === 'single' ? 'radio' : 'checkbox'} name={`poll-${message.id}-question-${step}`} checked={answers[step].includes(i)} onChange={() => choose(i)} />
              <Basket selected={answers[step].includes(i)} /><span className="poll-answer-label">{option}{showResults && <small>{count} {count === 1 ? 'response' : 'responses'} · {data.votes.length ? Math.round(count / data.votes.length * 100) : 0}%</small>}</span>
            </label>;
          })}
        </fieldset>
        <div className="poll-step-actions">{step > 0 && <button className="button secondary" type="button" onClick={() => setStep(n => n - 1)}>Back</button>}{step < poll.questions.length - 1 ? <button className="button primary" type="button" disabled={!data.closed && !answers[step].length} onClick={() => setStep(n => n + 1)}>Next question</button> : !data.closed && <button className="button primary" type="button" disabled={!complete || busy} onClick={submit}>{busy ? 'Saving…' : mine ? 'Update answers' : 'Submit answers'}</button>}</div>
        <p className="poll-response-status" role="status">{mine ? 'Your answers are saved.' : data.closed ? 'This poll is closed.' : 'Your egg marks your choice. Submit to save your answers.'}{dirty.current && mine ? ' You have unsaved changes.' : ''}</p>
        {showResults && <p className="poll-help">{data.votes.length} {data.votes.length === 1 ? 'member has' : 'members have'} responded.{q.type === 'multiple' ? ' Members can choose more than one option.' : ''}</p>}
        {data.unverified && <p className="field-error" role="alert">Some responses could not be verified and aren’t included in these results. Try again to reload them.</p>}
        <p className="poll-help">Your response is linked to your account. You can change it until the poll closes.</p>
        {data.can_manage && <div className="poll-manage"><button className="text-button" type="button" disabled={busy} onClick={changeStatus}>{data.closed ? 'Reopen poll' : 'Close poll'}</button></div>}
      </>}
    </div>
  </Modal>;
}

export function PollEnvelope({ message, group, user, version }) {
  const poll = parsePoll(message.body);
  const [opening, setOpening] = useState(false), [open, setOpen] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  function touch() {
    if (opening) return;
    setOpening(true);
    timer.current = setTimeout(() => { setOpening(false); setOpen(true); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520);
  }
  if (!poll) return <p role="alert">This poll could not be opened.</p>;
  return <>
    <button type="button" className={`poll-envelope ${opening ? 'is-opening' : ''}`} aria-label={`Open poll: ${poll.title}`} onClick={touch} aria-haspopup="dialog">
      <span className="poll-envelope-letter" aria-hidden="true" /><img src={`${art}envelope.png`} alt="" width="300" height="200" /><span className="poll-envelope-flap" aria-hidden="true" /><strong>{poll.title}</strong>
    </button>
    {open && <PollView poll={poll} message={message} group={group} user={user} version={version} onClose={() => setOpen(false)} />}
  </>;
}
