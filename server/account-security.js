import { rateLimit } from 'express-rate-limit';
import { hash, token, passwordHash, passwordMatches } from './security.js';

export function normalizeEmail(value) {
  if(typeof value!=='string' || value.trim().length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim()))throw Object.assign(new Error('Enter a valid recovery email address.'),{status:400});
  return value.trim().toLowerCase();
}
export function accountMailer({apiKey=process.env.RESEND_API_KEY,from=process.env.CHURP_EMAIL_FROM}={}) {
  if(!apiKey || !from)return null;
  return async({to,subject,text})=>{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify({from,to:[to],subject,text}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Email delivery failed. Check the email provider configuration.');
  };
}
export function installAccountSecurity({app,db,auth,session,transaction,publicUser,refreshUser,endSessions,appUrl,testing,mailer}){
  const one=(s,...a)=>db.prepare(s).get(...a),run=(s,...a)=>db.prepare(s).run(...a),fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
  const enabled=!!mailer;
  const limited=rateLimit({windowMs:15*60000,limit:testing?1000:8,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Please wait before trying account recovery again.'}});
  const signedLimit=rateLimit({windowMs:15*60000,limit:testing?1000:15,keyGenerator:req=>req.user.id,message:{error:'Please wait before changing account security again.'}});
  const validatePassword=value=>{if(typeof value!=='string' || value.length<8 || value.length>128)fail(400,'Use a password between 8 and 128 characters.');return value;};
  function record(value,kind){
    if(typeof value!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(value))fail(400,'This link is invalid or has expired. Request a new one.');
    const row=one('SELECT * FROM account_tokens WHERE token_hash=? AND kind=?',hash(value),kind);
    if(!row || row.expires_at<=Date.now())fail(400,'This link is invalid or has expired. Request a new one.');return row;
  }
  async function currentPassword(req){
    if(!req.user.password)fail(400,'This account uses Google Sign-in. Manage its password and recovery through Google.');
    if(typeof req.body.currentPassword!=='string' || req.body.currentPassword.length>128 || !await passwordMatches(req.body.currentPassword,req.user.password))fail(403,'Your current password is incorrect.');
    if(one('SELECT password FROM users WHERE id=?',req.user.id)?.password!==req.user.password)fail(409,'Account security changed. Sign in again.');
  }
  function recent(userId){return one('SELECT COUNT(*) AS n FROM account_tokens WHERE user_id=? AND created_at>?',userId,Date.now()-3600000).n;}
  async function send(user,email,kind){
    if(!enabled)fail(503,'Recovery email delivery is awaiting setup. You can still change your password while signed in.');
    if(recent(user.id)>=5)fail(429,'Please wait before requesting another email.');
    const value=token(),now=Date.now(),expires=now+(kind==='reset'?30*60000:24*3600000);
    run('DELETE FROM account_tokens WHERE expires_at<?',now-24*3600000);
    run('INSERT INTO account_tokens VALUES (?,?,?,?,?,?)',hash(value),user.id,kind,email,now,expires);
    const url=new URL('/',appUrl);url.searchParams.set(kind==='reset'?'reset_password':'verify_email',value);
    try{await mailer({to:email,subject:kind==='reset'?'Reset your Churp password':'Verify your Churp recovery email',text:`${kind==='reset'?'Reset the password':'Verify the recovery email'} for your Churp account (${user.username}).\n\n${url.href}\n\nThis link expires in ${kind==='reset'?'30 minutes':'24 hours'} and can be used once. If you did not request it, ignore this email. Churp will never ask for your encryption recovery key.`});}
    catch(e){run('DELETE FROM account_tokens WHERE token_hash=?',hash(value));throw Object.assign(new Error('The email could not be sent. Please try again later.'),{status:503});}
  }
  async function stage(user,email){
    if(!enabled)fail(503,'Recovery email delivery is awaiting setup.');
    const normalized=normalizeEmail(email);
    if(one('SELECT 1 FROM users WHERE email=? AND id<>?',normalized,user.id))fail(409,'That email is already linked to another Churp account.');
    run('UPDATE users SET pending_email=? WHERE id=?',normalized,user.id);
    run("DELETE FROM account_tokens WHERE user_id=? AND kind='verify'",user.id);
    await send(user,normalized,'verify');refreshUser(user.id);
  }
  app.post('/api/auth/forgot-password',limited,async(req,res)=>{
    if(!enabled)fail(503,'Recovery email delivery is awaiting setup. If you are signed in on another device, change your password in your profile.');
    const value=typeof req.body.account==='string'?req.body.account.trim().toLowerCase().slice(0,254):'';
    const user=one('SELECT * FROM users WHERE lower(username)=? OR email=?',value,value);
    if(user?.password && user.email && user.email_verified_at && recent(user.id)<5)void send(user,user.email,'reset').catch(()=>console.error('Password recovery email delivery failed.'));
    res.json({ok:true,message:'If this account has a verified recovery email, a reset link will arrive shortly. Google accounts should use Google account recovery.'});
  });
  app.post('/api/auth/reset-password',limited,async(req,res)=>{
    const entry=record(req.body.token,'reset'),user=one('SELECT * FROM users WHERE id=?',entry.user_id);
    if(!user?.password || user.email!==entry.email || !user.email_verified_at)fail(400,'This link is invalid or has expired. Request a new one.');
    const next=await passwordHash(validatePassword(req.body.password));
    transaction(()=>{record(req.body.token,'reset');const fresh=one('SELECT * FROM users WHERE id=?',user.id);if(fresh.password!==user.password || fresh.email!==entry.email)fail(409,'Account security changed. Request a new reset link.');run('UPDATE users SET password=? WHERE id=?',next,user.id);run('DELETE FROM sessions WHERE user_id=?',user.id);run('DELETE FROM account_tokens WHERE user_id=?',user.id);});
    endSessions(user.id);res.clearCookie('gatherly_session',{path:'/'});res.json({ok:true});
  });
  app.post('/api/auth/verify-email',limited,(req,res)=>{
    const entry=record(req.body.token,'verify');
    transaction(()=>{const user=one('SELECT * FROM users WHERE id=?',entry.user_id);if(!user || user.pending_email!==entry.email)fail(400,'This link is invalid or has expired. Request a new one.');if(one('SELECT 1 FROM users WHERE email=? AND id<>?',entry.email,user.id))fail(409,'That email is already linked to another Churp account.');run('UPDATE users SET email=?,email_verified_at=?,pending_email=NULL WHERE id=?',entry.email,Date.now(),user.id);run('DELETE FROM account_tokens WHERE user_id=?',user.id);});
    refreshUser(entry.user_id);res.json({ok:true});
  });
  app.post('/api/me/password',auth,signedLimit,async(req,res)=>{
    await currentPassword(req);const next=await passwordHash(validatePassword(req.body.password));
    transaction(()=>{if(one('SELECT password FROM users WHERE id=?',req.user.id).password!==req.user.password)fail(409,'Your password changed. Sign in again.');run('UPDATE users SET password=? WHERE id=?',next,req.user.id);run('DELETE FROM sessions WHERE user_id=?',req.user.id);run('DELETE FROM account_tokens WHERE user_id=?',req.user.id);});
    endSessions(req.user.id);res.json({user:session(res,one('SELECT * FROM users WHERE id=?',req.user.id))});
  });
  app.post('/api/me/recovery-email',auth,signedLimit,async(req,res)=>{
    await currentPassword(req);await stage(req.user,req.body.email);res.json({user:publicUser(one('SELECT * FROM users WHERE id=?',req.user.id)),message:'Check your inbox to verify this recovery email.'});
  });
  app.delete('/api/me/recovery-email',auth,signedLimit,async(req,res)=>{
    await currentPassword(req);transaction(()=>{run('UPDATE users SET email=NULL,email_verified_at=NULL,pending_email=NULL WHERE id=?',req.user.id);run('DELETE FROM account_tokens WHERE user_id=?',req.user.id);});refreshUser(req.user.id);res.json({user:publicUser(one('SELECT * FROM users WHERE id=?',req.user.id))});
  });
  return {enabled,stage};
}
