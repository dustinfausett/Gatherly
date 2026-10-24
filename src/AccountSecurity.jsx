import React,{useEffect,useRef,useState} from 'react';
import { Field,Form,Logo,Modal } from './components';
import { api,post } from './api';
import './account-security.css';

export function AccountSecuritySettings({user,config,onAccountUpdate}){
  const [notice,setNotice]=useState(''),[emailPassword,setEmailPassword]=useState(''),[removing,setRemoving]=useState(false),[error,setError]=useState('');
  const passwordSection=useRef(null);
  return <div className="settings-section account-security"><h4>Password and account recovery</h4>
    {user.has_password?<>
      <details><summary>Change password</summary><div ref={passwordSection}><Form submit="Change password" onSubmit={async form=>{
        if(form.get('password')!==form.get('confirmPassword'))throw new Error('Your new passwords do not match.');
        const r=await post('/me/password',{currentPassword:form.get('currentPassword'),password:form.get('password')});onAccountUpdate(r.user);passwordSection.current.querySelector('form').reset();setNotice('Password changed. Other signed-in sessions have been signed out.');
      }}><Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/><Field label="New password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128}/><Field label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128}/></Form></div></details>
      <h5>Recovery email</h5><p className="small-text muted">A verified email lets you reset a forgotten password. It does not replace a self-managed encryption recovery key.</p>
      {user.recovery_email_verified?<p className="account-email-status"><strong>{user.recovery_email}</strong> · Verified</p>:<p className="small-text">No verified recovery email yet.</p>}
      {user.pending_recovery_email && <p className="small-text account-email-status">Awaiting verification: {user.pending_recovery_email}</p>}
      {!config.recoveryEmailEnabled && <p className="info-banner">Email recovery is not available yet. You can still change your password above.</p>}
      {config.recoveryEmailEnabled && <Form key={`${user.recovery_email}:${user.pending_recovery_email}`} submit={user.pending_recovery_email?'Send verification email':'Verify recovery email'} onSubmit={async form=>{
        const r=await post('/me/recovery-email',{email:form.get('email'),currentPassword:emailPassword});onAccountUpdate(r.user);setEmailPassword('');setNotice(r.message);setError('');
      }}><Field label="Recovery email" name="email" type="email" autoComplete="email" defaultValue={user.pending_recovery_email || user.recovery_email || ''} required maxLength={254} disabled={!config.recoveryEmailEnabled}/><Field label="Current password for email changes" name="currentPassword" type="password" autoComplete="current-password" value={emailPassword} onChange={e=>setEmailPassword(e.target.value)} required maxLength={128}/>{!config.recoveryEmailEnabled && <p className="small-text muted">Email verification can be sent when recovery becomes available.</p>}</Form>}
      {!config.recoveryEmailEnabled && (user.recovery_email || user.pending_recovery_email) && <Field label="Current password for email changes" type="password" autoComplete="current-password" value={emailPassword} onChange={e=>setEmailPassword(e.target.value)} maxLength={128}/>}
      {(user.recovery_email || user.pending_recovery_email) && <button type="button" className="text-button danger" disabled={removing || !emailPassword} onClick={async()=>{setRemoving(true);setError('');try{const r=await api('/me/recovery-email',{method:'DELETE',body:{currentPassword:emailPassword}});onAccountUpdate(r.user);setEmailPassword('');setNotice('Recovery email removed. Email password resets are unavailable until you verify an address again.');}catch(e){setError(e.message);}finally{setRemoving(false);}}}>Remove recovery email</button>}
    </>:<p className="small-text muted">You use Google Sign-in. Change or recover your Google password through <a href="https://accounts.google.com/signin/recovery" target="_blank" rel="noreferrer">Google account recovery</a>.</p>}
    {notice && <p className="info-banner" role="status">{notice}</p>}{error && <p className="error-banner" role="alert">{error}</p>}
  </div>;
}
export function ForgotPasswordDialog({config,onClose}){
  const [sent,setSent]=useState(false);
  return <Modal title="Reset your password" onClose={onClose}>
    <p className="muted modal-subtitle">We’ll send a one-use link to your verified recovery email.</p>
    {!config.recoveryEmailEnabled?<p className="info-banner">Email recovery is not available yet. If you are signed in on another device, change your password in your profile. For Google Sign-in, use Google account recovery.</p>:sent?<p className="info-banner" role="status">If this account has a verified recovery email, a reset link will arrive shortly. Check your spam folder too. Google accounts should use Google account recovery.</p>:<Form submit="Send reset link" onSubmit={async form=>{await post('/auth/forgot-password',{account:form.get('account')});setSent(true);}}><Field label="Username or recovery email" name="account" autoComplete="username" required maxLength={254}/><p className="small-text muted">You must have verified a recovery email in your profile. Resetting your password does not recover self-managed encryption keys.</p></Form>}
  </Modal>;
}
export function AccountLink({action,onDone}){
  const [done,setDone]=useState(false);
  useEffect(()=>{const url=new URL(location.href);url.searchParams.delete('reset_password');url.searchParams.delete('verify_email');history.replaceState({},'',url);},[]);
  const verify=action.kind==='verify';
  return <main className="account-link-page"><section className="account-link-panel"><Logo/><h1>{verify?'Verify your recovery email':'Choose a new password'}</h1>
    {done?<><p role="status" className="info-banner">{verify?'Your recovery email is verified. You can now request password-reset links.':'Your password has been reset. Sign in with the new password.'}</p><button className="button primary" onClick={()=>onDone(!verify)}>{verify?'Continue to Churp':'Back to sign in'}</button></>:<>
      <p className="muted">{verify?'Confirm that this email belongs to you.':'This changes your Churp sign-in password. Your encryption keys are kept separate.'}</p>
      <Form submit={verify?'Verify email':'Reset password'} onSubmit={async form=>{
        if(!verify && form.get('password')!==form.get('confirmPassword'))throw new Error('Your new passwords do not match.');
        await post(verify?'/auth/verify-email':'/auth/reset-password',{token:action.token,...(!verify?{password:form.get('password')}:{})});setDone(true);
      }}>{!verify && <><Field label="New password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128}/><Field label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128}/></>}</Form>
      <button className="text-button" onClick={()=>onDone(false)}>Back to Churp</button>
    </>}
  </section></main>;
}
