import React,{createContext,useContext,useEffect,useState} from 'react';
import { KeyRound,ShieldCheck,Download,Copy,Smartphone,LogOut,LockKeyhole } from 'lucide-react';
import { Logo,Field,Form } from '../components';
import * as client from './client';

const EncryptionContext=createContext({enabled:false});
export const useEncryption=()=>useContext(EncryptionContext);
function RecoveryCard({code,confirmed,onConfirmed,busy}){
  const [saved,setSaved]=useState(false),[copied,setCopied]=useState(false);
  return <div className="recovery-card"><h2>Keep your recovery key safe</h2><p>This key restores your encrypted messages if you lose your devices. Churp cannot replace it. Keep it somewhere private, outside this browser.</p>
    <textarea aria-label="Your recovery key" readOnly value={code} onFocus={e=>e.target.select()}/>
    <div className="button-row"><button className="button secondary" onClick={async()=>{try{await navigator.clipboard.writeText(code);setCopied(true);}catch{}}}><Copy size={16}/>{copied ? 'Copied' : 'Copy key'}</button><button className="button secondary" onClick={()=>{
      const url=URL.createObjectURL(new Blob([`Churp encrypted messaging recovery key\n\n${code}\n\nKeep this private. You also need to sign in to the matching Churp account.\n`],{type:'text/plain'}));
      const a=document.createElement('a');a.href=url;a.download='churp-recovery-key.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }}><Download size={16}/>Download key</button></div>
    <label className="recovery-saved"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/>I saved my recovery key somewhere safe.</label>
    <button className="button primary" disabled={!saved || busy} onClick={onConfirmed}>{confirmed ? 'Replace recovery key' : 'Continue to Churp'}</button>
  </div>;
}
export default function EncryptionGate({user,required,onLogout,children}){
  const [phase,setPhase]=useState('loading'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [account,setAccount]=useState(null),[pending,setPending]=useState(null),[code,setCode]=useState(''),[grant,setGrant]=useState(null);
  const [deviceName,setDeviceName]=useState(client.browserName());
  useEffect(()=>{
    if(!required)return;let active=true;client.clearMemory();
    client.inspect(user.id).then(r=>{if(!active)return;setAccount(r.account);setPending(r.pending);setPhase(r.local && r.account.identity && r.local.recoveryConfirmed ? 'ready' : r.local && r.account.identity ? 'setup' : r.account.identity ? 'locked' : 'setup');}).catch(e=>{if(active){setError(e.message);setPhase('error');}});
    return()=>{active=false;client.clearMemory();};
  },[user.id,required]);
  useEffect(()=>{
    if(!pending || phase!=='locked')return;let active=true;
    if(account?.identity)client.transferCode(user.id,pending,account).then(value=>{if(active)setCode(value);}).catch(e=>{if(active)setError(e.message);});
    const poll=()=>client.pollTransfer(pending).then(r=>{if(active && r.ciphertext)setGrant(r.ciphertext);}).catch(e=>{if(active)setError(e.message);});poll();
    const timer=setInterval(poll,2000);return()=>{active=false;clearInterval(timer);};
  },[pending?.transferId,phase,account?.identity?.fingerprint]);
  async function action(fn){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  if(!required)return <EncryptionContext.Provider value={{enabled:false}}>{children}</EncryptionContext.Provider>;
  if(phase==='ready')return <EncryptionContext.Provider value={{enabled:true}}>{children}</EncryptionContext.Provider>;
  return <main className="encryption-gate"><div className="encryption-panel"><Logo/><span className="encryption-kicker"><LockKeyhole size={15}/>Private conversations, on your devices</span>
    {phase==='loading' ? <p role="status">Unlocking encrypted messaging…</p> : phase==='setup' ? <>
      {!code ? <><h1>Protect your conversations</h1><p>Messages, replies and attachments are encrypted before they leave your device. A new Nest member receives messages sent after joining.</p>
        <Form submit="Set up encrypted messaging" onSubmit={async()=>{setCode(await client.setup(user.id,deviceName));}}>
          <Field label="Device name"><input value={deviceName} onChange={e=>setDeviceName(e.target.value)} required maxLength={80}/></Field>
          <p className="muted small-text">You’ll get a personal recovery key. Your login password or Google account alone cannot restore encrypted messages.</p>
        </Form></> : <RecoveryCard code={code} busy={busy} onConfirmed={()=>action(async()=>{await client.finishSetup(user.id);setCode('');setPhase('ready');})}/>}
    </> : phase==='locked' ? <><h1>Unlock this device</h1><p>Sign-in is complete. Restore your encryption identity with your recovery key, or approve this browser from a device you already use.</p>
      <Form submit="Restore with recovery key" onSubmit={async form=>{await client.recover(user.id,form.get('recovery'),deviceName);setPhase('ready');}}>
        <Field label="Device name"><input value={deviceName} onChange={e=>setDeviceName(e.target.value)} required maxLength={80}/></Field>
        <Field label="Recovery key"><input name="recovery" placeholder="CHURP1-…" autoComplete="off" autoCapitalize="none" spellCheck={false} required/></Field>
      </Form>
      <div className="encryption-transfer"><h2><Smartphone size={19}/>Use another approved device</h2>
        {!pending ? <button className="button secondary" disabled={busy} onClick={()=>action(async()=>{setPending(await client.startTransfer(user.id,deviceName));})}>Request device approval</button> : <>
          <p>On your approved device, open <strong>your profile → Encrypted messaging → Approve a device</strong> and enter this request code:</p>
          <textarea aria-label="Device request code" readOnly value={code} onFocus={e=>e.target.select()}/>
          {grant ? <Form submit="Finish device approval" onSubmit={async form=>{await client.finishTransfer(user.id,pending,grant,form.get('finish'));setPhase('ready');}}>
            <Field label="Finish code from approved device"><input name="finish" autoComplete="off" autoCapitalize="none" required/></Field>
          </Form> : <p className="muted small-text" role="status">Waiting for approval. This request expires after 10 minutes.</p>}
          <button className="text-button" disabled={busy} onClick={()=>action(async()=>{setGrant(null);setCode('');setPending(await client.startTransfer(user.id,deviceName));})}>Start a new device request</button>
        </>}
      </div><p className="small-text muted">Without an approved device or the recovery key, earlier encrypted messages cannot be recovered. Never send your recovery key to support or another person.</p>
    </> : <><h1>Encryption could not be unlocked</h1><p>Keep this device’s data intact and try again. If an identity changed unexpectedly, verify it before sharing messages.</p><button className="button secondary" onClick={()=>location.reload()}>Try again</button></>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    <button className="text-button danger" onClick={onLogout}><LogOut size={15}/>Sign out</button>
  </div></main>;
}
export function EncryptionSettings(){
  const {enabled}=useEncryption();const [finish,setFinish]=useState(null),[recovery,setRecovery]=useState(null),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function recoveryAction(fn){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  if(!enabled)return null;const self=client.getCurrent();
  return <div className="settings-section encryption-settings"><h4><ShieldCheck size={17}/>Encrypted messaging</h4>
    <p className="muted small-text">Messages and attachments are encrypted on members’ devices. Churp stores encrypted content without the keys to read it. Members added later do not receive earlier messages.</p>
    <details><summary>Your identity security code</summary><code className="identity-code">{client.formatCode(self.fingerprint)}</code><p className="small-text muted">Compare this code with another person using a separate trusted channel. A valid signature confirms a key; comparing codes confirms who owns it.</p></details>
    <h5>Approve a device</h5><Form submit="Approve device" onSubmit={async form=>{setFinish(await client.approveTransfer(form.get('request')));}}>
      <Field label="Request code from new device"><input name="request" autoComplete="off" autoCapitalize="none" required/></Field>
    </Form>
    {finish && <div className="info-banner"><strong>Finish approval on {finish.name}</strong><p>Enter this finish code on the new device. It is never sent to the server in readable form.</p><textarea aria-label="Device approval finish code" readOnly value={finish.code} onFocus={e=>e.target.select()}/></div>}
    <details><summary>Replace your recovery key</summary><p className="small-text muted">This replaces the key used to restore your account. Save the new key before confirming.</p>
      {!recovery ? <button className="button secondary small" disabled={busy} onClick={()=>recoveryAction(async()=>{setRecovery(await client.stageRecovery());})}>Generate replacement key</button> : <>
        <textarea aria-label="Replacement recovery key" value={recovery.code} readOnly/>
        <label className="recovery-saved"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/>I saved the replacement key.</label>
        <button className="button secondary small" disabled={!saved || busy} onClick={()=>recoveryAction(async()=>{await client.replaceRecovery(recovery);setRecovery(null);setSaved(false);})}>Replace recovery key</button>
      </>}
    </details>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <p className="small-text muted">This version uses long-term account keys, without forward secrecy. Membership, timestamps and urgency remain visible to the service. Earlier server-stored history is converted separately.</p>
  </div>;
}
