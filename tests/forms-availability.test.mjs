import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const formPages = [
  ['site/contact.html', 'general-inquiry'],
  ['site/reports.html', 'spot-report-request'],
  ['site/pricing.html', 'product-waitlist'],
];

test('all user-data collection forms fail closed before host verification', () => {
  for (const [path, formName] of formPages) {
    const html = read(path);
    assert.ok(html.includes('<form hidden name="' + formName + '"'), path + ': form must begin hidden');
    assert.ok(html.includes('data-form-availability-status'), path + ': pending notice is missing');
    assert.ok(html.includes('data-netlify="true"'), path + ': Netlify detection attribute is missing');
    assert.ok(html.includes('src="./assets/forms-availability.js"'), path + ': activation script is missing');
  }
});

test('form delivery status requires explicit proof per origin and form', () => {
  const settings = JSON.parse(read('site/data/forms-availability-v1.json'));
  const known = new Set(formPages.map(([, name]) => name));
  assert.equal(settings.schemaVersion, 1);
  assert.equal(settings.provider, 'netlify-forms');
  assert.ok(['unverified', 'verified'].includes(settings.status));
  assert.ok(Array.isArray(settings.verifiedFormNames));
  assert.ok(settings.verifiedFormNames.every(name => known.has(name)));

  if (settings.status === 'unverified') {
    assert.equal(settings.verifiedOrigin, null);
    assert.equal(settings.verifiedAt, null);
    assert.deepEqual(settings.verifiedFormNames, []);
    assert.equal(settings.verificationEvidence, null);
  } else {
    const url = new URL(settings.verifiedOrigin);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.origin, settings.verifiedOrigin);
    assert.match(settings.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(settings.verifiedFormNames.length > 0);
    assert.ok(typeof settings.verificationEvidence === 'string'
      && settings.verificationEvidence.trim().length > 0);
  }
});

test('form activation never enables an unverified or differently hosted site', () => {
  const js = read('site/assets/forms-availability.js');
  assert.ok(js.includes("config?.status === 'verified'"));
  assert.ok(js.includes('config?.verifiedOrigin === location.origin'));
  assert.ok(js.includes('config.verifiedFormNames.includes(name)'));
  assert.ok(js.includes('form.hidden = !approved'));
});
