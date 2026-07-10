import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const root=path.resolve('.'),dataDir=path.join(root,'site','data'),checks=[],issues=[];
const check=(name,ok,detail='')=>{checks.push({name,ok,detail});if(!ok)issues.push({name,detail});};
const schemaFiles=['schemas/bundle-v1.schema.json','schemas/company-v1.schema.json','schemas/progress-v1.schema.json','schemas/quality-profile-v1.schema.json'];
for(const file of schemaFiles){try{JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));check(`${file} readable`,true);}catch(error){check(`${file} readable`,false,error.message);}}
const manifest=JSON.parse(fs.readFileSync(path.join(dataDir,'bundle.manifest.json'),'utf8'));
let data={companies:[],progress:[]};
try{data=JSON.parse(zlib.gunzipSync(Buffer.concat(manifest.parts.map(p=>fs.readFileSync(path.join(dataDir,p.file))))));check('bundle readable',true);}catch(error){check('bundle readable',false,error.message);}
const companies=data.companies||[],progress=data.progress||[],markets=new Set(['Prime','Standard','Growth']),stages=new Set(['core','detailed_extracted','source_indexed','jpx_indexed']);
const isoPartial=v=>v==null||v===''||/^\d{4}(-\d{2})?(-\d{2})?$/.test(v),isoDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'');
check('company count contract',companies.length===570,`actual=${companies.length}`);
check('company required fields',companies.every(c=>c.code&&c.name&&c.market&&c.industry&&c.stage&&c.tier&&c.lastVerifiedDate&&Array.isArray(c.themes)&&typeof c.summary==='string'&&c.quality&&c.flags));
check('company code contract',companies.every(c=>/^[0-9A-Z]{4}$/.test(String(c.code))));
check('company codes unique',new Set(companies.map(c=>String(c.code))).size===companies.length);
check('market enum contract',companies.every(c=>markets.has(c.market)));
check('stage enum contract',companies.every(c=>stages.has(c.stage)));
check('publication date contract',companies.every(c=>isoPartial(c.planPublishedDate)));
check('verification date contract',companies.every(c=>isoDay(c.lastVerifiedDate)));
check('legacy date forbidden',companies.every(c=>!Object.hasOwn(c,'date')));
check('themes string array',companies.every(c=>Array.isArray(c.themes)&&c.themes.every(x=>typeof x==='string')));
check('quality stars contract',companies.every(c=>Number.isInteger(c.quality?.stars)&&c.quality.stars>=1&&c.quality.stars<=5));
check('quality score contract',companies.every(c=>c.quality?.score==null||(typeof c.quality.score==='number'&&c.quality.score>=0&&c.quality.score<=100)));
check('quality reasons contract',companies.every(c=>Array.isArray(c.quality?.reasons)&&c.quality.reasons.every(x=>typeof x==='string')));
check('coverage score null',companies.filter(c=>c.stage==='jpx_indexed').every(c=>c.quality.score==null));
check('source-confirmed HTTPS',companies.filter(c=>c.stage!=='jpx_indexed').every(c=>typeof c.sourceUrl==='string'&&c.sourceUrl.startsWith('https://')));
check('coverage metrics absent',companies.filter(c=>c.stage==='jpx_indexed').every(c=>!c.revenue&&!c.profit&&!c.margin&&!c.capital&&!c.returnPolicy));
const companyCodes=new Set(companies.map(c=>String(c.code))),keys=new Set();let duplicate=0,orphan=0,badProgress=0;
for(const row of progress){if(!/^[0-9A-Z]{4}$/.test(String(row.code))||row.fiscalYear==null||typeof row.metric!=='string'||!row.metric)badProgress++;const key=`${row.code}|${row.fiscalYear}|${row.metric}`;if(keys.has(key))duplicate++;keys.add(key);if(!companyCodes.has(String(row.code)))orphan++;}
check('progress count contract',progress.length===149,`actual=${progress.length}`);
check('progress required fields',badProgress===0,`invalid=${badProgress}`);
check('progress key unique',duplicate===0,`duplicates=${duplicate}`);
check('progress company reference',orphan===0,`orphans=${orphan}`);
const forbidden=['おすすめ銘柄','買い推奨','勝率'];check('recommendation language forbidden',forbidden.every(term=>!JSON.stringify(data).includes(term)));
fs.mkdirSync('artifacts',{recursive:true});const report={version:'data-contract-v1',checkedAt:new Date().toISOString(),passed:checks.filter(c=>c.ok).length,total:checks.length,allPassed:issues.length===0,checks,issues};fs.writeFileSync('artifacts/data-contract-report-v1.json',JSON.stringify(report,null,2)+'\n');for(const c of checks)console.log(`${c.ok?'PASS':'FAIL'} ${c.name}${c.detail?`: ${c.detail}`:''}`);console.log(`\n${report.passed}/${report.total} checks passed`);process.exit(report.allPassed?0:1);
