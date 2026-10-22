import React, { useEffect, useId, useRef } from 'react';

// A single appearance contract for perched, travelling and landed birds.
// Future skin selection can supply this prop without changing navigation.
export const defaultBirdSkin = { body:'#75c4d7', wing:'#49a9c2', belly:'#fff1c5', beak:'#efa83b' };
export function Bird({ className='', skin=defaultBirdSkin }) {
  const gradient=useId();
  return <svg className={`churp-bird ${className}`} viewBox="0 0 80 72" fill="none" aria-hidden="true">
    <defs><linearGradient id={gradient} x1="30" y1="15" x2="61" y2="65" gradientUnits="userSpaceOnUse"><stop stopColor={skin.body}/><stop offset="1" stopColor={skin.wing}/></linearGradient></defs>
    <path d="M25 54 9 48 17 63 34 60" fill={skin.wing}/>
    <path d="M34 16 Q27 3 34 4 L40 14 Q39 0 45 3 L46 16" fill={skin.wing}/>
    <path d="M21 43C21 24 30 13 44 13c18 0 25 15 25 30 0 15-10 22-25 22S21 59 21 43Z" fill={`url(#${gradient})`}/>
    <ellipse cx="48" cy="51" rx="15" ry="14" fill={skin.belly}/>
    <path className="bird-wing" d="M36 36C23 30 17 36 21 48c3 9 11 12 16 9 5-3 8-16-1-21Z" fill={skin.wing}/>
    <path d="m63 31 13 6-13 6Z" fill={skin.beak}/>
    <path d="M51 30q3-6 7 0" stroke="#3d5045" strokeWidth="3" strokeLinecap="round"/>
    <path d="m38 64-2 5m15-5 2 5M32 69h8m9 0h8" stroke="#bb803a" strokeWidth="2.5" strokeLinecap="round"/>
  </svg>;
}
export function LandingNest() {
  return <svg viewBox="0 0 90 65" className="landing-nest-art" fill="none" aria-hidden="true">
    <path d="M6 31q38 15 78 0c-2 23-19 30-39 30S10 54 6 31Z" fill="#a76e37"/>
    <ellipse cx="45" cy="32" rx="38" ry="10" fill="#795335"/>
    <g strokeLinecap="round" strokeWidth="5"><path d="M9 34q38 27 72 5M12 43q35 24 61 4M17 52q29 14 49 2" stroke="#d5a45e"/><path d="M7 37q35 9 74-2M17 48q33 4 59-6M28 56q24-3 40-8" stroke="#b47d40"/><path d="m10 31-5-9m73 11 7-12M17 34l-7-12" stroke="#c59755"/></g>
  </svg>;
}
export default function BirdJourney({ journey, onDone }) {
  const ref=useRef();
  useEffect(() => {
    const node=ref.current, destination=document.querySelector('[data-bird-landing]');
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!node || !destination || !node.animate || motion.matches) {onDone();return;}
    const target=destination.getBoundingClientRect(), start=journey.start;
    // The chat is sliding right when mounted. Land at its final coordinates.
    const chatTransform=new DOMMatrix(getComputedStyle(destination.closest('.chat-layout')).transform);
    const end={x:target.left-chatTransform.m41+target.width/2-32,y:target.top-chatTransform.m42-20};
    const panelLeft=document.querySelector('.main-content').getBoundingClientRect().left;
    node.parentElement.style.clipPath=`inset(0 0 0 ${panelLeft}px)`;
    const startX=Math.min(start.x,innerWidth-65), startY=Math.max(0,start.y);
    const flightY=Math.max(64,Math.min(startY,end.y)-30);
    const landingScale=Math.min(.72,target.width/64);
    const animation=node.animate([
      {offset:0,transform:`translate(${startX}px,${startY}px) rotate(-8deg) scale(1)`,opacity:1},
      {offset:.3,transform:`translate(${innerWidth+70}px,${flightY}px) rotate(-15deg) scale(1)`,opacity:1},
      {offset:.31,transform:`translate(${innerWidth+70}px,${flightY}px) scale(1)`,opacity:0},
      {offset:.32,transform:`translate(${panelLeft-70}px,${flightY}px) scale(1)`,opacity:0},
      {offset:.34,transform:`translate(${panelLeft-60}px,${flightY}px) rotate(-5deg) scale(1)`,opacity:1},
      {offset:.8,transform:`translate(${end.x-40}px,${end.y-18}px) rotate(5deg) scale(.85)`,opacity:1},
      {offset:1,transform:`translate(${end.x}px,${end.y}px) rotate(0deg) scale(${landingScale})`,opacity:1},
    ],{duration:800,easing:'ease-in-out',fill:'forwards'});
    animation.onfinish=onDone;
    const resize=()=>onDone(); window.addEventListener('resize',resize,{once:true});
    motion.addEventListener('change',resize,{once:true});
    return () => {animation.cancel();window.removeEventListener('resize',resize);motion.removeEventListener('change',resize);};
  },[journey,onDone]);
  return <div className="bird-flight" aria-hidden="true"><div className="travelling-bird" ref={ref}><Bird className="is-flying"/></div></div>;
}
