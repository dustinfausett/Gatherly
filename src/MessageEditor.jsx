import React, { useEffect, useRef, useState } from 'react';
import { Modal,Field } from './components';
import { api } from './api';
import { useEncryption } from './encryption/EncryptionGate';
import { sealEdit } from './encryption/client';

export default function MessageEditor({ message,onClose,onSaved }) {
  const {enabled}=useEncryption();
  const [body,setBody]=useState(message.body),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const editor=useRef(null),prepared=useRef(null);
  useEffect(()=>{editor.current?.focus();},[]);
  const canSave=body!==message.body && (body.trim() || message.files.length);
  async function save(event){
    event?.preventDefault();if(busy || !canSave)return;
    setBusy(true);setError('');
    try{
      if(prepared.current?.body!==body)prepared.current={body,request:enabled ? await sealEdit(message,body) : {body,expectedVersion:message.edit_version || 0}};
      await api(`/messages/${message.id}/content`,{method:'PUT',body:prepared.current.request});
      await onSaved();onClose();
    }catch(e){if(e.status===409)prepared.current=null;setError(e.message);}
    finally{setBusy(false);}
  }
  return <Modal title="Edit message" onClose={()=>{if(!busy)onClose();}}>
    <form className="form message-editor" onSubmit={save}>
      <fieldset disabled={busy}><Field label="Message text"><textarea ref={editor} value={body} onChange={event=>setBody(event.target.value)} rows={6} maxLength={10000} onKeyDown={event=>{if(event.key==='Enter' && (event.ctrlKey || event.metaKey)){event.preventDefault();save();}}}/></Field></fieldset>
      {!!message.files.length && <p className="small-text muted">Attachments stay with this message.</p>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="form-footer"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={busy || !canSave}>{busy ? 'Saving…' : 'Save changes'}</button></div>
    </form>
  </Modal>;
}
