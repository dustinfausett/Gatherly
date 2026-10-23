import React from 'react';
import { ShieldCheck } from 'lucide-react';

export default function PrivacyShield({active,size=15}){
  if(!active)return null;
  return <span className="privacy-shield" role="img" aria-label="End-to-end encrypted for new messages" title="Every joined member uses self-managed keys. New messages are end-to-end encrypted; earlier history may have different protection."><ShieldCheck size={size} aria-hidden="true"/></span>;
}
