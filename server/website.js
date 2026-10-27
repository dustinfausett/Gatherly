import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {installLegal} from './legal.js';

export function installWebsite(app,{production,appUrl,explicitAppUrl}){
  installLegal(app,{appUrl});
  // Public on both domains; membership and expiry are checked after sign-in.
  // No DB lookup here: the website and app can be deployed as separate services.
  app.get('/i/:code',(req,res)=>{
    if(!/^[A-HJ-NP-Z2-9]{10}$/i.test(req.params.code))return res.status(404).send('Invitation not found.');
    res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer'});
    res.redirect(302,new URL(`/?invite=${req.params.code.toUpperCase()}`,appUrl).href);
  });
  const publicHost=req=>['churptree.com','www.churptree.com'].includes(req.hostname.toLowerCase());
  // The existing Railway address stays an app origin. A domain change must not
  // strand local encryption keys or replace the established sign-in page.
  app.get('/api/site-config',(req,res)=>{
    const origin=explicitAppUrl ? new URL(appUrl).origin : publicHost(req) ? 'https://app.churptree.com' : `${req.protocol}://${req.get('host')}`;
    res.json({appUrl:`${origin}/`,signupUrl:`${origin}/?signup=1`});
  });
  app.get('/robots.txt',(req,res)=>res.type('text/plain').send(`User-agent: *\n${publicHost(req) ? 'Allow: /' : 'Disallow: /\nAllow: /website/'}\nDisallow: /api/\nSitemap: https://churptree.com/sitemap.xml\n`));
  app.get('/sitemap.xml',(req,res)=>res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://churptree.com/</loc></url></urlset>'));
  const entry=resolve('dist/website/index.html');
  if(production && existsSync(entry))app.get(['/','/website','/website/','/website/index.html'],(req,res,next)=>{
    if(req.path==='/' && !publicHost(req))return next();
    res.setHeader('Cache-Control','no-store');res.sendFile(entry);
  });
  else app.get('/website',(req,res,next)=>req.path==='/website' ? res.redirect(302,'/website/') : next());
}
