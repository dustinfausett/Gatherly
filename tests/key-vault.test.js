import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,statSync,readFileSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { keyVault } from '../server/key-vault.js';

test('managed vault persists its master and authenticates account, fingerprint and ciphertext',()=>{
  const dir=mkdtempSync(join(tmpdir(),'churp-vault-'));
  try{
    const vault=keyVault(dir,false,''),value='fixture private material',encrypted=vault.seal('alice','fingerprint',value);
    assert.ok(!encrypted.includes(value));assert.equal(vault.open('alice','fingerprint',encrypted),value);
    assert.equal(statSync(join(dir,'key-vault.key')).mode & 0o777,0o600);
    const reopened=keyVault(dir,true,'');assert.equal(reopened.open('alice','fingerprint',encrypted),value);
    assert.throws(()=>reopened.open('bob','fingerprint',encrypted));assert.throws(()=>reopened.open('alice','other key',encrypted));
    const modified=Buffer.from(encrypted,'base64');modified[modified.length-1]^=1;assert.throws(()=>reopened.open('alice','fingerprint',modified.toString('base64')));
    const master=readFileSync(join(dir,'key-vault.key'),'utf8');
    assert.equal(keyVault(dir,true,master).open('alice','fingerprint',encrypted),value);
    assert.throws(()=>keyVault(dir,true,'incorrect format'));
    assert.throws(()=>keyVault(dir,true,'a'.repeat(64)).open('alice','fingerprint',encrypted));
    unlinkSync(join(dir,'key-vault.key'));assert.throws(()=>keyVault(dir,true,''),/missing its master/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
