export const usernameRules='Use 3–30 letters, numbers, or underscores for your username.';
export function normalizeUsername(value){
 if(typeof value!=='string')throw new Error(usernameRules);
 const username=value.trim().toLowerCase();
 if(!/^[a-z0-9_]{3,30}$/.test(username))throw new Error(usernameRules);
 return username;
}
