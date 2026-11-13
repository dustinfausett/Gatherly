export const mobileAppId='com.churptree.app';
export const mobileScheme='com.churptree.app';
export const mobileOrigins=['capacitor://localhost','https://localhost'];
export const productionAppOrigin='https://app.churptree.com';
export function validateAppOrigin(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Native builds require a trusted HTTPS Churp API origin.');return url.origin;}
export function backendPath(path,origin=productionAppOrigin){if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||path.includes('\\'))throw new Error('Choose a relative Churp path.');const url=new URL(path,validateAppOrigin(origin));if(url.origin!==validateAppOrigin(origin))throw new Error('Invalid Churp path.');return url.href;}
export function nativeRoute(value,origin=productionAppOrigin){
 try{const url=new URL(value),custom=url.protocol===mobileScheme+':';if(custom){if(url.host!=='open')return null;}else if(url.origin!==validateAppOrigin(origin))return null;
  const params=new URLSearchParams(),invite=/^\/i\/([A-HJ-NP-Z2-9]{10})$/i.exec(url.pathname);if(invite)params.set('invite',invite[1].toUpperCase());
  else if(!custom&&url.pathname!=='/'&&url.pathname!=='/index.html')return null;
  for(const key of ['invite','community','group','conversation','delete_account','calendar_event','phone_texts','reset_password','verify_email']){const v=url.searchParams.get(key);if(v&&v.length<=300)params.set(key,v);}
  return '/'+(params.size?'?'+params:'');
 }catch{return null;}
}
export function nativeCallback(value){try{const url=new URL(value);if(url.protocol!==mobileScheme+':'||url.host!=='auth'||url.pathname!=='/callback')return null;const code=url.searchParams.get('code'),state=url.searchParams.get('state'),error=url.searchParams.get('error');if(!/^[A-Za-z0-9_-]{43}$/.test(state||''))return null;if(error==='cancelled')return {state,error};return /^[A-Za-z0-9_-]{43}$/.test(code||'')?{code,state}:null;}catch{return null;}}
