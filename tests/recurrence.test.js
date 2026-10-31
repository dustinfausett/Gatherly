import {test} from 'node:test';import assert from 'node:assert/strict';
import {normalizeRecurrence,nextOccurrence,calendarParts} from '../shared/recurrence.js';
const zone='America/Denver',rule=extra=>normalizeRecurrence({frequency:'daily',interval:1,exclude:[],until:'',...extra});
test('recurrence keeps local time across DST, excludes dates and never repeats twice in one day',()=>{
 const start=Date.parse('2026-10-31T15:00:00Z'),r=rule({exclude:['2026-11-01']});let next=nextOccurrence(start,r,zone,start);assert.equal(new Date(next).toISOString(),'2026-11-02T16:00:00.000Z');assert.equal(calendarParts(next,zone).hour,9);
 assert.equal(nextOccurrence(start,rule({until:'2026-10-31'}),zone,start),null);
 assert.throws(()=>rule({interval:0}));assert.throws(()=>rule({frequency:'weekly',weekdays:[]}));assert.throws(()=>rule({exclude:['2026-02-30']}));
});
test('weekly choices and first or last Thursday monthly patterns respect exclusions',()=>{
 const start=Date.parse('2026-11-01T16:00:00Z'),weekly=rule({frequency:'weekly',weekdays:[2,4]});assert.equal(calendarParts(nextOccurrence(start,weekly,zone),zone).date,'2026-11-03');
 const monthly=rule({frequency:'monthly',mode:'weekday',ordinal:1,weekday:4,exclude:['2026-11-05']});assert.equal(calendarParts(nextOccurrence(start,monthly,zone),zone).date,'2026-12-03');
 assert.equal(calendarParts(nextOccurrence(start,rule({frequency:'monthly',mode:'weekday',ordinal:-1,weekday:4}),zone),zone).date,'2026-11-26');
 const lastDay=rule({frequency:'monthly',mode:'date',day:31});assert.equal(calendarParts(nextOccurrence(start,lastDay,zone),zone).date,'2026-12-31');
});
