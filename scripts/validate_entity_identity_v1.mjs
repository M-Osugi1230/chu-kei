import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT=path.resolve('.'),DATA=path.join(ROOT,'site','data'),ART=path.join(ROOT,'artifacts'),checks=[],issues=[],warnings=[];
const check=(name,ok,detail='')=>{checks.push({name,ok,detail});if(!ok)issues.push({name,detail});};
const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/株式会社|（株）|\(株\)|㈱/g,'').replace(/[\s\u3000・･.．,，\-ー―]/g,'').trim();
function bundle(){const m=JSON.parse(fs.readFileSync(path.join(DATA,'bundle.manifest.json'),'utf8'));const b=Buffer.concat(m.parts.map(p=>fs.readFileSync(path.join(DATA,p.file))));if(crypto.createHash('sha256').update(b).digest('hex')!==m.sha256)throw Error('bundle hash mismatch');return JSON.parse(zlib.gunzipSync(b));}
let data={companies:[]};try{data=bundle();check('company bundle readable',true)}catch(e){check('company bundle readable',false,e.message)}
let aliases=[];try{aliases=JSON.parse(fs.readFileSync(path.join(ROOT,'operations','entities','aliases.json'),'utf8'));check('alias registry readable',Array.isArray(aliases))}catch(e){check('alias registry readable',false,e.message)}
const companies=data.companies||[],codes=companies.map(c=>String(c.code));
check('company count 570',companies.length===570,`actual=${companies.length}`);
check('security codes unique',new Set(codes).size===codes.length);
check('company names present',companies.every(c=>typeof c.name==='string'&&c.name.trim()));
const normalizedGroups=new Map();for(const c of companies){const key=normalize(c.name);if(!normalizedGroups.has(key))normalizedGroups.set(key,[]);normalizedGroups.get(key).push({code:c.code,name:c.name,market:c.market});}
const duplicateNames=[...normalizedGroups.entries()].filter(([,rows])=>rows.length>1);
for(const [key,rows] of duplicateNames)warnings.push({type:'normalized_name_collision',key,records:rows});
const exactGroups=new Map();for(const c of companies){if(!exactGroups.has(c.name))exactGroups.set(c.name,[]);exactGroups.get(c.name).push(c.code)}
const exactDuplicates=[...exactGroups.entries()].filter(([,rows])=>rows.length>1);
check('exact company names unique',exactDuplicates.length===0,JSON.stringify(exactDuplicates));
const aliasKeys=new Set();let invalidAlias=0,orphanAlias=0,duplicateAlias=0;
for(const a of aliases){const valid=/^[0-9A-Z]{4}$/.test(a.canonicalCode||'')&&typeof a.alias==='string'&&a.alias.trim()&&['former_name','abbreviation','english_name','spacing_variant','legal_suffix_variant','other'].includes(a.aliasType)&&typeof a.source==='string'&&a.source.startsWith('https://')&&/^\d{4}-\d{2}-\d{2}$/.test(a.verifiedAt||'');if(!valid)invalidAlias++;if(!codes.includes(String(a.canonicalCode)))orphanAlias++;const key=`${a.canonicalCode}|${normalize(a.alias)}`;if(aliasKeys.has(key))duplicateAlias++;aliasKeys.add(key);}
check('alias records valid',invalidAlias===0,`invalid=${invalidAlias}`);check('alias codes reference companies',orphanAlias===0,`orphans=${orphanAlias}`);check('alias records unique',duplicateAlias===0,`duplicates=${duplicateAlias}`);
for(const a of aliases){const collision=companies.filter(c=>c.code!==a.canonicalCode&&normalize(c.name)===normalize(a.alias));if(collision.length)warnings.push({type:'alias_collides_with_other_company',alias:a,records:collision.map(c=>({code:c.code,name:c.name}))});}
const report={version:'entity-identity-audit-v1',checkedAt:new Date().toISOString(),summary:{companies:companies.length,aliases:aliases.length,normalizedNameCollisions:duplicateNames.length,warnings:warnings.length,issues:issues.length},checks,warnings,issues};fs.mkdirSync(ART,{recursive:true});fs.writeFileSync(path.join(ART,'entity-identity-report-v1.json'),JSON.stringify(report,null,2)+'\n');for(const c of checks)console.log(`${c.ok?'PASS':'FAIL'} ${c.name}${c.detail?`: ${c.detail}`:''}`);console.log(`Warnings: ${warnings.length}`);process.exit(issues.length?1:0);
