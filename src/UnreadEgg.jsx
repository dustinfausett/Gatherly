import React, { useLayoutEffect, useRef, useState } from 'react';

export default function UnreadEgg({ active, urgent=false }) {
  // Mounting an already unread row (including after navigation or pinning) is
  // not a new unread event. Animate only a live state change on this screen.
  const previous=useRef({active,urgent});
  const [arriving,setArriving]=useState(false);
  useLayoutEffect(()=>{
    const before=previous.current;
    previous.current={active,urgent};
    const changed=active && (!before.active || (urgent && !before.urgent));
    if (!changed || document.visibilityState !== 'visible' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {setArriving(false);return;}
    setArriving(true);
    const timer=setTimeout(()=>setArriving(false),460);
    return ()=>clearTimeout(timer);
  },[active,urgent]);
  return active ? <span key={urgent ? 'urgent' : 'unread'} className={`avatar-status-egg ${urgent ? 'urgent' : ''} ${arriving ? 'egg-arriving' : ''}`} aria-hidden="true"/> : null;
}
