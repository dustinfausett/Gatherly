import { api } from './api';
import { decryptMessages } from './encryption/client';
import { parseAssignments, parseAssignmentOperation, projectAssignments, validateAssignmentSettings } from '../shared/assignments';
export async function readAssignmentList(groupId,id,enabled,full=true) {
  const result=await api(`/messages/${id}/assignments`);
  const decode=messages=>enabled ? decryptMessages(groupId,messages) : Promise.resolve(messages);
  const [root]=await decode([result.message]), initial=!root.decryptionError && parseAssignments(root.body);
  if(!initial)throw new Error('This assignment list could not be decrypted or verified.');
  if(!full){
    let settings=validateAssignmentSettings(initial);
    if(result.settings_message.id!==root.id){const [m]=await decode([result.settings_message]);const op=!m.decryptionError && parseAssignmentOperation(m.body,id,JSON.parse(result.settings_metadata));if(!op || op.action!=='settings')throw new Error('List settings could not be verified.');settings=validateAssignmentSettings(op);}
    return {...result,...settings,items:result.items.filter(i=>!i.deleted),root};
  }
  const operations=[];let after=0;
  while(after<result.revision){
    const page=await api(`/messages/${id}/assignments/operations?after=${after}&version=${result.revision}`);
    if(!page.operations.length)throw new Error('Some assignment updates are missing. Reopen the list to try again.');
    const decoded=await decode(page.operations.map(o=>o.message));
    for(let i=0;i<decoded.length;i++){
      const row=page.operations[i],m=decoded[i],op=!m.decryptionError && parseAssignmentOperation(m.body,id,row.metadata);
      if(!op || row.revision!==after+1 || op.expectedVersion!==after)throw new Error('An assignment update could not be verified.');
      operations.push(op);after=row.revision;
    }
  }
  const projected=projectAssignments(initial,operations);
  if(projected.allowMemberAdds!==result.allow_member_adds || projected.items.length!==result.items.length || projected.items.some(item=>{const stored=result.items.find(i=>i.id===item.id);return !stored || stored.assignee_id!==item.assigneeId || !!stored.completed!==item.completed || !!stored.deleted!==item.deleted;}))throw new Error('The assignment list state could not be verified. Reopen it to try again.');
  return {...result,...projected,items:projected.items.filter(i=>!i.deleted),root};
}
