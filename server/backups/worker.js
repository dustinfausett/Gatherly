import {backupConfiguration} from './config.js';
import {r2Storage} from './storage.js';
import {runBackup} from './run.js';
const abort=new AbortController();process.on('SIGTERM',()=>abort.abort());process.on('disconnect',()=>abort.abort());
let storage;
try{const config=backupConfiguration();if(!config.enabled)throw new Error('Backups are disabled.');storage=r2Storage(config);const result=await runBackup({dataDir:process.env.DATA_DIR||'.data',config,storage,signal:abort.signal,progress:phase=>process.send?.({phase})});process.send?.({result});}catch{process.send?.({error:'Backup failed. Check R2 permissions, available disk space, source files and the original backup key.'});process.exitCode=1;}finally{storage?.close();process.disconnect?.();}
