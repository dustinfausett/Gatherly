import {createServer} from 'node:http';
import {createApp} from './app.js';
import {prepareDeployment} from './deployment.js';
import {startBackups} from './backups/scheduler.js';
prepareDeployment();
const runtime=createApp(),{app}=runtime;
const backups=startBackups({dataDir:process.env.DATA_DIR||'.data'});app.locals.backups=backups;
const server=createServer(app),port=Number(process.env.PORT||3000);
server.listen(port,'0.0.0.0',()=>console.log(`Churp listening on port ${port}`));
function stop(){backups.close();server.closeAllConnections();server.close(()=>runtime.close());setTimeout(()=>process.exit(0),15000).unref();}
process.once('SIGTERM',stop);process.once('SIGINT',stop);
