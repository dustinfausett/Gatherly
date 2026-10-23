import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The master is separate from SQLite. Production can supply it from a secret
// manager; the persistent-volume fallback keeps zero-configuration installs usable.
export function keyVault(dataDir,hasKeys,configured=process.env.CHURP_KEY_VAULT_SECRET){
  const file=join(dataDir,'key-vault.key');let secret=configured;
  if(!secret){
    if(existsSync(file))secret=readFileSync(file,'utf8').trim();
    else{
      if(hasKeys)throw new Error('Managed key vault is missing its master key. Restore key-vault.key or CHURP_KEY_VAULT_SECRET; do not replace it.');
      secret=randomBytes(32).toString('hex');
      try{writeFileSync(file,secret,{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;secret=readFileSync(file,'utf8').trim();}
    }
  }
  if(!/^[0-9a-f]{64}$/i.test(secret))throw new Error('The managed key vault master must be 64 hexadecimal characters.');
  const master=Buffer.from(secret,'hex');
  return {
    seal(userId,fingerprint,privateKey){
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',master,iv);
      cipher.setAAD(Buffer.from(`Churp managed key: ${userId}:${fingerprint}`));
      const encrypted=Buffer.concat([cipher.update(privateKey,'utf8'),cipher.final()]);
      return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
    },
    open(userId,fingerprint,value){
      const encrypted=Buffer.from(value,'base64');
      if(encrypted.length<29)throw new Error('The managed key vault entry is invalid.');
      const decipher=createDecipheriv('aes-256-gcm',master,encrypted.subarray(0,12));
      decipher.setAAD(Buffer.from(`Churp managed key: ${userId}:${fingerprint}`));decipher.setAuthTag(encrypted.subarray(12,28));
      return Buffer.concat([decipher.update(encrypted.subarray(28)),decipher.final()]).toString('utf8');
    },
  };
}
