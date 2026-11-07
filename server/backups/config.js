import {encryptionKey} from './archive.js';
export function backupConfiguration(env=process.env){
 const enabled=env.CHURP_BACKUP_ENABLED==='true';
 if(!enabled)return {enabled:false};
 const required=['CHURP_BACKUP_ENDPOINT','CHURP_BACKUP_BUCKET','CHURP_BACKUP_ACCESS_KEY_ID','CHURP_BACKUP_SECRET_ACCESS_KEY','CHURP_BACKUP_ENCRYPTION_KEY'];
 if(required.some(name=>!env[name]?.trim()))throw new Error('Backup setup is incomplete. Supply the R2 endpoint, bucket, access keys and separate backup encryption key.');
 const endpoint=new URL(env.CHURP_BACKUP_ENDPOINT);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/'||! /^[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/i.test(endpoint.hostname))throw new Error('Use your Cloudflare R2 S3 API HTTPS endpoint.');
 if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.CHURP_BACKUP_BUCKET))throw new Error('Supply a valid private R2 bucket name.');
 encryptionKey(env.CHURP_BACKUP_ENCRYPTION_KEY);
 const hour=Number(env.CHURP_BACKUP_HOUR??2),retentionDays=Number(env.CHURP_BACKUP_RETENTION_DAYS??30),timeZone=env.CHURP_BACKUP_TIME_ZONE||'America/Denver',prefix=env.CHURP_BACKUP_PREFIX||'churp-backups/v1/';
 if(!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(retentionDays)||retentionDays<7||retentionDays>3650)throw new Error('Choose backup hour 0–23 and retention 7–3650 days.');
 if(!/^(?:[A-Za-z0-9_-]+\/){1,5}$/.test(prefix))throw new Error('Use a dedicated backup prefix with a trailing slash.');
 try{new Intl.DateTimeFormat('en-US',{timeZone}).format();}catch{throw new Error('Choose a valid backup time zone.');}
 return {enabled:true,endpoint:endpoint.origin,bucket:env.CHURP_BACKUP_BUCKET,accessKeyId:env.CHURP_BACKUP_ACCESS_KEY_ID,secretAccessKey:env.CHURP_BACKUP_SECRET_ACCESS_KEY,key:env.CHURP_BACKUP_ENCRYPTION_KEY,hour,retentionDays,timeZone,prefix};
}
export function localParts(now,timeZone){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));return {date:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour)};}
export function backupDue(config,status,now=Date.now()){
 if(!config.enabled||status.running||status.next_retry_at>now)return false;
 if(!status.last_verified_at)return true;
 const current=localParts(now,config.timeZone),last=localParts(status.last_verified_at,config.timeZone);
 return current.date>last.date&&current.hour>=config.hour;
}
