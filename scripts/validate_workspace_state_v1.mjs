import assert from 'node:assert/strict';
import { parseWorkspaceUrl, buildWorkspaceUrl } from '../site/assets/workspace-state.js';

const validStrategies = new Set(['ma', 'progress']);
const validCodes = new Set(['7011', '6501', '9432', '2282', '9999']);

const parsed = parseWorkspaceUrl(
  'https://example.test/?q=ROIC%20海外&market=Prime&stage=core&strategy=ma&sort=quality&saved=1&compare=7011,6501,7011,XXXX,9432,2282,9999#company=7011',
  { validStrategies, validCodes },
);
assert.deepEqual(parsed, {
  query: 'ROIC 海外',
  market: 'Prime',
  stage: 'core',
  strategy: 'ma',
  sort: 'quality',
  savedOnly: true,
  compare: ['7011', '6501', '9432', '2282'],
  company: '7011',
});

const invalid = parseWorkspaceUrl(
  'https://example.test/?market=Unknown&stage=gold&strategy=buy&sort=profit&compare=ABCD,123#company=0000',
  { validStrategies, validCodes },
);
assert.equal(invalid.market, '');
assert.equal(invalid.stage, '');
assert.equal(invalid.strategy, '');
assert.equal(invalid.sort, 'relevance');
assert.deepEqual(invalid.compare, []);
assert.equal(invalid.company, '');

const built = buildWorkspaceUrl('https://example.test/old?unused=1#old', {
  query: 'M&A',
  market: 'Growth',
  stage: 'detailed_extracted',
  strategy: 'progress',
  sort: 'verified',
  savedOnly: true,
  compare: new Set(['9432', '7011', '9432']),
  company: '9432',
});
const url = new URL(built, 'https://example.test/');
assert.equal(url.pathname, '/old');
assert.equal(url.searchParams.get('unused'), '1');
assert.equal(url.searchParams.get('q'), 'M&A');
assert.equal(url.searchParams.get('market'), 'Growth');
assert.equal(url.searchParams.get('stage'), 'detailed_extracted');
assert.equal(url.searchParams.get('strategy'), 'progress');
assert.equal(url.searchParams.get('sort'), 'verified');
assert.equal(url.searchParams.get('saved'), '1');
assert.equal(url.searchParams.get('compare'), '9432,7011');
assert.equal(url.hash, '#company=9432');

const defaults = buildWorkspaceUrl('https://example.test/?q=old&sort=quality&saved=1&compare=7011#company=7011', {
  query: '', market: '', stage: '', strategy: '', sort: 'relevance', savedOnly: false, compare: [], company: '',
});
assert.equal(defaults, '/');

console.log('PASS research workspace URL contract');
