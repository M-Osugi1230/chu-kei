import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT=path.resolve('.'),SITE=path.join(ROOT,'site'),OUT=path.join(ROOT,'artifacts','release-manifest-v1.json');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const full=path.join(dir,entry.name);return entry.isDirectory()?walk(full):[full];});}
const bundle=JSON.parse(fs.readFileSync(path.join(SITE,'data','bundle.manifest.json'),'utf8'));
const files=walk(SITE).sort().map(full=>({path:path.relative(SITE,full).replaceAll(path.sep,'/'),bytes:fs.statSync(full).size,sha256:hash(full)}));
const shellFiles=files.filter(file=>!file.path.startsWith('data/bundle.gz.part'));
const manifest={
  schemaVersion:'1.0',
  product:'Chu-kei',
  releaseVersion:bundle.version,
  generatedAt:new Date().toISOString(),
  publishDirectory:'site',
  companyCount:bundle.companyCount,
  progressCount:bundle.progressCount,
  dataBundle:{sha256:bundle.sha256,compressedBytes:bundle.compressedBytes,uncompressedBytes:bundle.uncompressedBytes,parts:bundle.parts.length},
  summary:{files:files.length,totalBytes:files.reduce((n,f)=>n+f.bytes,0),shellBytes:shellFiles.reduce((n,f)=>n+f.bytes,0)},
  files
};
fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest.summary,null,2));
