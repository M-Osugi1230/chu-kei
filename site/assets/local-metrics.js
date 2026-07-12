const KEY='chukei.localMetrics.v1';
const SESSION_GAP=30*60*1000;
const now=()=>new Date().toISOString();
const empty=()=>({version:'local-metrics-v1',firstSeenAt:now(),lastSeenAt:now(),sessionStartedAt:now(),sessions:1,pageViews:{},events:{}});
function load(){try{const value=JSON.parse(localStorage.getItem(KEY)||'null');return value&&value.version==='local-metrics-v1'?value:empty()}catch{return empty()}}
function save(value){value.lastSeenAt=now();try{localStorage.setItem(KEY,JSON.stringify(value));window.dispatchEvent(new CustomEvent('chukei:metrics-updated',{detail:value}))}catch{}}
let data=load();const previous=Date.parse(data.lastSeenAt||0);if(!Number.isFinite(previous)||Date.now()-previous>SESSION_GAP){data.sessions=(data.sessions||0)+1;data.sessionStartedAt=now()}
function count(name,meta={}){data.events[name]=(data.events[name]||0)+1;data.lastEvent={name,at:now(),meta};save(data)}
const page=location.pathname.split('/').pop()||'index.html';data.pageViews[page]=(data.pageViews[page]||0)+1;count('page_view',{page});
let searchTimer;document.addEventListener('input',event=>{if(event.target?.id==='search'||event.target?.id==='queue-search'){clearTimeout(searchTimer);searchTimer=setTimeout(()=>{const value=event.target.value.trim();if(value)count('search',{length:value.length,page})},800)}});
document.addEventListener('click',event=>{const target=event.target.closest('button,a');if(!target)return;if(target.matches('[data-detail]'))count('company_detail_open',{code:target.dataset.detail});else if(target.matches('[data-save],[data-save-detail]'))count('save_toggle');else if(target.matches('[data-compare]'))count('compare_toggle');else if(target.matches('#open-compare,#compare-saved'))count('comparison_open');else if(target.matches('[id*="share"],[data-share-company],[data-share-compare-dialog]'))count('share');else if(target.matches('a[target="_blank"][href^="http"]'))count('official_source_open');else if(target.matches('a[href*="reports.html"]'))count('spot_report_interest');else if(target.matches('a[href*="pricing.html"]'))count('pricing_interest')});
document.addEventListener('submit',event=>count('form_submit',{name:event.target.getAttribute('name')||event.target.id||'form'}));
window.ChukeiLocalMetrics={key:KEY,read:()=>load(),track:count,reset:()=>{const next=empty();localStorage.setItem(KEY,JSON.stringify(next));return next}};
