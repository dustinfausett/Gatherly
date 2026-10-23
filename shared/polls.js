// Poll text lives inside the same signed, encrypted contents as chat messages.
export const POLL_LIMITS = { questions: 10, options: 10, title: 100, question: 240, option: 100 };
function label(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${name} must contain 1–${max} characters.`);
  return value.trim();
}
export function validatePoll(value) {
  const title = label(value?.title, POLL_LIMITS.title, 'Poll title');
  if (!Array.isArray(value.questions) || !value.questions.length || value.questions.length > POLL_LIMITS.questions) throw new Error('Add between 1 and 10 questions.');
  const questions = value.questions.map(q => {
    if (!['single', 'multiple'].includes(q.type)) throw new Error('Choose single-choice or multiple-choice.');
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > POLL_LIMITS.options) throw new Error('Each question needs 2–10 answer options.');
    const options = q.options.map(o => label(o, POLL_LIMITS.option, 'Answer option'));
    if (new Set(options.map(o => o.toLowerCase())).size !== options.length) throw new Error('Give each answer option a different name.');
    return { text: label(q.text, POLL_LIMITS.question, 'Question'), type: q.type, options };
  });
  const poll = { churp: 'poll', version: 1, title, questions };
  if (JSON.stringify(poll).length > 10000) throw new Error('This poll is too long. Shorten some questions or options.');
  return poll;
}
export function parsePoll(body) {
  try { const value = JSON.parse(body); return value.churp === 'poll' && value.version === 1 ? validatePoll(value) : null; } catch { return null; }
}
export function validateAnswers(poll, answers) {
  if (!Array.isArray(answers) || answers.length !== poll.questions.length) throw new Error('Answer every question before submitting.');
  return answers.map((a, i) => {
    const q = poll.questions[i];
    if (!Array.isArray(a) || !a.length || (q.type === 'single' && a.length !== 1) || new Set(a).size !== a.length || a.some(n => !Number.isSafeInteger(n) || n < 0 || n >= q.options.length)) throw new Error('Choose a valid answer for every question.');
    return [...a].sort((x, y) => x - y);
  });
}
export function encodeVote(pollId, poll, answers) {
  return JSON.stringify({ churp: 'poll-vote', version: 1, pollId, answers: validateAnswers(poll, answers) });
}
export function parseVote(body, pollId, poll) {
  try { const v = JSON.parse(body); return v.churp === 'poll-vote' && v.version === 1 && v.pollId === pollId ? validateAnswers(poll, v.answers) : null; } catch { return null; }
}
