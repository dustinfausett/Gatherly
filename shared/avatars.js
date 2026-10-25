// Public profile portraits are free and independent of the pet collection.
export const AVATARS = [
  ['blue','Bluebird'],['gold','Goldfinch'],['pink','Pink Blossom'],['lavender','Lavender'],
  ['mint','Mint'],['coral','Coral'],['cardinal','Cardinal'],['robin','Robin'],
  ['owl','Woodland Owl'],['snowy-owl','Snowy Owl'],['parrot','Parrot'],['cockatiel','Cockatiel'],
  ['hummingbird','Hummingbird'],['blue-jay','Blue Jay'],['dove','Dove'],['penguin','Penguin'],
  ['toucan','Toucan'],['lovebird','Lovebird'],['sparrow','Sparrow'],['budgie','Budgie'],
].map(([id,name],index)=>({id,name,row:Math.floor(index/4),column:index%4}));
export const getAvatar = id => AVATARS.find(a=>a.id===id);
