import React, { useEffect, useRef, useState } from 'react';
import { api, post } from './api';
import { Field, Form } from './components';

let googleScript;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!googleScript) googleScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => failed(), 15000);
    function failed() { clearTimeout(timer); script.remove(); googleScript = null; reject(new Error('Google Sign-in could not load. Check your connection and try again.')); }
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.dataset.googleAuth = 'true';
    script.onload = () => { clearTimeout(timer); window.google?.accounts?.id ? resolve(window.google.accounts.id) : failed(); };
    script.onerror = failed;
    document.head.appendChild(script);
  });
  return googleScript;
}

export default function GoogleSignIn({ clientId, createAccount = false, challenge, onCredential, onFailure, connecting = false }) {
  const host = useRef(null), callbacks = useRef({ onCredential, onFailure });
  callbacks.current = { onCredential, onFailure };
  const [error, setError] = useState(''), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false, submitting = false;
    setReady(false); setBusy(false); setError('');
    async function initialize() {
      try {
        const id = await loadGoogle();
        if (cancelled) return;
        const proof = challenge || await post('/auth/google/challenge', { createAccount });
        if (cancelled) return;
        id.initialize({ client_id: clientId, nonce: proof.nonce, ux_mode: 'popup', auto_select: false, context: createAccount ? 'signup' : 'signin', callback: async response => {
          if (cancelled || submitting) return;
          submitting = true; setBusy(true); setError('');
          try { await callbacks.current.onCredential(response.credential); }
          catch (e) {
            if (!cancelled) { setError(e.message); setReady(false); callbacks.current.onFailure?.(e); }
          } finally { if (!cancelled) setBusy(false); }
        } });
        host.current.replaceChildren();
        id.renderButton(host.current, { theme: 'outline', size: 'large', shape: 'pill', width: Math.max(200, Math.min(340, Math.floor(host.current.clientWidth))), text: connecting ? 'signin_with' : 'continue_with' });
        setReady(true);
      } catch (e) { if (!cancelled) { setError(e.message); callbacks.current.onFailure?.(e); } }
    }
    initialize();
    return () => { cancelled = true; };
  }, [clientId, createAccount, challenge, connecting, attempt]);
  return <div className="google-sign-in">
    <div ref={host} className="google-button" hidden={!!error} inert={busy ? true : undefined} aria-busy={busy}/>
    {!ready && !error && <p className="small-text muted" role="status">Loading Google Sign-in…</p>}
    {busy && <p className="small-text muted" role="status">{connecting ? 'Connecting Google…' : 'Signing in…'}</p>}
    {error && <><p className="error-banner" role="alert">{error}</p>{!onFailure && <button type="button" className="text-button" onClick={() => setAttempt(value => value + 1)}>Try Google again</button>}</>}
  </div>;
}

export function GoogleAccountSettings({ user, config, onAccountUpdate }) {
  const [proof, setProof] = useState(null), [password, setPassword] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState('');
  return <section className="settings-section google-account" aria-label="Google sign-in settings"><h4>Google sign-in</h4>
    {user.has_google ? <>
      <p className="account-email-status"><strong>{user.google_email || 'Google account connected'}</strong> · Connected</p>
      <p className="small-text muted">Use Google to sign in to this same Churp account.{user.has_password ? ' Your Churp username and password still work.' : ' Manage your sign-in and recovery through Google.'}</p>
      {user.has_password && <details><summary>Disconnect Google</summary><FormForGoogle submit="Disconnect Google" onSubmit={async form => {
        const result = await api('/me/google', { method: 'DELETE', body: { currentPassword: form.get('currentPassword') } });
        onAccountUpdate(result.user); setNotice('Google disconnected. Use your Churp username and password to sign in.');
      }}/></details>}
    </> : !config.googleClientId ? <p className="small-text muted">Google sign-in is awaiting setup. Your Churp username and password work as usual.</p> : <>
      <p className="small-text muted">Connect Google to sign in to this account. Your messages, Trees, contacts and message keys stay with you. Your Churp password will still work.</p>
      {!proof ? <FormForGoogle submit="Connect Google" onSubmit={async form => {
        setError(''); setNotice('');
        const challenge = await post('/me/google/challenge', { currentPassword: form.get('currentPassword') });
        setPassword(''); setProof(challenge);
      }} value={password} onChange={event => setPassword(event.target.value)}/> : <>
        <p className="small-text">Choose the Google account you want to connect.</p>
        <GoogleSignIn clientId={config.googleClientId} challenge={proof} connecting onCredential={async credential => {
          const result = await post('/me/google', { credential });
          onAccountUpdate(result.user); setProof(null); setNotice('Google connected. You can now sign in with Google or your Churp username and password.');
        }} onFailure={e => { setProof(null); setError(e.message); }}/>
        <button type="button" className="text-button" onClick={() => setProof(null)}>Cancel connection</button>
      </>}
    </>}
    {notice && <p className="info-banner" role="status">{notice}</p>}{error && <p className="error-banner" role="alert">{error}</p>}
  </section>;
}

function FormForGoogle({ submit, onSubmit, value, onChange }) {
  return <Form submit={submit} onSubmit={onSubmit}><Field label="Current Churp password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} {...(onChange ? { value, onChange } : {})}/></Form>;
}
