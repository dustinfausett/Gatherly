import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app.js';
const { app } = createApp({ testing: process.env.NODE_ENV === 'test', encryptionRequired: !(process.env.NODE_ENV === 'test' && process.env.E2EE_TEST_LEGACY === '1') });
const server = createServer(app);
const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
// Browser fixtures must keep their page state when Vite re-optimizes a dependency.
// Keep the socket on this server (rather than a shared default HMR port), but
// suppress code-triggered reloads in tests. Application refresh still uses SSE.
if(process.env.NODE_ENV==='test'){
  const hot=vite.environments.client.hot,send=hot.send.bind(hot);
  hot.send=(message,...args)=>{if(message?.type==='full-reload'||message?.type==='update')return;return send(message,...args);};
}
app.use(vite.middlewares);
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Gatherly development server running'));
const close = async () => { await vite.close(); server.close(); process.exit(0); };
process.on('SIGTERM', close);
process.on('SIGINT', close);
