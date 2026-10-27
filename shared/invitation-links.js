export function invitationOrigin(appUrl){const url=new URL(appUrl);return url.hostname==='app.churptree.com'?'https://churptree.com':url.origin;}
export function shortInvitationUrl(appUrl,code){return new URL(`/i/${code.replaceAll('-','')}`,invitationOrigin(appUrl)).href;}
export function invitationValue(value,appUrl){
 try{const url=new URL(value);if([new URL(appUrl).origin,invitationOrigin(appUrl)].includes(url.origin)&&/^\/i\/[A-HJ-NP-Z2-9]{10}\/?$/i.test(url.pathname))return url.pathname.split('/')[2].toUpperCase();return url.searchParams.get('invite')||value;}catch{return value;}
}
