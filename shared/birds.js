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
];
export const getBird = id => BIRDS.find(b => b.id === id);
