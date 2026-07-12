const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const eventLabels={target_set:'目標設定',target_raised:'目標引き上げ',target_lowered:'目標引き下げ',forecast_updated:'見通し更新',actual_reported:'実績',period_extended:'期間延長',metric_changed:'指標変更',plan_withdrawn:'計画撤回'};
const metricLabels={businessProfit:'事業利益',businessProfitMargin:'事業利益率',roe:'ROE',cashInflows:'キャッシュ流入'};
let historyData={companies:[]};
let progressData={events:[]};
function formatValue(value,unit){
  if(value==null)return '未登録';
  const number=Number(value);
  if(unit==='billion_yen')return `${(number*10).toLocaleString('ja-JP',{maximumFractionDigits:1})}億円`;
  if(unit==='trillion_yen')return `${number.toLocaleString('ja-JP',{maximumFractionDigits:2})}兆円`;
  if(unit==='%_minimum')return `${number.toLocaleString('ja-JP')}%以上`;
  if(unit==='%')return `${number.toLocaleString('ja-JP')}%`;
  return `${value}${unit?` ${unit}`:''}`;
}
function eventValue(event){
  const after=formatValue(event.afterValue,event.unit);
  if(event.beforeValue==null)return after;
  return `${formatValue(event.beforeValue,event.unit)} → ${after}`;
}
function renderPlans(item){
  return (item.plans||[]).map(plan=>`<article>
    <div><span class="status-pill${plan.status==='active'?'':' partial'}">${esc(plan.outcomeLabel||'進行中')}</span></div>
    <h3>${esc(plan.name)}</h3>
    <p>${esc(plan.period)} ／ 公表 ${esc(plan.publicationDate)}</p>
    <ul>${(plan.evidenceRefs||[]).map(ref=>`<li>${esc(ref)}</li>`).join('')}</ul>
    <p><a class="text-link" href="${esc(plan.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式計画資料を開く</a></p>
  </article>`).join('');
}
function renderEvents(item){
  const events=(progressData.events||[]).filter(event=>String(event.companyCode)===String(item.code)).sort((a,b)=>String(a.effectiveDate).localeCompare(String(b.effectiveDate)));
  if(!events.length)return '<div class="empty-state"><p>進捗変更イベントはまだ登録されていません。</p></div>';
  return `<div class="timeline">${events.map(event=>`<article>
    <p class="eyebrow">${esc(event.effectiveDate)}・${esc(eventLabels[event.eventType]||event.eventType)}</p>
    <h3>${esc(metricLabels[event.metric]||event.metric)}</h3>
    <p class="metric-value">${esc(eventValue(event))}</p>
    <p>${esc(event.note||'')}</p>
    <p><a class="text-link" href="${esc(event.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式資料 ${esc(event.evidenceRef)}</a></p>
  </article>`).join('')}</div>`;
}
function render(){
  const query=$('#history-search').value.trim().toLowerCase();
  const rows=(historyData.companies||[]).filter(item=>!query||`${item.code} ${item.name}`.toLowerCase().includes(query));
  $('#history-count').textContent=`${rows.length}社`;
  $('#history-grid').innerHTML=rows.map(item=>`<article class="platform-card">
    <p class="eyebrow">${esc(item.code)}</p>
    <h2>${esc(item.name)}</h2>
    <p>${esc(item.summary||'')}</p>
    <section><h3>計画履歴</h3><div class="timeline">${renderPlans(item)}</div></section>
    <section><h3>目標・見通し・実績の変更</h3>${renderEvents(item)}</section>
  </article>`).join('')||'<div class="empty-state"><h2>条件に一致する企業がありません</h2><p>会社名または証券コードを変更してください。</p></div>';
}
try{
  [historyData,progressData]=await Promise.all([
    fetch('./data/plan-history.json',{cache:'no-cache'}).then(response=>response.ok?response.json():Promise.reject(Error('過去中計データを取得できません。'))),
    fetch('./data/progress-events.json',{cache:'no-cache'}).then(response=>response.ok?response.json():Promise.reject(Error('進捗変更データを取得できません。'))),
  ]);
  $('#history-updated').textContent=`更新日 ${historyData.updatedAt} ／ 進捗イベント ${progressData.events.length}件`;
  render();
  $('#history-search').addEventListener('input',render);
}catch(error){
  $('#history-error').hidden=false;
  $('#history-error').textContent=error.message;
}
