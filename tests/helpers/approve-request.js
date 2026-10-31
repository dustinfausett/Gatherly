import * as enc from '../../shared/encryption.js';
export async function approveRequest(ok,parent,child,peer){
 const request=await ok(`/family/requests/${child.id}/${peer.id}`,parent),delivery_copies=[];
 for(const m of request.messages)for(const recipient of request.recipients){const ciphertext=await enc.rewrap([parent.privateKey],recipient.public_key,m.ciphertext);delivery_copies.push({message_id:m.id,user_id:recipient.id,ciphertext,signature:await enc.sign(parent.privateKey,'private-intro-share',{messageId:m.id,recipientId:recipient.id,originalHash:await enc.digest(m.ciphertext),copyHash:await enc.digest(ciphertext)})});}
 return ok('/family/approvals',parent,'POST',{child_id:child.id,adult_id:peer.id,decision:'approved',delivery_copies});
}
