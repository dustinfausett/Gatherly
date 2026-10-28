import * as pgp from 'openpgp';

export const VERSION = 1;
export const MESSAGE_LIMIT = 512 * 1024;
export const FILE_LIMIT = 15 * 1024 * 1024;
const config = { aeadProtect:true, preferredCompressionAlgorithm:pgp.enums.compression.uncompressed,
  allowUnauthenticatedMessages:false, allowUnauthenticatedStream:false, maxDecompressedMessageSize:1024*1024 };
export const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize(value[k])]));
  return value;
}
export const bytes = text => new TextEncoder().encode(text);
export const hex = data => Array.from(data,b=>b.toString(16).padStart(2,'0')).join('');
export const randomSecret = (size=32) => hex(crypto.getRandomValues(new Uint8Array(size)));
export async function digest(value) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value === 'string' ? bytes(value) : value))); }
export function toBase64(data) {
  let text=''; for(let i=0;i<data.length;i+=8192) text+=String.fromCharCode(...data.subarray(i,i+8192));
  return btoa(text);
}
export function fromBase64(text) {
  if(typeof text !== 'string' || text.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Invalid encrypted data.');
  const data=Uint8Array.from(atob(text),c=>c.charCodeAt(0));
  if(toBase64(data)!==text)throw new Error('Invalid encrypted data.');return data;
}
export async function readPublic(armoredKey) {
  if(typeof armoredKey !== 'string' || armoredKey.length>16000)throw new Error('Invalid identity key.');
  const key=await pgp.readKey({armoredKey});
  if(key.isPrivate())throw new Error('Only a public identity key may be shared.');
  await key.verifyPrimaryKey();
  if(key.getAlgorithmInfo().algorithm!=='ed25519' || (await key.getEncryptionKey()).getAlgorithmInfo().algorithm!=='x25519')throw new Error('Churp requires Ed25519 and X25519 identity keys.');
  return key;
}
export async function generateIdentity(userId) {
  const result=await pgp.generateKey({type:'curve25519',userIDs:[{name:`Churp account ${userId}`}],format:'armored',config});
  const privateKey=await pgp.readPrivateKey({armoredKey:result.privateKey});
  return {privateKey,publicKey:result.publicKey,fingerprint:privateKey.getFingerprint()};
}
export async function readPrivate(armoredKey) { return pgp.readPrivateKey({armoredKey}); }
export async function protectPrivate(privateKey,recoveryKey) {
  return (await pgp.encryptKey({privateKey,passphrase:recoveryKey,config})).armor();
}
export async function recoverPrivate(backup,recoveryKey) {
  return pgp.decryptKey({privateKey:await pgp.readPrivateKey({armoredKey:backup}),passphrase:recoveryKey,config});
}
export async function validateBackup(backup,fingerprint) {
  if(typeof backup !== 'string' || backup.length>20000)throw new Error('Invalid encrypted recovery backup.');
  const key=await pgp.readPrivateKey({armoredKey:backup});
  if(key.isDecrypted() || key.getFingerprint() !== fingerprint)throw new Error('The recovery backup must contain the encrypted matching private key.');
}
export async function sign(privateKey,operation,payload) {
  return pgp.sign({message:await pgp.createMessage({text:canonical(['Churp',VERSION,operation,payload])}),signingKeys:privateKey,detached:true,config});
}
export async function verify(publicKey,operation,payload,signature) {
  if(typeof signature !== 'string' || signature.length>8192)throw new Error('Invalid signature.');
  const result=await pgp.verify({message:await pgp.createMessage({text:canonical(['Churp',VERSION,operation,payload])}),
    signature:await pgp.readSignature({armoredSignature:signature}),verificationKeys:await readPublic(publicKey),config});
  if(result.signatures.length !== 1)throw new Error('The identity signature is missing.');
  await result.signatures[0].verified;
}
export async function seal(privateKey,publicKeys,payload) {
  const encrypted=await pgp.encrypt({message:await pgp.createMessage({text:canonical(payload)}),
    encryptionKeys:await Promise.all(publicKeys.map(readPublic)),signingKeys:privateKey,format:'binary',config});
  return toBase64(encrypted);
}
export async function open(privateKey,publicKey,ciphertext) {
  const message=await pgp.readMessage({binaryMessage:fromBase64(ciphertext),config});
  const result=await pgp.decrypt({message,decryptionKeys:privateKey,verificationKeys:await readPublic(publicKey),expectSigned:true,format:'utf8',config});
  if(result.signatures.length !== 1)throw new Error('The message signature is missing.');
  await result.signatures[0].verified;
  if(typeof result.data !== 'string' || result.data.length>200000)throw new Error('Invalid encrypted message.');
  return JSON.parse(result.data);
}
export async function validateCiphertext(ciphertext,publicKeys) {
  if(typeof ciphertext !== 'string' || ciphertext.length<100 || ciphertext.length>MESSAGE_LIMIT)throw new Error('Invalid encrypted message.');
  const message=await pgp.readMessage({binaryMessage:fromBase64(ciphertext),config});
  const tags=Array.from(message.packets,p=>p.constructor.tag);
  if(!tags.some(t=>[18,20].includes(t)) || tags.some(t=>![1,18,20].includes(t)))throw new Error('Authenticated encrypted message packets are required.');
  const expected=await Promise.all(publicKeys.map(async armor=>(await (await readPublic(armor)).getEncryptionKey()).getKeyID().toHex()));
  const actual=message.getEncryptionKeyIDs().map(k=>k.toHex());
  if(canonical(actual.sort()) !== canonical(expected.sort()))throw new Error('The message must be encrypted for the current readers only.');
}
export async function encryptFile(data) {
  if(data.length>FILE_LIMIT)throw new Error('Each file must be 15 MB or smaller.');
  const key=randomSecret();
  const encrypted=await pgp.encrypt({message:await pgp.createMessage({binary:data}),passwords:[key],format:'binary',config});
  return {encrypted,key,sha256:await digest(encrypted)};
}
export async function decryptFile(data,descriptor) {
  if(data.length>FILE_LIMIT+65536 || await digest(data) !== descriptor.sha256)throw new Error('The attachment could not be verified.');
  const result=await pgp.decrypt({message:await pgp.readMessage({binaryMessage:data,config}),passwords:[descriptor.key],format:'binary',
    config:{...config,maxDecompressedMessageSize:FILE_LIMIT}});
  if(result.data.length !== descriptor.size)throw new Error('The attachment size does not match.');
  return result.data;
}
export async function validateEncryptedFile(data) {
  const message=await pgp.readMessage({binaryMessage:data,config});
  const tags=Array.from(message.packets,p=>p.constructor.tag);
  if(!tags.includes(3) || !tags.some(t=>[18,20].includes(t)) || tags.some(t=>![3,18,20].includes(t)))throw new Error('Upload an authenticated encrypted attachment.');
}
export const enrollmentPayload = ({userId,publicKey,backupHash,deviceId,deviceName}) => ({userId,publicKey,backupHash,deviceId,deviceName});
export const sendPayload = ({groupId,clientId,rosterHash,cipherHash,files,replyTo,notificationPreviewHash}) => ({groupId,clientId,rosterHash,cipherHash,files,replyTo:replyTo ?? null,...(notificationPreviewHash===undefined?{}:{notificationPreviewHash})});
export const editPayload = ({messageId,expectedVersion,...message}) => ({messageId,expectedVersion,...sendPayload(message)});

// Share access to a signed historical message without changing its encrypted
// contents or disclosing an account private key (which would expose Nest chats).
export async function rewrap(privateKeys, publicKey, ciphertext) {
  let sessions;
  for (const key of privateKeys) {
    // OpenPGP may consume packet streams even when a key attempt fails.
    // Each archived identity must get a fresh message, as in open().
    try {const candidate=await pgp.readMessage({binaryMessage:fromBase64(ciphertext),config});sessions=await pgp.decryptSessionKeys({message:candidate,decryptionKeys:key,config});if(sessions.length)break;} catch { /* Try archived identity. */ }
  }
  const message=await pgp.readMessage({binaryMessage:fromBase64(ciphertext),config});
  if(!sessions?.length)throw new Error('An earlier message needs its original encryption key. Restore that key to continue.');
  const session = sessions[0];
  // SEIPDv2 stores its symmetric algorithm in the authenticated data packet.
  const encrypted = message.packets.find(p=>[18,20].includes(p.constructor.tag));
  const keyMessage = await pgp.encryptSessionKey({data:session.data,algorithm:session.algorithm || pgp.enums.read(pgp.enums.symmetric,encrypted.cipherAlgorithm),encryptionKeys:await readPublic(publicKey),format:'object',config});
  const packets = new pgp.PacketList();
  packets.push(...keyMessage.packets,...message.packets.filter(p=>[18,20].includes(p.constructor.tag)));
  return toBase64(await binaryBytes(new pgp.Message(packets).write()));
}
export async function encryptedContentsHash(ciphertext) {
  const message = await pgp.readMessage({binaryMessage:fromBase64(ciphertext),config});
  const packets = new pgp.PacketList();
  packets.push(...message.packets.filter(p=>[18,20].includes(p.constructor.tag)));
  if(packets.length!==1)throw new Error('One authenticated encrypted payload is required.');
  return digest(await binaryBytes(packets.write()));
}

async function binaryBytes(value) {
  const data=await value;
  if(data instanceof Uint8Array)return data;
  const reader=data.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MESSAGE_LIMIT)throw new Error('Encrypted payload is too large.');chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
