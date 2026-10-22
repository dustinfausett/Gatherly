import React, { useEffect, useState } from 'react';
import { Check, Clock, GitBranch, X } from 'lucide-react';
import { api, post } from './api';
import { Avatar, Modal } from './components';

export default function CreationRequests({ community, version, onClose, onRefresh, notify }) {
  const [requests,setRequests]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(null);
  const [revision,setRevision]=useState(0);
  useEffect(() => {
    let active=true;
    api(`/communities/${community.id}/creation-requests`).then(r => { if(active) {setRequests(r.requests);} }).catch(e => {if(active)setError(e.message);});
    return () => {active=false;};
  },[community.id,version,revision]);
  async function review(request,decision) {
    if(busy) return;
    setBusy(request.id); setError('');
    try {
      await post(`/creation-requests/${request.id}/review`,{decision});
      setRevision(n=>n+1); await onRefresh(); notify(decision === 'approve' ? `${request.kind === 'branch' ? 'Branch' : 'Nest'} approved and created.` : 'Request declined.');
    } catch(e) {setError(e.message);setRevision(n=>n+1);} finally {setBusy(null);}
  }
  return <Modal title="Creation requests" subtitle="Review new spaces and follow the requests you’ve submitted." onClose={onClose}>
    {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={()=>{setError('');setRevision(n=>n+1);}}>Retry</button></div>}
    {!requests ? <p className="muted" role="status">Loading requests…</p> : !requests.length ? <div className="requests-empty"><Clock size={27}/><p>No requests yet.</p><small>New Branch and Nest requests will appear here.</small></div> : <div className="creation-requests">{[...requests].sort((a,b)=>Number(b.status === 'pending')-Number(a.status === 'pending')).map(r=><article className="creation-request" key={r.id} data-request-id={r.id}>
      <div className="request-heading"><Avatar name={r.payload.name} id={r.payload.avatar_id} size={42}/><div><span className="request-kind">{r.kind === 'branch' ? <GitBranch size={12}/> : null}{r.kind === 'branch' ? 'Branch' : 'Nest'} · {r.parent_name || 'Tree level'}</span><h3>{r.payload.name}</h3></div><span className={`request-status ${r.status}`}>{r.status === 'rejected' ? 'Declined' : r.status}</span></div>
      <p className="request-author">Requested by {r.requester_name} · {new Date(r.created_at).toLocaleDateString()}</p>
      {r.payload.description && <p>{r.payload.description}</p>}
      {r.kind === 'nest' && <p className="small-text muted">{r.payload.private ? 'Private · invitation only' : 'Public'} · {r.payload.admin_only ? 'Only admins can post' : 'Members can post'}</p>}
      {r.status === 'pending' && r.can_review ? <><p className="small-text muted">Approval gives the creator admin rights over this {r.kind}.</p><div className="button-row"><button className="button secondary small" disabled={!!busy} onClick={()=>review(r,'reject')}><X size={15}/>Decline</button><button className="button primary small" disabled={!!busy} onClick={()=>review(r,'approve')}><Check size={15}/>{busy === r.id ? 'Saving…' : 'Approve'}</button></div></> : r.status === 'pending' ? <p className="small-text muted">Awaiting admin approval</p> : r.status === 'approved' ? <p className="small-text muted">Created. You can find it on Tree home.</p> : null}
    </article>)}</div>}
  </Modal>;
}
