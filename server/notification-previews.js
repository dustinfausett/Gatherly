import * as enc from '../shared/encryption.js';
export async function validateNotificationPreviews(packets,readers,senderId){
 if(packets===undefined)return;
 if(!Array.isArray(packets)||packets.length>readers.length||packets.length>1000||new Set(packets.map(p=>p?.userId)).size!==packets.length)throw new Error('Invalid encrypted notification previews.');
 const keys=new Map(readers.map(r=>[r.id,r.public_key]));
 await Promise.all(packets.map(async packet=>{if(!packet||Object.keys(packet).some(key=>!['userId','ciphertext'].includes(key))||packet.userId===senderId||!keys.has(packet.userId)||typeof packet.ciphertext!=='string'||packet.ciphertext.length>2400)throw new Error('Invalid encrypted notification preview audience or size.');await enc.validateCiphertext(packet.ciphertext,[keys.get(packet.userId)]);}));
}
