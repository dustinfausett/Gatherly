import React, { useState } from 'react';
import { ArrowRight, ShieldCheck, Users, Sprout, LockKeyhole } from 'lucide-react';
import { post } from './api';
import { Field, Form, Logo } from './components';
import { ForgotPasswordDialog } from './AccountSecurity';
import GoogleSignIn from './GoogleSignIn';

export default function Auth({ onLogin, config }) {
  const [signup, setSignup] = useState(()=>new URLSearchParams(location.search).get('signup')==='1');
  const [forgot,setForgot]=useState(false);
  return <div className="auth-page">
    <div className="auth-story">
      <Logo />
      <div className="story-content"><div className="eyebrow light"><span className="tiny-dot" /> GOOD COMPANY. ROOM TO GROW.</div><h1>A little place<br /><em>to belong.</em></h1><p>A Tree for your people.<br />A Nest for every conversation.</p>
        <div className="brand-nest-art" aria-hidden="true"><img src="/brand/churp-nest.webp" alt="" /><span>A little room to belong.</span></div>
        <div className="story-values"><span><ShieldCheck size={17} /> Private by design</span><span><Users size={17} /> Built around people</span></div>
      </div><div className="story-footer">Small nests. Meaningful connections.<span>EST. 2026</span></div>
    </div>
    <main className="auth-main"><span className="auth-corner">A space to call yours <Sprout size={16} /></span><div className="auth-form-wrap">
      <div className="auth-mobile-logo"><Logo /></div><span className="eyebrow">LET’S GET TOGETHER</span><h2>{signup ? 'Find your people.' : 'Welcome home.'}</h2><p className="muted">{signup ? 'Create an account. Start something good.' : 'Sign in and pick up where you left off.'}</p>
      {config.googleClientId ? <GoogleSignIn key={signup?'signup':'login'} clientId={config.googleClientId} createAccount={signup} onCredential={async credential=>onLogin((await post('/auth/google',{credential})).user)}/> : <div className="google-unavailable"><span className="google-g">G</span><span>Google Sign-in <small>Awaiting setup</small></span><LockKeyhole size={15} /></div>}
      {config.googleClientId && signup && <p className="small-text muted google-existing-account">Already use Churp? Sign in with your username first, then connect Google in Account settings.</p>}
      <div className="divider"><span>or continue with your username</span></div>
      <Form key={signup ? 'signup' : 'login'} submit={signup ? 'Create your account' : 'Sign in'} onSubmit={async form => {
        const result = await post(`/auth/${signup ? 'register' : 'login'}`, Object.fromEntries(form)); onLogin(result.user,result.emailNotice);
      }}>
        {signup && <Field label="Date of birth" name="birth_date" type="date" autoComplete="bday" max={new Date().toISOString().slice(0,10)} hint="Private. Under 18? A linked parent is required before you can continue." required/>}
        {signup && <Field label="Your name" name="name" placeholder="What should we call you?" autoComplete="name" required maxLength={80} />}
        <Field label="Username" name="username" placeholder="e.g. alex_morgan" autoComplete="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]+" />
        {signup && config.recoveryEmailEnabled && <Field label="Recovery email (recommended)" name="email" type="email" autoComplete="email" maxLength={254} hint="Verify this address to reset a forgotten password."/>}
        <Field label="Password" name="password" type="password" placeholder={signup ? 'At least 8 characters' : 'Enter your password'} autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 8 : undefined} maxLength={128} />
        {!signup && <p className="auth-session-note"><ShieldCheck size={14} /> You’ll stay signed in on this device.</p>}
      </Form>
      {!signup && <button type="button" className="text-button auth-forgot-password" onClick={()=>setForgot(true)}>Forgot password?</button>}
      <p className="auth-switch">{signup ? 'Already part of the nest?' : 'New around here?'} <button onClick={() => setSignup(!signup)}>{signup ? 'Sign in' : 'Create an account'} <ArrowRight size={14} /></button></p>
      <nav className="auth-policy-links" aria-label="Churp policies"><a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a><a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a><a href="/sms-terms" target="_blank" rel="noopener noreferrer">Phone Texting</a></nav><p className="auth-fine">Read our terms, privacy practices and phone texting guidance.</p>
    </div><div className="auth-bottom">Churp · A little closer, together.</div></main>
    {forgot && <ForgotPasswordDialog config={config} onClose={()=>setForgot(false)}/>}
  </div>;
}
