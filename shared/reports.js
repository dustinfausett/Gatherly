export const reportReasons=[{id:'harassment',label:'Harassment or bullying'},{id:'inappropriate',label:'Inappropriate or sexual content'},{id:'youth_safety',label:'Concern about a young person’s safety'},{id:'threats',label:'Threats or violence'},{id:'spam',label:'Spam or scams'},{id:'other',label:'Something else'}];
export const reportStatuses=['open','in_review','resolved','dismissed'];
// Render the selected activity's user-facing text rather than its storage format.
export function reportMessageText(body,type='chat'){
 if(!['poll','rsvp','assignments'].includes(type))return body;
 try{const value=JSON.parse(body);if(value.churp!==type)return body;
  if(type==='poll')return [value.title,...value.questions.map(q=>`${q.text}\n${q.options.map(o=>'• '+o).join('\n')}`)].join('\n\n');
  if(type==='rsvp')return [value.title,value.description,value.start&&(value.end?`${value.start} – ${value.end}`:value.start),value.location].filter(Boolean).join('\n\n');
  return [value.title,value.description,...value.items.map(i=>[i.title,i.notes,i.dueDate&&`Due: ${i.dueDate}`].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n');
 }catch{return body;}
}
