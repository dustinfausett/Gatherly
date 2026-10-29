import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer,request as httpRequest } from 'node:http';
import { createApp } from '../server/app.js';

test('public website and app share a service without moving the existing app origin',async t=>{
  if(!existsSync(resolve('dist/website/index.html')))return t.skip('Build the production website first with npm run build.');
  const dir=mkdtempSync(join(tmpdir(),'churp-website-'));
  const runtime=createApp({production:true,testing:true,dataDir:dir,appUrl:'https://app.churptree.com',googleClientId:'',pushEnabled:false});
  const server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const get=(path,host)=>new Promise((resolve,reject)=>{httpRequest(base+path,{headers:{host}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:new Headers(res.headers),text:async()=>body,json:async()=>JSON.parse(body)}));}).on('error',reject).end();});
  try{
    for(const host of ['churptree.com','www.churptree.com']){
      const redirect=await get('/i/ABCDE23456',host);assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'https://app.churptree.com/?invite=ABCDE23456');assert.equal(redirect.headers.get('cache-control'),'no-store');assert.equal((await get('/i/invalid',host)).status,404);
      const home=await get('/',host),html=await home.text();assert.equal(home.status,200);assert.match(html,/id="hero-heading"/);assert.match(html,/rel="canonical" href="https:\/\/churptree.com\//);assert.match(home.headers.get('content-security-policy'),/script-src/);
      const settings=await get('/api/site-config',host);assert.equal(settings.status,200);assert.deepEqual(await settings.json(),{appUrl:'https://app.churptree.com/',signupUrl:'https://app.churptree.com/?signup=1'});
      assert.equal((await get('/api/me',host)).status,401);
      for(const [path,title] of [['/terms','Terms of Service'],['/privacy','Privacy Policy'],['/sms-terms','Phone Texting']]){
        const policy=await get(path,host),page=await policy.text();assert.equal(policy.status,200);assert.match(page,new RegExp(`<h1>${title}</h1>`));assert.equal(page.includes('Draft for review'),false);assert.equal(policy.headers.get('x-robots-tag'),null);assert.match(page,/Dustin Fausett, operating as Churp/);assert.match(page,/mailto:churptree@gmail.com/);assert.doesNotMatch(page,/dustin\.fausett/);assert.match(policy.headers.get('content-security-policy'),/script-src/);
      }

    }
    for(const host of ['app.churptree.com','original.up.railway.app','churptree.com.other.example']){
      const app=await get('/',host);assert.match(await app.text(),/id="root"/);
      assert.match(await (await get('/privacy',host)).text(),/<h1>Privacy Policy<\/h1>/);
      const preview=await get('/website/',host);assert.equal(preview.status,200);assert.match(await preview.text(),/id="hero-heading"/);
    }
    assert.match(await (await get('/robots.txt','churptree.com')).text(),/Disallow: \/api\//);
    assert.match(await (await get('/robots.txt','app.churptree.com')).text(),/Disallow: \/\n/);
    assert.match(await (await get('/sitemap.xml','churptree.com')).text(),/<loc>https:\/\/churptree.com\/<\/loc>/);
  }finally{runtime.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
