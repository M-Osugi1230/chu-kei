import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>JSON.parse(fs.readFileSync(path,'utf8'));
const history=read('site/data/plan-history.json');
const events=read('site/data/progress-events.json');
const release=read('site/data/release-status.json');
const releaseSource=read('operations/site-sync/current.json');
const promotion=read('operations/promotion/policy-v1.json');

assert.equal(history.schemaVersion,'plan-history-v1');
assert.equal(events.schemaVersion,'progress-events-v1');
assert.equal(release.schemaVersion,'site-release-status-v1');
assert.deepEqual(release,releaseSource,'site and operations release status must match');
assert.equal(release.repository.companies,570);
assert.equal(release.repository.production+release.repository.detailedBeta+release.repository.sourceIndexed+release.repository.coverageBeta,570);
assert.equal(release.repository.production+release.repository.detailedBeta,release.repository.structured);
assert.equal(release.repository.production+release.repository.detailedBeta+release.repository.sourceIndexed,release.repository.sourceConfirmed);
assert.equal(promotion.automaticPromotionAllowed,false);
assert.equal(promotion.sourceStage,'detailed_extracted');
assert.equal(promotion.targetStage,'core');

const codes=new Set();
for(const company of history.companies){
  assert.match(company.code,/^[0-9A-Z]{4}$/);
  assert(!codes.has(company.code),`duplicate history company: ${company.code}`);
  codes.add(company.code);
  assert(company.plans.length>=2,`${company.code} must have at least two plans`);
  const planIds=new Set();
  for(const plan of company.plans){
    assert(!planIds.has(plan.planId),`duplicate plan id: ${plan.planId}`);
    planIds.add(plan.planId);
    assert.match(plan.sourceUrl,/^https:\/\//,`plan source must be HTTPS: ${plan.planId}`);
    assert(Array.isArray(plan.evidenceRefs)&&plan.evidenceRefs.length>0,`plan evidence is required: ${plan.planId}`);
  }
}

const eventIds=new Set();
for(const event of events.events){
  assert(!eventIds.has(event.eventId),`duplicate event id: ${event.eventId}`);
  eventIds.add(event.eventId);
  assert.match(event.companyCode,/^[0-9A-Z]{4}$/);
  assert(codes.has(event.companyCode),`progress event must reference a history company: ${event.eventId}`);
  assert.match(event.sourceUrl,/^https:\/\//);
  assert(event.evidenceRef,`progress event evidence is required: ${event.eventId}`);
}

assert(history.companies.length>=1,'at least one past-plan pilot company is required');
assert(events.events.length>=9,'at least nine progress events are required for the pilot');
assert(fs.existsSync('operations/history/7011-mhi-plan-history-v1.json'),'MHI review ledger is required');
const mhiReview=read('operations/history/7011-mhi-plan-history-v1.json');
assert.equal(mhiReview.reviewStatus,'in_review');
assert.equal(mhiReview.automaticProductionPromotion,false);

for(const file of ['site/history.html','site/release.html','site/metrics.html','site/reports.html','site/pricing.html','site/privacy.html','site/assets/local-metrics.js']){
  assert(fs.existsSync(file),`${file} is required`);
}

console.log(JSON.stringify({
  passed:true,
  historyCompanies:history.companies.length,
  plans:history.companies.reduce((sum,company)=>sum+company.plans.length,0),
  progressEvents:events.events.length,
  releaseStatus:release.sync.status,
  automaticPromotionAllowed:promotion.automaticPromotionAllowed,
  pilotReviewStatus:mhiReview.reviewStatus,
},null,2));
