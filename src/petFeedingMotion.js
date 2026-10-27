import {HOLIDAY_ART} from './holidayArtwork';
import {getBird} from '../shared/birds';
import {birdFrame} from './birdArtwork';

export const FEED_DURATION=3800;
export const FOOD_ART='/brand/pets/feeding-food.png';
// Mouth and feet positions in the original, unmodified perched artwork.
const pets={
 blue:{food:'seeds',label:'golden seeds',mouth:[371,214],feet:[256,440]},
 gold:{food:'seeds',label:'golden seeds',mouth:[267,478],feet:[180,635]},
 pink:{food:'berries',label:'berries',mouth:[264,778],feet:[180,927]},
 lavender:{food:'berries',label:'berries',mouth:[266,1058],feet:[180,1214]},
 mint:{food:'seeds',label:'golden seeds',mouth:[250,173],feet:[170,335]},
 coral:{food:'berries',label:'berries',mouth:[255,484],feet:[170,632]},
 parrot:{food:'fruit',label:'fruit bites',mouth:[264,761],feet:[180,910]},
 cockatiel:{food:'seeds',label:'golden seeds',mouth:[261,1040],feet:[180,1215]},
 owl:{food:'treats',label:'little bird treats',mouth:[262,173],feet:[180,318]},
 robin:{food:'berries',label:'berries',mouth:[267,440],feet:[180,610]},
 cardinal:{food:'seeds',label:'golden seeds',mouth:[267,751],feet:[180,916]},
 hummingbird:{food:'nectar',label:'flower nectar',mouth:[310,1018],feet:[175,1200]},
 ...Object.fromEntries(Object.entries(HOLIDAY_ART).map(([id,art])=>[id,{...art,foodArt:art.src}])),
};
export function feedingProfile(id){
 const bird=getBird(id)||getBird('blue'),pet=pets[bird.id];
 if(bird.id==='blue')return {...pet,bird};
 const frame=birdFrame(bird,'perched'),scale=440/Math.max(frame.width,frame.height);
 const point=([x,y])=>[36+(440-frame.width*scale)/2+(x-frame.x)*scale,440-frame.height*scale+(y-frame.y)*scale];
 return {...pet,bird,mouth:point(pet.mouth),feet:point(pet.feet)};
}
export function feedingMotion(profile,size){
 const scale=size/512,[px,py]=profile.feet,[mx,my]=profile.mouth,angle=26,rad=angle*Math.PI/180;
 const rotated=[px+(mx-px)*Math.cos(rad)-(my-py)*Math.sin(rad),py+(mx-px)*Math.sin(rad)+(my-py)*Math.cos(rad)];
 // Keep the food inside the perch, including the hummingbird's longer beak.
 const shift=Math.min(0,480-rotated[0]),mouth=[(rotated[0]+shift)*scale,rotated[1]*scale],dish=[mouth[0],mouth[1]+29*scale];
 const pose=(offset,tilt=0,lean=0,squash=1)=>({offset,transform:`translateX(${shift*scale*lean}px) rotate(${tilt}deg) scale(1,${squash})`,easing:'ease-in-out'});
 return {origin:`${px/512*100}% ${py/512*100}%`,mouth,dish,
  bird:[pose(0),pose(.12,-4),pose(.25,angle,1),pose(.31,angle,1,.98),pose(.4,4),pose(.48,angle,1),pose(.53,angle,1,.98),pose(.59,4),pose(.67,angle,1),pose(.72,angle,1,.98),pose(.81),pose(.9,-3,0,1.03),pose(1)],
 };
}
