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
  { id: 'christmas', name: 'Christmas Bird', free: true, collection: 'christmas', row: 0, seasonal: true },
];
export const getBird = id => BIRDS.find(b => b.id === id);
// Keep enabled for the owner's early testing; switch off only when requested.
export const CHRISTMAS_PREVIEW_ENABLED=true;
export function christmasInSeason(date=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',month:'numeric',day:'numeric'}).formatToParts(date),value=type=>Number(parts.find(p=>p.type===type).value);
 return value('month')>=11||(value('month')===1&&value('day')<=3);
}
export const birdIsAvailable=(bird,date=new Date(),preview=CHRISTMAS_PREVIEW_ENABLED)=>!!bird&&(!bird.seasonal||preview||christmasInSeason(date));
