import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>JSON.parse(fs.readFileSync(path,'utf8'));
const text=path=>fs.readFileSync(path,'utf8');
const history=read('site/data/plan-history.json');
const events=read('site/data/progress-events.json');
const release=read('site/data/release-status.json');
const releaseSource=read('operations/site-sync/current.json');
const promotion=read('operations/promotion/policy-v1.json');
const offers=read('site/data/offers.json');
const offersSource=read('operations/commercial/offers-v1.json');
const intakeExample=read('operations/commercial/intake.example.json');

assert.equal(history.schemaVersion,'plan-history-v1');
assert.equal(events.schemaVersion,'progress-events-v1');
assert.equal(release.schemaVersion,'site-release-status-v1');
assert.deepEqual(release,releaseSource,'site and operations release status must match');
assert.equal(release.repository.companies,3000);
assert.equal(release.repository.production+release.repository.detailedBeta+release.repository.sourceIndexed+release.repository.coverageBeta,release.repository.companies);
assert.equal(release.repository.production+release.repository.detailedBeta,release.repository.structured);
assert.equal(release.repository.production+release.repository.detailedBeta+release.repository.sourceIndexed,release.repository.sourceConfirmed);
assert.equal(release.repository.production,3000);
assert.equal(release.repository.coverageBeta,0);
assert.equal(release.repository.qualityDebt,0);
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

assert.equal(offers.schemaVersion,'commercial-offers-v1');
assert.deepEqual(offers,offersSource,'site and operations commercial offers must match');
assert.equal(offers.currency,'JPY');
assert.equal(offers.taxIncluded,false);
assert.equal(offers.offers.length,3);
const offerIds=new Set();
for(const offer of offers.offers){
  assert(!offerIds.has(offer.id),`duplicate offer id: ${offer.id}`);
  offerIds.add(offer.id);
  assert(Number.isInteger(offer.priceFrom)&&offer.priceFrom>=0,`invalid price: ${offer.id}`);
  assert(offer.scope.maximumCompanies>=1,`invalid company limit: ${offer.id}`);
  assert(offer.scope.deliverables.length>0,`deliverables required: ${offer.id}`);
  assert(offer.requiredReview.length>0,`review requirements required: ${offer.id}`);
}
assert.equal(release.repository.commercialOffers,offers.offers.length);
assert.deepEqual(release.repository.forms,['general-inquiry','spot-report-request','product-waitlist']);
assert.equal(release.repository.historyCompanies,history.companies.length);
assert.equal(release.repository.historyPlans,history.companies.reduce((sum,company)=>sum+company.plans.length,0));
assert.equal(release.repository.progressEvents,events.events.length);
assert.equal(release.sync.status,'partial');
assert.equal(release.publicSite.verificationIssue,49);

assert.equal(intakeExample.schemaVersion,'commercial-intake-v1');
assert.match(intakeExample.requestId,/^REQ-[0-9]{8}-[A-Z0-9]{6}$/);
assert.equal(intakeExample.requestType,'spot-report');
assert.equal(intakeExample.status,'received');
assert.equal(intakeExample.consent,true);
assert(intakeExample.contact.email.endsWith('.invalid'),'intake example must use a non-routable email address');
assert(offerIds.has(intakeExample.scope.offerId),'intake example must reference a canonical offer');
assert(String(intakeExample.scope.purpose).includes('架空'),'intake example must clearly be fictional');

const reportsHtml=text('site/reports.html');
const pricingHtml=text('site/pricing.html');
const contactHtml=text('site/contact.html');
const thanksHtml=text('site/thanks.html');
assert(reportsHtml.includes('name="spot-report-request"'));
assert(reportsHtml.includes('action="/thanks.html"'));
assert(pricingHtml.includes('name="product-waitlist"'));
assert(pricingHtml.includes('action="/thanks.html"'));
assert(contactHtml.includes('name="general-inquiry"'));
assert(contactHtml.includes('action="/thanks.html"'));
assert(thanksHtml.includes('送信を受け付けました'));
for(const offer of offers.offers){
  assert(reportsHtml.includes(offer.id),`report intake must use canonical offer id: ${offer.id}`);
  assert(reportsHtml.includes(offer.priceFrom.toLocaleString('ja-JP')),`report page must show canonical price: ${offer.id}`);
}

const gitignore=text('.gitignore');
for(const pattern of ['operations/commercial/private/','operations/commercial/leads/','*.netlify-forms-export.csv','*.commercial-intake.local.json']){
  assert(gitignore.includes(pattern),`commercial data ignore pattern is required: ${pattern}`);
}
for(const file of [
  'site/history.html','site/release.html','site/metrics.html','site/reports.html','site/pricing.html','site/contact.html','site/privacy.html','site/thanks.html','site/robots.txt','site/sitemap.xml',
  'site/assets/local-metrics.js','site/data/offers.json','operations/commercial/offers-v1.json','operations/commercial/intake.example.json','operations/commercial/README.md',
  'schemas/commercial-offers.schema.json','schemas/commercial-intake.schema.json',
  'docs/SPOT_RESEARCH_REPORT_TEMPLATE_V1.md','docs/SPOT_RESEARCH_OPERATIONS_V1.md','docs/COMMERCIAL_DATA_HANDLING_V1.md','docs/PUBLIC_LAUNCH_RUNBOOK_20260724.md'
]){
  assert(fs.existsSync(file),`${file} is required`);
}

console.log(JSON.stringify({
  passed:true,
  companies:release.repository.companies,
  production:release.repository.production,
  historyCompanies:history.companies.length,
  plans:history.companies.reduce((sum,company)=>sum+company.plans.length,0),
  progressEvents:events.events.length,
  commercialOffers:offers.offers.length,
  forms:release.repository.forms.length,
  releaseStatus:release.sync.status,
  automaticPromotionAllowed:promotion.automaticPromotionAllowed,
  pilotReviewStatus:mhiReview.reviewStatus,
  intakeExample:intakeExample.requestId,
},null,2));
