import React,{useState} from 'react';
import { LockKeyhole } from 'lucide-react';
import { api } from '../api';
import { formatCode,trustedReader,confirmContact } from './client';
export default function NestEncryptionDetails({groupId}){
  const [readers,setReaders]=useState(null),[error,setError]=useState(''),[open,setOpen]=useState(false);
  async function load(){setError('');try{const rs=await api(`/groups/${groupId}/e2ee/roster`);setReaders(await Promise.all(rs.readers.map(r=>r.public_key ? trustedReader(r) : {...r,missing:true})));}catch(e){setError(e.message);}}
  return <div className="nest-encryption-details"><button onClick={()=>{setOpen(!open);if(!open)load();}}><LockKeyhole size={17}/>Encryption and security codes</button>
    {open && <><p className="small-text muted">Compare codes with each person through another trusted channel. Codes first seen on this device are not independently verified. A changed identity blocks message encryption and verification.</p>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <p className="small-text muted">The Nest shield appears only when every joined member below uses self-managed keys. It covers new messages. Earlier messages keep their original protection.</p>
      {!readers ? <p>Loading security codes…</p> : readers.map(r=><div className="security-reader" key={r.id}><strong>{r.name}</strong><small>{r.custody==='self' ? 'Self-managed keys' : 'Churp-managed keys'}</small>{r.missing ? <p>Encryption setup pending</p> : <><code className="identity-code">{formatCode(r.fingerprint)}</code>{r.verified ? <small>Code confirmed on this device</small> : <button onClick={async()=>{try{await confirmContact(r);await load();}catch(e){setError(e.message);}}}>I compared this code and it matches</button>}</>}</div>)}
    </>}
  </div>;
}
