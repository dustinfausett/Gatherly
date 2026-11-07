import {fork} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {backupConfiguration,backupDue} from './config.js';
export function startBackups({dataDir,env=process.env,now=Date.now,launch=options=>fork(fileURLToPath(new URL('./worker.js',import.meta.url)),[],options),onChange=()=>{},autoProcess=true}){
 const statusFile=join(dataDir,'backup-status.json');let saved={};try{if(existsSync(statusFile))saved=JSON.parse(readFileSync(statusFile,'utf8'));}catch{saved={last_error:'The saved backup status was unreadable. A fresh backup is needed.'};}
 let config,setupError;try{config=backupConfiguration(env);}catch{config={enabled:false};setupError='Backup setup is incomplete or invalid. Check the R2 and backup encryption settings.';}
 let state={...saved,running:false,phase:'idle',setup_error:setupError||null};if(saved.running){state.last_error='A backup was interrupted; previous backups were retained.';state.next_retry_at=now()+60000;}
 let child,timer,deadline,closed=false;
 function persist(){try{const temp=statusFile+'.tmp';writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});renameSync(temp,statusFile);}catch{state.last_error='Backup status could not be saved. Check free space and volume permissions.';}try{onChange();}catch{}}
 function snapshot(){return {enabled:config.enabled,configured:config.enabled,schedule:config.enabled?{hour:config.hour,time_zone:config.timeZone,retention_days:config.retentionDays}:null,...state,overdue:!!config.enabled&&(!state.last_verified_at||now()-state.last_verified_at>36*3600000)};}
 const phases=new Set(['snapshot','uploads','encrypting','validating','uploading','verifying_download','retention']);
 function run(){
  if(closed||!config.enabled)throw new Error('Backups are not configured.');if(child)throw new Error('A backup is already running.');
  state={...state,running:true,phase:'snapshot',last_attempt_at:now(),last_error:null};persist();let success=false;
  try{child=launch({env:{...env,DATA_DIR:dataDir},stdio:['ignore','ignore','ignore','ipc']});}catch{state={...state,running:false,phase:'idle',last_error:'The backup worker could not start.',next_retry_at:now()+15*60000};persist();throw new Error('The backup worker could not start.');}
  const running=child;
  running.on('message',message=>{if(closed||child!==running)return;if(phases.has(message?.phase)){state.phase=message.phase;persist();}else if(message?.result){const r=message.result;success=true;state={...state,last_verified_at:r.verified_at,last_object:r.object,last_bytes:r.bytes,last_sha256:r.sha256,last_files:r.files,last_error:null,retention_warning:!!r.retention_warning,next_retry_at:null};persist();}else if(message?.error){state.last_error='Backup failed. Check R2 access, disk space, source files and the original backup key.';persist();}});
  const finished=()=>{if(child!==running)return;clearTimeout(deadline);child=null;state.running=false;state.phase='idle';if(!success){state.last_error||='The backup worker stopped before verification completed.';state.next_retry_at=now()+15*60000;}if(!closed)persist();};running.once('exit',finished);running.once('error',finished);
  deadline=setTimeout(()=>{if(child===running){state.last_error='Backup timed out; previous backups were retained.';running.kill('SIGTERM');setTimeout(()=>{if(child===running)running.kill('SIGKILL');},15000).unref();}},2*3600000);deadline.unref();return snapshot();
 }
 function tick(){if(backupDue(config,state,now()))try{run();}catch{}}
 if(autoProcess){timer=setInterval(tick,60000);timer.unref();queueMicrotask(tick);}
 return {snapshot,run,tick,close(){closed=true;clearInterval(timer);clearTimeout(deadline);child?.kill('SIGTERM');}};
}
