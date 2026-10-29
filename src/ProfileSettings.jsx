import React,{useEffect,useRef,useState} from 'react';
import { ArrowLeft,Bell,BellOff,Check,ChevronRight,LogOut,Settings2,ShieldCheck,UserRound,Users,FileText } from 'lucide-react';
import { Avatar,AvatarEditor,Field,Form,Modal } from './components';
import AvatarPortrait from './AvatarPortrait';
import BirdPicker from './BirdPicker';
import { Bird } from './BirdJourney';
import {FamilySettings} from './Family';
import {Clock} from 'lucide-react';
import {openScheduled} from './ScheduleControls';
import {FamilyAlertAvatar,familyNeedsAction} from './FamilyAlert';
import UnreadEgg from './UnreadEgg';
import {NotificationScreen,NotificationPrivacySettings} from './notifications';
import { AccountSecuritySettings } from './AccountSecurity';
import { GoogleAccountSettings } from './GoogleSignIn';
import { EncryptionSettings } from './encryption/EncryptionGate';
import {legalLinks,policyStatus} from '../shared/legal';
import { AVATARS } from '../shared/avatars';
import { BIRDS, getBird } from '../shared/birds';
import { api,post } from './api';
import './profile-settings.css';

const sections=[
  {id:'profile',title:'Profile & avatar',description:'Your name and profile picture',icon:UserRound},
  {id:'scheduled',title:'Scheduled messages',description:'View, edit, reschedule or cancel pending sends',icon:Clock},
  {id:'pet',title:'My pet',description:'Your companion in every Tree',icon:null},
  {id:'family',title:'Family & youth protection',description:'Linked parents and adult message approvals',icon:Users},
  {id:'account',title:'Account settings',description:'Sign-in, password and recovery email',icon:Settings2},
  {id:'security',title:'Security',description:'Message privacy, E2EE and recovery keys',icon:ShieldCheck},
  {id:'legal',title:'About & policies',description:'Terms, privacy and phone texting',icon:FileText},
  {id:'notifications',title:'Notifications',description:'Alerts on this device',icon:Bell},
];
export default function ProfileSettings({user,config,onClose,onSave,onAccountUpdate,onLogout,notify}){
  const [section,setSection]=useState(null),content=useRef(null);
  const selected=sections.find(s=>s.id===section);
  // Each screen starts at its heading instead of inheriting the previous scroll position.
  useEffect(()=>{if(!section)return;content.current?.closest('.modal')?.scrollTo(0,0);content.current?.querySelector('.settings-back')?.focus();},[section]);
  return <Modal title={selected?.title || 'Your corner'} subtitle={selected ? undefined : 'A little space for you.'} onClose={onClose}>
    <div ref={content} className={`profile-settings ${section ? 'settings-detail' : 'settings-home'}`}>
      {section ? <><button type="button" className="text-button settings-back" onClick={()=>setSection(null)}><ArrowLeft size={17}/>Back to your settings</button>
        {section==='profile' && <ProfileScreen user={user} onSave={onSave} onDone={onClose} notify={notify}/>}
        {section==='pet' && <PetScreen user={user} onSave={onSave} onAccountUpdate={onAccountUpdate} onDone={onClose} notify={notify}/>}
        {section==='account' && <><div className="settings-account-id"><span>Signed in as</span><strong>@{user.username}</strong></div><GoogleAccountSettings user={user} config={config} onAccountUpdate={onAccountUpdate}/><AccountSecuritySettings user={user} config={config} onAccountUpdate={onAccountUpdate}/></>}
        {section==='family' && <FamilySettings user={user}/>}
        {section==='security' && <><NotificationPrivacySettings user={user} onAccountUpdate={onAccountUpdate}/><p className="settings-intro">Choose who manages your message keys and how you recover encrypted conversations.</p>{config.encryptionRequired?<EncryptionSettings/>:<p className="info-banner">Encrypted messaging is not enabled in this environment.</p>}</>}
        {section==='legal' && <section className="settings-section"><p>Read Churp’s policies without signing in. Each document opens in a separate tab.</p><nav className="policy-links" aria-label="Churp policies">{legalLinks.map(link=><a key={link.path} href={link.path} target="_blank" rel="noopener noreferrer">{link.title}<ChevronRight size={17}/></a>)}</nav><p className="small-text muted">{policyStatus}</p></section>}
        {section==='notifications'  && <NotificationScreen config={config} user={user}/>}
      </>:<>
        <div className="settings-person"><FamilyAlertAvatar user={user} size={64}/><div><strong>{user.name}</strong><span>@{user.username}</span></div></div>
        <nav className="settings-menu" aria-label="Your settings">{sections.map(({id,title,description,icon:Icon})=><button key={id} className={id==='family'&&familyNeedsAction(user)?'family-menu-alert':undefined} type="button" aria-label={title} onClick={()=>{if(id==='scheduled'){onClose();openScheduled();}else setSection(id);}}><span className={`settings-menu-icon ${id==='pet' ? 'pet-menu-icon' : ''} ${id==='family'&&familyNeedsAction(user)?'family-action-glow':''}`}>{Icon?<Icon size={22}/>:<Bird birdId={user.bird_id}/>}<UnreadEgg active={id==='family'&&familyNeedsAction(user)}/></span><span><strong>{title}{id==='family'&&user.family?.pending_reviews>0?` (${user.family.pending_reviews})`:null}</strong><small>{description}</small></span><ChevronRight size={18}/></button>)}</nav>
        <button className="text-button danger settings-sign-out" onClick={onLogout}><LogOut size={17}/>Sign out of Churp</button>
      </>}
    </div>
  </Modal>;
}
function ProfileScreen({user,onSave,onDone,notify}){
  const [avatarId,setAvatarId]=useState(user.avatar_id),[choice,setChoice]=useState(user.avatar_choice || 'blue'),[style,setStyle]=useState(user.avatar_style==='photo' ? 'photo' : 'portrait');
  const [name,setName]=useState(user.name);
  return <Form submit="Save profile" onSubmit={async()=>{await onSave({name,avatar_id:avatarId,avatar_choice:choice,avatar_style:style});notify('Profile updated.');onDone();}}>
    <div className="profile-picture-preview"><Avatar name={name} id={avatarId} portrait={style==='portrait' ? choice : undefined} size={86}/><div><strong>Your profile picture</strong><p>People see this beside your messages.</p></div></div>
    <Field label="Display name" name="name" value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/>
    <fieldset className="avatar-picker"><legend>Choose an avatar</legend><p className="small-text muted">20 birds, all included. Your pet is chosen separately.</p><div className="avatar-choice-grid">{AVATARS.map(avatar=><label key={avatar.id} className={`avatar-choice ${style==='portrait' && choice===avatar.id ? 'chosen' : ''}`}><input type="radio" name="profile_avatar" aria-label={avatar.name} checked={style==='portrait' && choice===avatar.id} onChange={()=>{setChoice(avatar.id);setStyle('portrait');}}/><span className="avatar-choice-art"><AvatarPortrait choice={avatar.id}/></span><strong>{avatar.name}</strong>{style==='portrait' && choice===avatar.id && <Check className="avatar-choice-check" size={15}/>}</label>)}</div></fieldset>
    <div className={`profile-upload ${style==='photo' ? 'is-selected' : ''}`}><h3>Or upload your own image</h3><AvatarEditor name={name} value={avatarId} onChange={id=>{setAvatarId(id);setStyle(id ? 'photo' : 'portrait');}}/>{avatarId && <button type="button" className="text-button" onClick={()=>setStyle('photo')}>{style==='photo' ? 'Using your uploaded image' : 'Use this image'}</button>}</div>
  </Form>;
}
function PetScreen({user,onSave,onAccountUpdate,onDone,notify}){
  const [birdId,setBirdId]=useState(user.bird_id || 'blue'),[unlocked,setUnlocked]=useState(user.unlocked_birds || ['blue','gold']);
  return <>
    <Form submit="Save pet" onSubmit={async()=>{await onSave({bird_id:birdId});notify('Your pet is ready to fly.');onDone();}}>
      <div className="pet-preview"><Bird birdId={birdId}/><div><strong>{getBird(birdId)?.name}</strong><p>Your pet perches in the Tree banner and flies into each Nest with you.</p><small>Your profile picture stays the same.</small></div></div>
      <BirdPicker selected={birdId} visible={user.visible_birds} seasons={user.bird_seasons} unlocked={unlocked} onSelect={setBirdId}/>
    </Form>
    <div className="settings-section bird-unlock"><h4>Grow your pet collection</h4>{BIRDS.some(b=>!b.free&&!unlocked.includes(b.id))?<Form submit="Redeem code" onSubmit={async form=>{const result=await post('/me/birds/unlock',{code:form.get('code')});setUnlocked(result.user.unlocked_birds);onAccountUpdate(result.user);notify('Your pet collection is unlocked. Choose your favorite and save your pet.');}}><p className="muted small-text">Bluebird and Goldfinch are included. Have an unlock code?</p><Field label="Unlock code" name="code" autoComplete="off" required maxLength={64}/></Form>:<p className="bird-unlocked-message" role="status"><Check size={16}/>Your pet collection is unlocked.</p>}<button className="button secondary small" disabled>Purchases coming soon</button></div>
  </>;
}
