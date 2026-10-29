import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firstName,hasFirstNameToken,personalizeMessage,scheduledRecipientBody} from '../shared/personalization.js';

test('first-name substitutions handle repeated tokens, Unicode, whitespace and literal replacement characters',()=>{
  assert.equal(firstName('  Avery\u00a0Brown '),'Avery');
  assert.equal(firstName('José Rivera'),'José');
  assert.equal(firstName("Anne-Marie O’Neill"),'Anne-Marie');
  assert.equal(firstName(null),'there'); assert.equal(firstName(' \t '),'there');
  assert.equal(personalizeMessage('Hi [first name],\nThanks, [First_Name]!','$& Smith'),'Hi $&,\nThanks, $&!');
  assert.equal(personalizeMessage('Hello [FIRSTNAME] / [ first name ]!','Avery Brown'),'Hello Avery / Avery!');
  assert.equal(personalizeMessage('Hi [first name], bring [snacks].',null),'Hi there, bring [snacks].');
  assert.equal(hasFirstNameToken('A regular message'),false);
  assert.equal(hasFirstNameToken('Hello [First Name]'),true);
  assert.equal(personalizeMessage('Keep ordinary text & [unknown] exactly.','Blake Rivera'),'Keep ordinary text & [unknown] exactly.');
  assert.throws(()=>personalizeMessage('[first name]'.repeat(800),'A'.repeat(80)),/10,000 characters/);
});

test('scheduled batches resolve each conversation independently and preserve literal text for older drafts',()=>{
  const draft={body:'Hi [first name], see you soon.',personalization:{kind:'first-name',names:{avery:'Avery Brown',blake:'Blake Rivera'}}};
  assert.equal(scheduledRecipientBody(draft,'avery'),'Hi Avery, see you soon.');
  assert.equal(scheduledRecipientBody(draft,'blake'),'Hi Blake, see you soon.');
  assert.equal(scheduledRecipientBody({...draft,body:'Updated for [first name].'},'blake'),'Updated for Blake.');
  assert.equal(scheduledRecipientBody({body:'Literal [first name] from an older draft'},'avery'),'Literal [first name] from an older draft');
  assert.throws(()=>scheduledRecipientBody(draft,'missing'),/missing its recipient name/);
});
