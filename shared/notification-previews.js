import {cleanMessageBody,birdWords} from './bird-words.js';
import * as enc from './encryption.js';
export function previewText(body,attachments=[],kind='chat'){
 let text=typeof body==='string'?cleanMessageBody(body,kind):'';
 if(['poll','rsvp','assignments'].includes(kind)){try{text=`${{poll:'Poll',rsvp:'RSVP',assignments:'Assignments'}[kind]}: ${JSON.parse(text).title||''}`;}catch{text='New shared item';}}
 text=text.replace(/\s+/gu,' ').trim();
 if(!text&&attachments.length)text=attachments.every(f=>f.mime?.startsWith('image/'))?'Photo':'Attachment';
 const chars=Array.from(text);return chars.slice(0,120).join('')+(chars.length>120?'…':'');
}
export async function sealNotificationPreviews(privateKey,readers,{senderId,clientId,channel,body,attachments=[],kind='chat'}){
 // Keep large conversations within the existing message request size budget.
 if(readers.length>500||!['chat','poll','rsvp','assignments'].includes(kind))return undefined;
 const text=previewText(body,attachments,kind);
 return Promise.all(readers.filter(r=>r.id!==senderId).map(async reader=>({userId:reader.id,ciphertext:await enc.seal(privateKey,[reader.public_key],{version:1,kind:'notification-preview',senderId,recipientId:reader.id,clientId,channel,text})})));
}
export const previewProof=async packets=>packets===undefined?{}:{notificationPreviewHash:await enc.digest(enc.canonical(packets))};
