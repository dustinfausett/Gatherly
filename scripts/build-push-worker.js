import {chmodSync} from 'node:fs';
import {build} from 'esbuild';
export async function buildPushWorker(){await build({entryPoints:['src/push-preview-worker.js'],outfile:'public/push-preview.js',bundle:true,minify:true,format:'iife',platform:'browser',target:['es2022'],legalComments:'none'});chmodSync('public/push-preview.js',0o644);}
await buildPushWorker();
