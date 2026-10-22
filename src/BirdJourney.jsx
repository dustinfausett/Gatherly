import React, { useEffect, useId, useRef, useState } from 'react';

export const NEST_MOTION = { press:220, slide:1400, flight:2400 };
// Display the approved artwork itself. Clip the perch/landing supports away from
// moving poses in SVG, preserving the original PNG and its transparent edges.
// A future skin can supply a different sheet and corresponding frame definitions.
export const defaultBirdSkin = {
  src:'/brand/previews/churp-bird-poses.png',
  frames:{
    perched:{x:0,y:0,dx:0,dy:0,clip:'M0 0H390V250H367L363 285L353 330L337 369L321 398H330V411Q331 428 318 437L278 437L267 418H262V433Q263 448 249 448H216Q198 445 198 428V403H0Z'},
    takeoff:{x:512,y:0,dx:-45,dy:34,clip:'M0 0H512V416H0Z'},
    up:{x:1024,y:0,dx:-30,dy:18},
    down:{x:0,y:512,dx:-35,dy:20},
    glide:{x:512,y:512,dx:-40,dy:20},
    landing:{x:1024,y:512,dx:-40,dy:20,clip:'M0 0H512V302H383V326H348V356H207V326H179V302H0Z'},
  },
};

function Artwork({ frame, src, className='', pose }) {
  const id=useId();
  return <svg className={className} viewBox="0 0 512 512" fill="none" aria-hidden="true" data-bird-pose={pose}>
    <defs><clipPath id={id}>{frame.clip ? <path d={frame.clip}/> : <rect width="512" height="512"/>}</clipPath></defs>
    <g transform={`translate(${frame.dx || 0} ${frame.dy || 0})`}>
      <g clipPath={`url(#${id})`}>
        <image href={src} x={-frame.x} y={-frame.y} width="1536" height="1024"/>
      </g>
    </g>
  </svg>;
}
export function Bird({ className='', skin=defaultBirdSkin, pose='perched' }) {
  return <Artwork className={`churp-bird ${className}`} frame={skin.frames[pose] || skin.frames.perched} src={skin.src} pose={pose}/>;
}
export function LandingNest() {
  const frame={x:1024,y:512,clip:'M98 330Q120 303 156 325L191 355H370L419 307Q457 313 460 346L477 363Q485 443 431 478Q284 532 158 486Q103 465 98 390Z'};
  return <Artwork className="landing-nest-art" src={defaultBirdSkin.src} frame={frame}/>;
}

export default function BirdJourney({ journey, onDone }) {
  const ref=useRef();
  const [pose,setPose]=useState('takeoff');
  useEffect(() => {
    const node=ref.current, destination=document.querySelector('[data-bird-landing]');
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!node || !destination || !node.animate || motion.matches) {onDone();return;}
    const target=destination.getBoundingClientRect(), start=journey.start;
    // The chat is sliding right when mounted. Land at its final coordinates.
    const chatTransform=new DOMMatrix(getComputedStyle(destination.closest('.chat-layout')).transform);
    const resident=destination.querySelector('.resident-bird');
    const residentSize=resident?.getBoundingClientRect().width || target.width;
    const residentTop=resident ? parseFloat(getComputedStyle(resident).top) : -9;
    const size=start.width;
    const end={x:target.left-chatTransform.m41+(target.width-size)/2,y:target.top-chatTransform.m42+residentTop-(size-residentSize)/2};
    const panelLeft=document.querySelector('.main-content').getBoundingClientRect().left;
    node.parentElement.style.clipPath=`inset(0 0 0 ${panelLeft}px)`;
    const startX=Math.min(start.x,innerWidth-size), startY=Math.max(0,start.y);
    const flightY=Math.max(64,Math.min(startY,end.y)-34);
    const landingScale=residentSize/size;
    const animation=node.animate([
      {offset:0,transform:`translate(${startX}px,${startY}px) rotate(-6deg) scale(1)`,opacity:1},
      {offset:.27,transform:`translate(${innerWidth+size}px,${flightY}px) rotate(-12deg) scale(1)`,opacity:1},
      {offset:.28,transform:`translate(${innerWidth+size}px,${flightY}px) scale(1)`,opacity:0},
      {offset:.30,transform:`translate(${panelLeft-size}px,${flightY}px) scale(1)`,opacity:0},
      {offset:.32,transform:`translate(${panelLeft-size*.9}px,${flightY}px) rotate(-4deg) scale(1)`,opacity:1},
      {offset:.8,transform:`translate(${end.x-36}px,${end.y-22}px) rotate(4deg) scale(.85)`,opacity:1},
      {offset:1,transform:`translate(${end.x}px,${end.y}px) rotate(0deg) scale(${landingScale})`,opacity:1},
    ],{duration:NEST_MOTION.flight,easing:'ease-in-out',fill:'forwards'});
    // Change only the pose; navigation and the smooth flight path remain independent.
    const sequence=[[.10,'up'],[.20,'down'],[.30,'up'],[.40,'down'],[.50,'up'],[.60,'down'],[.70,'glide'],[.82,'landing'],[.96,'perched']];
    const timers=sequence.map(([at,frame])=>setTimeout(()=>setPose(frame),NEST_MOTION.flight*at));
    animation.onfinish=onDone;
    const stop=()=>onDone();
    window.addEventListener('resize',stop,{once:true});
    motion.addEventListener('change',stop,{once:true});
    return () => {animation.cancel();timers.forEach(clearTimeout);window.removeEventListener('resize',stop);motion.removeEventListener('change',stop);};
  },[journey,onDone]);
  return <div className="bird-flight" aria-hidden="true"><div className="travelling-bird" ref={ref} style={{width:journey.start.width,height:journey.start.height}}><Bird pose={pose}/></div></div>;
}
