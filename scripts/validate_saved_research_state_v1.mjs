import assert from 'node:assert/strict';
import {
  LEGACY_SAVED_KEY,
  SAVED_RESEARCH_KEY,
  loadSavedResearch,
  persistSavedResearch,
  syncSavedResearch,
  hasSavedUpdate,
  markSavedSeen,
  countSavedUpdates,
} from '../site/assets/saved-research-state.js';

class MemoryStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const companies = new Map([
  ['7011', { code: '7011', lastVerifiedDate: '2026-07-11' }],
  ['6501', { code: '6501', lastVerifiedDate: '2026-07-10' }],
]);
const now = '2026-07-11T14:00:00.000Z';

const legacyStorage = new MemoryStorage({ [LEGACY_SAVED_KEY]: JSON.stringify(['7011', 'XXXX', '6501']) });
const migrated = loadSavedResearch(legacyStorage, companies, now);
assert.deepEqual([...migrated.keys()], ['7011', '6501']);
assert.equal(migrated.get('7011').savedAt, now);
assert.equal(migrated.get('7011').lastSeenVerifiedDate, '2026-07-11');
persistSavedResearch(legacyStorage, migrated);
assert.equal(JSON.parse(legacyStorage.getItem(SAVED_RESEARCH_KEY)).version, 2);
assert.deepEqual(JSON.parse(legacyStorage.getItem(LEGACY_SAVED_KEY)), ['6501', '7011']);

const staleStorage = new MemoryStorage({
  [LEGACY_SAVED_KEY]: JSON.stringify(['7011', '6501']),
  [SAVED_RESEARCH_KEY]: JSON.stringify({
    version: 2,
    companies: {
      '7011': { savedAt: '2026-07-01T00:00:00.000Z', lastSeenVerifiedDate: '2026-07-01' },
      '6501': { savedAt: '2026-07-02T00:00:00.000Z', lastSeenVerifiedDate: '2026-07-10' },
    },
  }),
});
const loaded = loadSavedResearch(staleStorage, companies, now);
assert.equal(hasSavedUpdate(loaded.get('7011'), companies.get('7011')), true);
assert.equal(hasSavedUpdate(loaded.get('6501'), companies.get('6501')), false);
assert.equal(countSavedUpdates(loaded, companies), 1);
assert.equal(markSavedSeen(loaded, companies.get('7011')), true);
assert.equal(hasSavedUpdate(loaded.get('7011'), companies.get('7011')), false);
assert.equal(markSavedSeen(loaded, companies.get('7011')), false);

const synced = syncSavedResearch(loaded, ['6501'], companies, now);
assert.deepEqual([...synced.keys()], ['6501']);
assert.equal(synced.get('6501').savedAt, '2026-07-02T00:00:00.000Z');

console.log('PASS saved research state migration, privacy-local persistence and update detection');
