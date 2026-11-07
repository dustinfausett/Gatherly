import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,ListObjectsV2Command,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {Upload} from '@aws-sdk/lib-storage';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {stat} from 'node:fs/promises';
export function r2Storage(config){
 const client=new S3Client({endpoint:config.endpoint,region:'auto',forcePathStyle:true,credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',maxAttempts:3});
 return {
  async upload(key,file,checksum,signal){const size=(await stat(file)).size,upload=new Upload({client,queueSize:2,partSize:8*1024*1024,leavePartsOnError:false,params:{Bucket:config.bucket,Key:key,Body:createReadStream(file),ContentLength:size,ContentType:'application/octet-stream',Metadata:{'churp-backup-format':'1',sha256:checksum}}});const abort=()=>upload.abort();signal?.addEventListener('abort',abort,{once:true});try{signal?.throwIfAborted();await upload.done();}finally{signal?.removeEventListener('abort',abort);}},
  async markVerified(key,value,signal){await client.send(new PutObjectCommand({Bucket:config.bucket,Key:key+'.verified.json',Body:JSON.stringify(value),ContentType:'application/json'}),{abortSignal:signal});},
  async head(key,signal){const r=await client.send(new HeadObjectCommand({Bucket:config.bucket,Key:key}),{abortSignal:signal});return {bytes:r.ContentLength,sha256:r.Metadata?.sha256};},
  async download(key,file,signal){const r=await client.send(new GetObjectCommand({Bucket:config.bucket,Key:key}),{abortSignal:signal});await pipeline(r.Body,createWriteStream(file,{flags:'wx',mode:0o600}),{signal});},
  async list(signal){const rows=[];let token;do{const r=await client.send(new ListObjectsV2Command({Bucket:config.bucket,Prefix:config.prefix,ContinuationToken:token}),{abortSignal:signal});rows.push(...(r.Contents||[]).map(o=>({key:o.Key,modified:o.LastModified?.getTime()||0})));token=r.IsTruncated?r.NextContinuationToken:undefined;if(r.IsTruncated&&!token)throw new Error('R2 pagination did not complete.');}while(token);return rows;},
  async remove(key,signal){await client.send(new DeleteObjectCommand({Bucket:config.bucket,Key:key}),{abortSignal:signal});},
  close(){client.destroy();},
 };
}
