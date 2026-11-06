import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {installLegal} from './legal.js';

export function installWebsite(app,{production,appUrl,explicitAppUrl}){
  installLegal(app,{appUrl});
  app.get(['/delete-account','/delete-account/'],(req,res)=>{
    const link=new URL('/?delete_account=1',appUrl).href;
    res.setHeader('Cache-Control','no-store');res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Delete your Churp account</title><link rel="stylesheet" href="/legal.css"></head><body><header><a href="/website/">Churp</a><a class="open-app" href="${link}">Open Churp</a></header><main id="main" class="enrollment"><article><h1>Delete your Churp account</h1><p>You can permanently delete your Churp account under Your corner → Account settings → Delete account.</p><p><a class="open-app" href="${link}">Sign in to delete your account</a></p><h2>What is removed</h2><p>Sign-in credentials, profile details, personal contacts and Birdhouses, private notes that are not retained for youth supervision, future scheduled sends, device access and unshared uploads are removed. Choose another existing member to take ownership of Trees with other members. A Tree where you are the only member closes.</p><h2>What remains</h2><p>Shared messages and attachments remain for their existing readers with the name Unknown and a crow profile image. Limited account identifiers and public signing keys remain so shared history can still be verified. Linked parents retain a deleted youth's existing supervised history until the existing age or family-link limit ends. Previously downloaded copies cannot be recalled. Protected backup copies may remain until their normal replacement or retention cycle.</p><h2>Cannot sign in?</h2><p>Request deletion by emailing <a href="mailto:churptree@gmail.com?subject=Churp%20account%20deletion%20request">churptree@gmail.com</a> with the subject Churp account deletion request and your Churp username. We will verify account ownership before acting. Do not email your password, encryption recovery key or private messages.</p><p><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></p></article></main></body></html>`);
  });
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
