export const REACTION_LIMIT=5;
export const REACTION_EMOJIS=[
 ['👍','Thumbs up'],['❤️','Heart'],['😂','Laughing'],['😊','Smile'],['😍','Love it'],['🥰','Loved'],['😁','Grinning'],['😄','Happy'],['😎','Cool'],['🤔','Thinking'],['😮','Surprised'],['😢','Sad'],['😭','Crying'],['😅','Relieved'],['😬','Awkward'],['🙄','Eye roll'],['🤗','Hug'],['🥹','Touched'],['😴','Sleepy'],['😇','Angel'],
 ['👏','Applause'],['🙌','Celebrate'],['🙏','Praying thanks'],['👋','Wave'],['👌','OK'],['🤞','Fingers crossed'],['💪','Strong'],['🤝','Handshake'],['🫶','Heart hands'],['👀','Looking'],['💯','Hundred'],['✅','Check'],['🎉','Party'],['🎊','Confetti'],['✨','Sparkles'],['🌟','Star'],['🔥','Fire'],['💡','Idea'],['🎂','Birthday'],['🎁','Gift'],
 ['💛','Gold heart'],['💙','Blue heart'],['💚','Green heart'],['💜','Purple heart'],['🩷','Pink heart'],['🤍','White heart'],['🧡','Orange heart'],['💔','Broken heart'],['💕','Hearts'],['💐','Flowers'],['🌻','Sunflower'],['🌷','Tulip'],['🌈','Rainbow'],['☀️','Sunshine'],['🌧️','Rain'],['❄️','Snow'],['🍀','Good luck'],['🌿','Leaves'],['🌳','Tree'],['🪺','Nest'],
 ['🐦','Bird'],['🐤','Chick'],['🐣','Hatching chick'],['🦜','Parrot'],['🦉','Owl'],['🕊️','Dove'],['🥚','Egg'],['🎄','Christmas'],['🎃','Halloween'],['🦃','Thanksgiving'],['🍰','Cake'],['☕','Coffee'],['🍕','Pizza'],['🏆','Trophy'],['🎵','Music'],['📚','Books'],['📅','Calendar'],['⏰','Reminder'],['🚀','Rocket'],['🎯','Target'],
].map(([emoji,label])=>({emoji,label}));
export const QUICK_REACTIONS=REACTION_EMOJIS.slice(0,3);
const key=emoji=>emoji.normalize('NFC').replace(/\uFE0F/g,'');
export function normalizeReaction(emoji){
 if(typeof emoji!=='string'||emoji.length>24)throw new Error('Choose an emoji from the reaction picker.');
 const found=REACTION_EMOJIS.find(item=>key(item.emoji)===key(emoji));
 if(!found)throw new Error('Choose an emoji from the reaction picker.');return found.emoji;
}
export function validateReactions(emojis){
 if(!Array.isArray(emojis)||emojis.length>REACTION_LIMIT)throw new Error('Choose up to five different reactions.');
 const normalized=emojis.map(normalizeReaction);
 if(new Set(normalized).size!==normalized.length)throw new Error('Each emoji can appear only once per person.');
 return normalized;
}
export function toggleReaction(emojis,emoji){
 const current=validateReactions(emojis),choice=normalizeReaction(emoji);
 return current.includes(choice)?current.filter(value=>value!==choice):[...current,choice].slice(-REACTION_LIMIT);
}
export const reactionProof=({channel,messageId,userId,expectedVersion,clientId,rosterHash,reactionCount,cipherHash})=>({channel,messageId,userId,expectedVersion,clientId,rosterHash,reactionCount,cipherHash});
