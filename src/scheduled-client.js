import {api,post} from './api';
import * as enc from '../shared/encryption.js';
import {scheduleProof,scheduleTime} from '../shared/scheduling';
import {getCurrent,sealMessage,sealPrivate,signAssignmentRequest} from './encryption/client';
import {assignmentSetup,validateAssignments} from '../shared/assignments';
import {scheduledRecipientBody} from '../shared/personalization';
export const localDate=value=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;};
export const scheduleZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
export const scheduleLabel=(time,zone)=>new Date(time).toLocaleString([],{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:zone||undefined,timeZoneName:'short'});
const intent=entries=>entries.map(e=>({channel:e.channel,target_id:e.target_id,sourceNest:e.request.sourceNest??null,source_nest:e.request.source_nest??null,filter_nest:e.request.filter_nest??null,thread_ids:e.request.thread_ids??null,urgent:e.request.urgent??false,reply_to:e.request.reply_to??null,message_kind:e.request.message_kind??'chat',files:e.request.files??[]}));
const requests=new Map();
export const clearScheduleRequests=()=>requests.clear();
const changed=()=>window.dispatchEvent(new Event('churp-scheduled-changed'));
export async function cancelScheduled(row){const result=await post(`/scheduled/${row.id}/cancel`,{expected_version:row.version});changed();return result;}
export async function queueScheduled(entries,draft,when,existing=null){
 const self=getCurrent(),client_id=existing?.client_id||when.requestId||crypto.randomUUID(),send_at=scheduleTime(new Date(when.sendAt).getTime()),time_zone=scheduleZone();
 if(localDate(send_at)!==when.sendAt.slice(0,16))throw new Error('That local time does not exist because the clocks change. Choose another time.');
 const cacheId=`${self.userId}:${when.requestId||client_id}:${existing?.version??'new'}`,logical=await enc.digest(enc.canonical({draft,intent:intent(entries),send_at,time_zone}));
 let cached=requests.get(cacheId);
 if(cached&&cached.logical!==logical)throw new Error('A previous scheduling request may have been saved. Check Scheduled messages before creating another.');
 if(!cached){
  const value={kind:'churp-scheduled-draft',senderId:self.userId,clientId:client_id,sendAt:send_at,intent:intent(entries),draft};
  const draft_ciphertext=await enc.seal(self.privateKey,[self.publicKey],value),packet={client_id,send_at,time_zone,entries,draft_ciphertext};
  packet.signature=await enc.sign(self.privateKey,'scheduled-send',scheduleProof(packet));
  cached={logical,packet};requests.set(cacheId,cached);
 }
 try{const result=existing?await api(`/scheduled/${existing.id}`,{method:'PUT',body:{...cached.packet,expected_version:existing.version}}):await post('/scheduled',cached.packet);requests.delete(cacheId);changed();return result;}
 catch(e){
  if(existing&&e.status===409){const list=await api('/scheduled'),saved=list.sends.find(r=>r.id===existing.id&&r.draft_ciphertext===cached.packet.draft_ciphertext);if(saved){requests.delete(cacheId);changed();return saved;}}
  if(e.status&&e.status<500)requests.delete(cacheId);throw e;
 }
}
export async function readScheduled(row){
 const self=getCurrent(),keys=[self.privateKey,...self.previousPrivateKeys],signer=await enc.readPublic(row.signer_key);
 if(!keys.some(k=>k.getFingerprint()===signer.getFingerprint()))throw new Error('Restore your earlier key to open this scheduled draft.');
 for(const key of keys){try{const value=await enc.open(key,row.signer_key,row.draft_ciphertext);if(value.kind!=='churp-scheduled-draft'||value.senderId!==self.userId||value.clientId!==row.client_id||value.sendAt!==row.send_at||enc.canonical(value.intent)!==enc.canonical(intent(row.entries)))throw new Error('Scheduled details changed.');return value.draft;}catch{}}
 throw new Error('This scheduled draft could not be unlocked or verified.');
}
export async function publishNest(group,request,draft,when,existing=null){
 if(when.enabled)return queueScheduled([{channel:'nest',target_id:group.id,request}],{...draft,labels:[group.name]},when,existing);
 return post(`/groups/${group.id}/messages`,request);
}
export async function rebuildScheduled(row,draft,when){
 const entries=[];
 for(const entry of row.entries){
  if(entry.channel==='nest'){
   const kind=entry.request.message_kind||'chat';let request=await sealMessage(entry.target_id,draft.body,draft.attachments||[],entry.request.reply_to??null,null,kind);
   request={...request,message_kind:kind,urgent:entry.request.urgent||false};
   if(kind==='rsvp')request.response_deadline=JSON.parse(draft.body).responseDeadline;
   if(kind==='assignments'){const setup=assignmentSetup(validateAssignments(JSON.parse(draft.body)));request={...await signAssignmentRequest(request,null,setup,'assignment-setup'),assignment_setup:setup};}
   entries.push({...entry,request});
  }else if(entry.channel==='private')entries.push({...entry,request:await sealPrivate(entry.target_id,scheduledRecipientBody(draft,entry.target_id),draft.attachments||[],undefined,entry.request.sourceNest??null)});
  else{const invite=await post('/invitations',{community_id:entry.target_id});entries.push({...entry,request:{...entry.request,text:draft.body,client_id:crypto.randomUUID(),invitation_url:invite.short_url||invite.url}});}
 }
 return queueScheduled(entries,draft,when,row);
}
