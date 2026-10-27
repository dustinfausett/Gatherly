import React,{useEffect,useId,useRef,useState} from 'react';
import {Bird} from './BirdJourney';
import {FEED_DURATION,FOOD_ART,feedingMotion,feedingProfile} from './petFeedingMotion';
import {CHRISTMAS_ART} from './birdArtwork';
import './pet-feeding.css';

// Display crops only: the generated sheet is stored intact alongside the pets.
const foods={seeds:[18,334,398,254],berries:[430,332,395,256],fruit:[841,332,399,256],treats:[18,747,398,259],nectar:[442,716,379,286],grain:[889,810,315,174],berryBite:[648,391,137,135],fruitBite:[1004,343,115,109],treatBite:[168,758,103,100],nectarBite:[565,858,150,82],candycanes:[471,792,388,334],candyBite:[943,814,252,290]};
const bites={seeds:'grain',berries:'berryBite',fruit:'fruitBite',treats:'treatBite',nectar:'nectarBite',candycanes:'candyBite'};
function Food({kind,className=''}){
 const id=useId(),[x,y,width,height]=foods[kind];
 return <svg className={`pet-food-art ${className}`} viewBox={`${x} ${y} ${width} ${height}`} aria-hidden="true"><defs><clipPath id={id}><rect x={x} y={y} width={width} height={height}/></clipPath></defs><image href={kind==='candycanes'||kind==='candyBite'?CHRISTMAS_ART:FOOD_ART} width="1254" height="1254" clipPath={`url(#${id})`}/></svg>;
}
export default function PetFeeding({birdId}){
 const profile=feedingProfile(birdId),bird=profile.bird,statusId=useId(),button=useRef(),body=useRef(),dish=useRef(),morsels=useRef([]),hearts=useRef([]),locked=useRef(false);
 const [feeding,setFeeding]=useState(false),[status,setStatus]=useState('');
 useEffect(()=>{
  if(!feeding)return;
  let active=true,timer,animations=[];
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const finish=()=>{if(!active)return;for(const animation of animations)animation.cancel();locked.current=false;setFeeding(false);setStatus(`${bird.name} enjoyed the ${profile.label}!`);};
  const animate=(element,frames,options)=>{const animation=element.animate(frames,{duration:FEED_DURATION,fill:'both',...options});animations.push(animation);return animation;};
  const start=async()=>{try{
   const image=new Image();image.src=profile.foodArt||FOOD_ART;await image.decode();if(!active)return;
   if(reduced.matches||!body.current.animate){dish.current.style.opacity='1';timer=setTimeout(finish,1000);return;}
   const size=button.current.getBoundingClientRect().width,motion=feedingMotion(profile,size);body.current.style.transformOrigin=motion.origin;
   const flight=animate(body.current,motion.bird);
   animate(dish.current,[{offset:0,opacity:0,transform:'translate(-50%,-32%) translate(10px,5px) scale(.65)'},{offset:.12,opacity:1,transform:'translate(-50%,-32%) translate(0,0) scale(1)'},{offset:.82,opacity:1,transform:'translate(-50%,-32%) translate(0,0) scale(1)'},{offset:1,opacity:0,transform:'translate(-50%,-32%) translate(0,3px) scale(.88)'}]);
   for(const [index,at] of [.25,.48,.67].entries()){
    const move=(offset,x,y,scale,opacity)=>({offset,transform:`translate(${x}px,${y}px) scale(${scale})`,opacity,easing:'ease-in-out'}),[dx,dy]=motion.dish,[mx,my]=motion.mouth;
    animate(morsels.current[index],[move(0,dx,dy,0,0),move(at-.07,dx,dy,.8,0),move(at-.04,dx,dy-2,1,1),move(at,mx,my,1,1),move(at+.035,mx,my,.1,0),move(1,mx,my,0,0)]);
   }
   hearts.current.forEach((node,index)=>animate(node,[{offset:0,opacity:0,transform:'translate(0,4px) scale(.3)'},{offset:.75+index*.03,opacity:0,transform:'translate(0,4px) scale(.3)'},{offset:.84+index*.03,opacity:.9,transform:`translate(${index*5-5}px,-5px) scale(1)`},{offset:1,opacity:0,transform:`translate(${index*8-8}px,-19px) scale(.7)`}]));
   flight.finished.then(finish).catch(()=>{});
  }catch{if(active){locked.current=false;setFeeding(false);setStatus('The snack could not load. Tap your pet to try again.');}}};
  start();window.addEventListener('resize',finish);reduced.addEventListener('change',finish);
  return()=>{active=false;clearTimeout(timer);for(const animation of animations)animation.cancel();if(dish.current)dish.current.style.opacity='';window.removeEventListener('resize',finish);reduced.removeEventListener('change',finish);};
 },[feeding,bird.id]);
 const motion=feedingMotion(profile,512),[x,y]=motion.dish;
 return <>
  <button type="button" className="banner-bird pet-feed-button" data-bird-perch data-feeding={feeding?'true':'false'} data-food={profile.food} ref={button} aria-label={`Feed ${bird.name}`} aria-describedby={statusId} aria-busy={feeding} disabled={feeding} onClick={()=>{if(locked.current)return;locked.current=true;setStatus(`${bird.name} is enjoying ${profile.label}.`);setFeeding(true);}}>
   <span className="pet-feed-bird" ref={body}><Bird birdId={bird.id}/></span>
   <span className="pet-feed-dish" ref={dish} style={{left:`${x/512*100}%`,top:`${y/512*100}%`}}><Food kind={profile.food}/></span>
   {[0,1,2].map(index=><span className="pet-feed-morsel" ref={node=>morsels.current[index]=node} key={index}><Food kind={bites[profile.food]}/></span>)}
   <span className="pet-feed-hearts" aria-hidden="true">{[0,1,2].map(index=><svg key={index} ref={node=>hearts.current[index]=node} viewBox="0 0 24 24"><path d="M12 21S2 15 2 8a5 5 0 0 1 10-2A5 5 0 0 1 22 8c0 7-10 13-10 13Z"/></svg>)}</span>
  </button>
  <span id={statusId} className="visually-hidden" role="status" aria-live="polite">{status}</span>
 </>;
}
