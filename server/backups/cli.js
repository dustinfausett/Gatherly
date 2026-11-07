import {readFile,writeFile,rm,mkdtemp,chmod,lstat,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {backupConfiguration} from './config.js';
import {r2Storage} from './storage.js';
import {runBackup,isBackupObject} from './run.js';
import {verifyBackup,restoreBackup,encryptionKey,sha256} from './archive.js';
const args=process.argv.slice(2),command=args.shift();
function option(name){const i=args.indexOf(name);return i>=0?args[i+1]:undefined;}
let storage,root;
try{
 if(command==='generate-key'){
  const target=option('--out');if(!target)throw new Error('Use generate-key --out /secure/path/churp-backup.key.');const {randomBytes}=await import('node:crypto');await writeFile(target,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});console.log('Backup encryption key written. Store this file in a password manager or another safe location separate from Railway and R2.');
 }else if(command==='run'){
  const config=backupConfiguration();if(!config.enabled)throw new Error('Configure R2 and enable backups before running.');storage=r2Storage(config);const result=await runBackup({dataDir:resolve(process.env.DATA_DIR||'.data'),config,storage});console.log(JSON.stringify(result,null,2));
 }else if(command==='verify'||command==='restore'){
  const keyFile=option('--key-file'),key=keyFile?(await readFile(keyFile,'utf8')).trim():process.env.CHURP_BACKUP_ENCRYPTION_KEY;encryptionKey(key);
  let file=option('--file');const object=option('--object');if(!!file===!!object)throw new Error('Choose --file /path/backup.churpbackup or --object an-exact-R2-object-key.');
  if(object){const config=backupConfiguration({...process.env,CHURP_BACKUP_ENABLED:'true',CHURP_BACKUP_ENCRYPTION_KEY:key});if(!isBackupObject(object,config.prefix))throw new Error('Configure R2 and choose an exact backup object in the configured prefix.');storage=r2Storage(config);root=await mkdtemp(join(tmpdir(),'churp-backup-download-'));await chmod(root,0o700);file=join(root,'download.churpbackup');let head;try{await storage.download(object,file);head=await storage.head(object);}catch{throw new Error('Could not download the selected R2 backup. Check bucket-scoped credentials and the exact object key.');}if(await sha256(file)!==head.sha256)throw new Error('The remote archive checksum did not match.');}
  if(command==='verify'){const result=await verifyBackup({file,key});console.log(JSON.stringify({verified:true,backup_id:result.manifest.id,created_at:result.manifest.created_at,files:result.files,users:result.users},null,2));}
  else{const target=option('--to');if(!target)throw new Error('Choose --to /new/nonexistent/restore-folder.');console.log(JSON.stringify(await restoreBackup({file,key,target}),null,2));console.log('Restore is isolated. Complete the restore review before using this folder in production.');}
 }else if(command==='acknowledge-restore'){
  const target=option('--data-dir');if(!target||!args.includes('--reviewed-deletions-and-permissions'))throw new Error('After reconciling later deletions, blocks and permissions, use acknowledge-restore --data-dir /restored/folder --reviewed-deletions-and-permissions.');
  const marker=join(resolve(target),'restore-review-required.json');await lstat(marker);const db=new DatabaseSync(join(resolve(target),'gatherly.sqlite'),{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Restore integrity checks failed.');}finally{db.close();}
  await rename(marker,join(resolve(target),'restore-reviewed.json'));console.log('Restore review recorded. Saved sessions remain revoked and scheduled sends remain held.');
 }else throw new Error('Commands: generate-key, run, verify, restore, acknowledge-restore. Read docs/BACKUPS.md before restoring.');
}catch(error){console.error(command==='run'?'Backup did not complete. Check configuration, R2 access, source integrity and disk space.':error.message);process.exitCode=1;}finally{storage?.close();if(root)await rm(root,{recursive:true,force:true});}
