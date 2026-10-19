import { createServer } from 'node:http';
import { createApp } from './app.js';
import { prepareDeployment } from './deployment.js';
prepareDeployment();
const { app } = createApp();
const port = Number(process.env.PORT || 3000);
createServer(app).listen(port, '0.0.0.0', () => console.log(`Gatherly listening on port ${port}`));
