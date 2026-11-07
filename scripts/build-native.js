import {spawnSync} from 'node:child_process';
import {validateAppOrigin,productionAppOrigin} from '../shared/mobile.js';
const release=process.argv.includes('--release'),origin=validateAppOrigin(process.env.VITE_CHURP_API_ORIGIN||productionAppOrigin);
const result=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--mode','native'],{stdio:'inherit',env:{...process.env,VITE_CHURP_API_ORIGIN:origin,VITE_CHURP_APNS_ENV:release?'production':'development'}});process.exitCode=result.status??1;
