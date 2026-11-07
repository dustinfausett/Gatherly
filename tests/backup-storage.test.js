import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {r2Storage} from '../server/backups/storage.js';

test('the real S3 adapter signs multipart uploads, verifies metadata, downloads data and paginates private R2 objects',async t=>{
 const objects=new Map(),pending=new Map();let signed=0,multipart=0,pages=0;
 const server=createServer(async(req,res)=>{
  try{
   assert.ok(req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 '));signed++;const url=new URL(req.url,'http://local'),key=decodeURIComponent(url.pathname.replace(/^\/test-bucket\/?/,'')),chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks),metadata=Object.fromEntries(Object.entries(req.headers).filter(([name])=>name.startsWith('x-amz-meta-')).map(([name,v])=>[name.slice(11),v]));
   res.setHeader('content-type','application/xml');
   if(req.method==='POST'&&url.searchParams.has('uploads')){multipart++;pending.set('upload-1',{key,parts:new Map(),metadata});res.end('<InitiateMultipartUploadResult><Bucket>test-bucket</Bucket><Key>'+key+'</Key><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>');}
   else if(req.method==='PUT'&&url.searchParams.has('partNumber')){pending.get('upload-1').parts.set(Number(url.searchParams.get('partNumber')),body);res.setHeader('etag','"part-'+url.searchParams.get('partNumber')+'"');res.end();}
   else if(req.method==='POST'&&url.searchParams.has('uploadId')){const p=pending.get('upload-1');objects.set(key,{body:Buffer.concat([...p.parts].sort((a,b)=>a[0]-b[0]).map(r=>r[1])),metadata:p.metadata});pending.delete('upload-1');res.end('<CompleteMultipartUploadResult><Bucket>test-bucket</Bucket><Key>'+key+'</Key><ETag>"complete"</ETag></CompleteMultipartUploadResult>');}
   else if(req.method==='PUT'){objects.set(key,{body,metadata});res.setHeader('etag','"small"');res.end();}
   else if(req.method==='HEAD'){const o=objects.get(key);if(!o){res.statusCode=404;return res.end();}res.setHeader('content-length',o.body.length);for(const [k,v] of Object.entries(o.metadata))res.setHeader('x-amz-meta-'+k,v);res.end();}
   else if(req.method==='GET'&&url.searchParams.has('list-type')){pages++;const offset=Number(url.searchParams.get('continuation-token')||0),all=[...objects.keys()].filter(k=>k.startsWith(url.searchParams.get('prefix')||'')),slice=all.slice(offset,offset+2),more=all.length>offset+2;res.end('<ListBucketResult><IsTruncated>'+more+'</IsTruncated>'+(more?'<NextContinuationToken>'+(offset+2)+'</NextContinuationToken>':'')+slice.map(k=>'<Contents><Key>'+k+'</Key><LastModified>2026-11-06T09:00:00Z</LastModified><Size>'+objects.get(k).body.length+'</Size></Contents>').join('')+'</ListBucketResult>');}
   else if(req.method==='GET'){res.setHeader('content-type','application/octet-stream');res.end(objects.get(key).body);}
   else if(req.method==='DELETE'){objects.delete(key);res.statusCode=204;res.end();}
   else{res.statusCode=400;res.end();}
  }catch(error){res.statusCode=500;res.end('<Error><Code>InternalError</Code></Error>');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const root=await mkdtemp(join(tmpdir(),'churp-storage-test-')),store=r2Storage({endpoint:`http://127.0.0.1:${server.address().port}`,bucket:'test-bucket',prefix:'backups/',accessKeyId:'fixture-access',secretAccessKey:'fixture-secret'});t.after(async()=>{store.close();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
 const bytes=randomBytes(9*1024*1024),source=join(root,'upload'),target=join(root,'download');await writeFile(source,bytes);await store.upload('backups/large.churpbackup',source,'fixture-checksum');assert.equal(multipart,1);assert.equal(pending.size,0);assert.deepEqual(await store.head('backups/large.churpbackup'),{bytes:bytes.length,sha256:'fixture-checksum'});await store.download('backups/large.churpbackup',target);assert.deepEqual(await readFile(target),bytes);
 await store.markVerified('backups/large.churpbackup',{verified_at:Date.now()});await store.markVerified('backups/another.churpbackup',{verified_at:Date.now()});assert.equal((await store.list()).length,3);assert.ok(pages>=2);await store.remove('backups/large.churpbackup');assert.ok(!objects.has('backups/large.churpbackup'));assert.ok(signed>=10);
});
