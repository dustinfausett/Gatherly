const DAY=86400000;
export const weekDays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function calendarParts(time,zone){const p=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time)),v=k=>p.find(x=>x.type===k).value;return {date:`${v('year')}-${v('month')}-${v('day')}`,hour:Number(v('hour')),minute:Number(v('minute'))};}
export function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value;}
export function normalizeRecurrence(rule){
 if(rule==null)return null;if(typeof rule!=='object'||Array.isArray(rule)||!['daily','weekly','monthly','yearly'].includes(rule.frequency))throw new Error('Choose a daily, weekly, monthly or yearly recurrence.');
 const interval=rule.interval??1;if(!Number.isSafeInteger(interval)||interval<1||interval>52)throw new Error('Choose a recurrence interval between 1 and 52.');
 const result={frequency:rule.frequency,interval,until:rule.until||'',exclude:[...new Set(rule.exclude||[])].sort()};
 if(!Array.isArray(rule.exclude)||rule.exclude.length>500||result.exclude.some(d=>!validDate(d))||result.until&&!validDate(result.until))throw new Error('Choose valid exclusion and end dates.');
 if(rule.frequency==='weekly'){if(!Array.isArray(rule.weekdays)||!rule.weekdays.length||rule.weekdays.some(n=>!Number.isInteger(n)||n<0||n>6))throw new Error('Choose at least one day of the week.');result.weekdays=[...new Set(rule.weekdays)].sort();}
 if(rule.frequency==='monthly'){result.mode=rule.mode||'date';if(!['date','weekday'].includes(result.mode))throw new Error('Choose a monthly pattern.');if(result.mode==='date'){if(!Number.isInteger(rule.day)||rule.day<1||rule.day>31)throw new Error('Choose a day of the month.');result.day=rule.day;}else{if(![1,2,3,4,5,-1].includes(rule.ordinal)||!Number.isInteger(rule.weekday)||rule.weekday<0||rule.weekday>6)throw new Error('Choose a monthly weekday.');result.ordinal=rule.ordinal;result.weekday=rule.weekday;}}
 return result;
}
function wallTime(date,hour,minute,zone){let guess=Date.parse(date+'T00:00:00Z')+(hour*60+minute)*60000;const desired=guess;for(let i=0;i<5;i++){const p=calendarParts(guess,zone),wall=Date.parse(p.date+'T00:00:00Z')+(p.hour*60+p.minute)*60000,delta=desired-wall;if(!delta)return guess;guess+=delta;}return null;}
export function nextOccurrence(start,rule,zone,after=start-1){
 if(!rule)return start>after?start:null;const r=normalizeRecurrence(rule),first=calendarParts(start,zone),begin=Date.parse(first.date+'T00:00:00Z'),afterDay=Date.parse(calendarParts(Math.max(start,after),zone).date+'T00:00:00Z'),exclude=new Set(r.exclude);
 const a=new Date(begin),firstMonday=begin-((a.getUTCDay()+6)%7)*DAY;
 for(let day=Math.max(begin,afterDay),n=0;n<36600;n++,day+=DAY){
  const d=new Date(day),key=d.toISOString().slice(0,10);if(r.until&&key>r.until)return null;if(exclude.has(key))continue;
  const months=(d.getUTCFullYear()-a.getUTCFullYear())*12+d.getUTCMonth()-a.getUTCMonth(),weekday=d.getUTCDay();let match=false;
  if(r.frequency==='daily')match=Math.round((day-begin)/DAY)%r.interval===0;
  if(r.frequency==='weekly')match=Math.floor((day-firstMonday)/DAY/7)%r.interval===0&&r.weekdays.includes(weekday);
  if(r.frequency==='monthly'&&months%r.interval===0)match=r.mode==='date'?d.getUTCDate()===r.day:weekday===r.weekday&&(r.ordinal===-1?new Date(day+7*DAY).getUTCMonth()!==d.getUTCMonth():Math.floor((d.getUTCDate()-1)/7)+1===r.ordinal);
  if(r.frequency==='yearly')match=(d.getUTCFullYear()-a.getUTCFullYear())%r.interval===0&&d.getUTCMonth()===a.getUTCMonth()&&d.getUTCDate()===a.getUTCDate();
  if(match){const wall=wallTime(key,first.hour,first.minute,zone),at=wall===null?null:wall+(start%60000);if(at!==null&&at>=start&&at>after)return at;}
 }return null;
}
export function recurrenceLabel(rule){if(!rule)return '';let r;try{r=normalizeRecurrence(rule);}catch{return 'Choose a repeat pattern';}const every=r.interval===1?'Every':`Every ${r.interval}`;return r.frequency==='weekly'?`${every} week on ${r.weekdays.map(d=>weekDays[d]).join(', ')}`:r.frequency==='monthly'?`${every} month on ${r.mode==='date'?`day ${r.day}`:`the ${{1:'first',2:'second',3:'third',4:'fourth',5:'fifth',[-1]:'last'}[r.ordinal]} ${weekDays[r.weekday]}`}`:`${every} ${r.frequency==='daily'?'day':'year'}`;}
