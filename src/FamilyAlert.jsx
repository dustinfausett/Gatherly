import React from 'react';
import {Avatar} from './components';
import UnreadEgg from './UnreadEgg';
export const familyNeedsAction=user=>!!(user.family?.action_required||user.family?.pending_reviews);
export function FamilyAlertAvatar({user,size=40}){const active=familyNeedsAction(user);return <span className={`family-alert-avatar ${active?'family-action-glow':''}`} aria-label={active?'Family protection needs attention':undefined}><Avatar name={user.name} id={user.avatar_id} portrait={user.avatar_style!=='photo'?user.avatar_choice||'blue':undefined} size={size}/><UnreadEgg active={active}/></span>;}
