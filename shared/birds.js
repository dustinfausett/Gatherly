// Stable IDs are stored on accounts and unlocks. Artwork can evolve independently.
export const BIRDS = [
  { id: 'blue', name: 'Bluebird', free: true, collection: 'meadow', row: 0 },
  { id: 'gold', name: 'Goldfinch', free: true, collection: 'meadow', row: 1 },
  { id: 'pink', name: 'Pink Blossom', collection: 'meadow', row: 2 },
  { id: 'lavender', name: 'Lavender', collection: 'meadow', row: 3 },
  { id: 'mint', name: 'Mint', collection: 'canopy', row: 0 },
  { id: 'coral', name: 'Coral', collection: 'canopy', row: 1 },
  { id: 'parrot', name: 'Parrot', collection: 'canopy', row: 2 },
  { id: 'cockatiel', name: 'Cockatiel', collection: 'canopy', row: 3 },
  { id: 'owl', name: 'Owl', collection: 'woodland', row: 0 },
  { id: 'robin', name: 'Robin', collection: 'woodland', row: 1 },
  { id: 'cardinal', name: 'Cardinal', collection: 'woodland', row: 2 },
  { id: 'hummingbird', name: 'Hummingbird', collection: 'woodland', row: 3 },
  { id: 'goose', name: 'Goose', collection: 'goose', row: 0, secret: true },
  { id: 'christmas', name: 'Christmas Bird', free: true, collection: 'christmas', row: 0, seasonal: true },
  { id: 'valentine', name: 'Valentine Bird', free: true, collection: 'valentine', row: 0, seasonal: true },
  { id: 'st-patrick', name: 'St. Patrick’s Bird', free: true, collection: 'st-patrick', row: 0, seasonal: true },
  { id: 'independence', name: 'Independence Bird', free: true, collection: 'independence', row: 0, seasonal: true },
  { id: 'halloween', name: 'Halloween Bird', free: true, collection: 'halloween', row: 0, seasonal: true },
  { id: 'thanksgiving', name: 'Thanksgiving Bird', free: true, collection: 'thanksgiving', row: 0, seasonal: true },

];
export const getBird = id => BIRDS.find(b => b.id === id);

// Calendar dates use Denver, matching the rest of Churp's seasonal experience.
const day = 86400000;
const dateKey = value => new Date(value).toISOString().slice(0,10);
function localCalendar(date) {
 const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Denver',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(date);
 const part = type => Number(parts.find(p=>p.type===type).value);
 return Date.UTC(part('year'),part('month')-1,part('day'));
}
function holidayDate(id,year) {
 const fixed = {christmas:[11,25],valentine:[1,14],'st-patrick':[2,17],independence:[6,4],halloween:[9,31]};
 if(id==='thanksgiving') {
  const first = Date.UTC(year,10,1);
  return first + ((4-new Date(first).getUTCDay()+7)%7+21)*day;
 }
 return fixed[id] ? Date.UTC(year,...fixed[id]) : null;
}
function windowFor(id,year) {
 const holiday = holidayDate(id,year);
 if(holiday===null)return null;
 const date = new Date(holiday), month = date.getUTCMonth()-1;
 // A calendar month before October 31 is September 30, not October 1.
 const lastDay = new Date(Date.UTC(year,month+1,0)).getUTCDate();
 const start = Date.UTC(year,month,Math.min(date.getUTCDate(),lastDay));
 return {holiday,preview:start-7*day,start,end:holiday+3*day};
}
export function seasonalWindow(bird,date=new Date()) {
 if(!bird?.seasonal)return null;
 const today=localCalendar(date),year=new Date(today).getUTCFullYear();
 let window=windowFor(bird.id,year);
 if(!window)return null;
 if(today>window.end)window=windowFor(bird.id,year+1);
 return Object.fromEntries(Object.entries(window).map(([key,value])=>[key,dateKey(value)]));
}
export function seasonalLabel(bird,date=new Date()) {
 const window=seasonalWindow(bird,date);
 if(!window)return '';
 const format=value=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(value));
 return `${format(window.start)}–${format(window.end)}`;
}
export function birdStatus(bird,date=new Date(),earned=[]) {
 if(!bird||bird.secret&&!earned.includes(bird.id))return 'hidden';
 if(!bird.seasonal)return 'available';
 const window=seasonalWindow(bird,date),today=dateKey(localCalendar(date));
 if(!window||today<window.preview||today>window.end)return 'hidden';
 return today<window.start?'preview':'available';
}
export const birdIsAvailable=(bird,date=new Date(),earned=[])=>birdStatus(bird,date,earned)==='available';
export const birdIsVisible=(bird,date=new Date(),earned=[])=>birdStatus(bird,date,earned)!=='hidden';
