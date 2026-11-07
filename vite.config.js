import {defineConfig,searchForWorkspaceRoot} from 'vite';
import {realpathSync} from 'node:fs';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>({plugins:[react()],server:{host:'0.0.0.0',fs:{allow:[searchForWorkspaceRoot(process.cwd()),realpathSync('node_modules')]}},build:{outDir:mode==='native'?'native-dist':'dist',rollupOptions:{input:mode==='native'?{app:'index.html'}:{app:'index.html',website:'website/index.html'}}}}));
