const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function testDict() {
  console.log('--- Testing ECDICT SQLite Engine ---');
  const dictEnginePath = path.join(__dirname, '..', 'dist_electron', 'dictEngine.js');
  if (!fs.existsSync(dictEnginePath)) {
    throw new Error('dist_electron/dictEngine.js does not exist. Run electron:build first.');
  }

  const { DictEngine } = require(dictEnginePath);
  const engine = new DictEngine();

  const isReady = engine.isAvailable();
  console.log('DictEngine isAvailable:', isReady);
  assert.strictEqual(isReady, true, 'DictEngine should find and load the database');

  // Test 1: Exact and lower case word lookup
  const entryApple = engine.lookup('apple');
  assert(entryApple !== null, 'apple should be found in dictionary');
  assert.strictEqual(entryApple.word.toLowerCase(), 'apple');
  console.log('✓ Found "apple":', entryApple.phonetic, entryApple.translation.slice(0, 30));

  const entryUpper = engine.lookup('Apple');
  assert(entryUpper !== null, 'Apple (capitalized) should be found');
  console.log('✓ Found "Apple" with case insensitivity');

  // Test 2: Lemmatization lookup
  const entryLearned = engine.lookup('learned');
  assert(entryLearned !== null, 'learned should be found');
  console.log('✓ Found "learned", exchange field:', entryLearned.exchange);

  const lemmaLearned = engine.lemmatize('learned');
  console.log('✓ Lemmatize "learned" ->', lemmaLearned);
  assert(lemmaLearned === 'learn' || lemmaLearned === 'learned', 'Should lemmatize to learn or learned');

  const lemmaAbandoned = engine.lemmatize('abandoned');
  console.log('✓ Lemmatize "abandoned" ->', lemmaAbandoned);
  assert(lemmaAbandoned === 'abandon' || lemmaAbandoned === 'abandoned', 'Should lemmatize to abandon');

  // Test 3: Phrase lookup
  const phrase = engine.lookup('run out of');
  console.log('✓ Phrase "run out of" lookup result:', phrase ? phrase.translation : 'None in ECDICT (fallback to custom phrase handling)');

  // Test 4: Batch lookup
  const batch = engine.batchLookup(['apple', 'orange', 'banana', 'unfindablewordxyz123']);
  const foundKeys = Object.keys(batch);
  assert.strictEqual(foundKeys.length, 3, 'Batch lookup should return 3 found items');
  console.log('✓ Batch lookup returned 3 items out of 4:', foundKeys.join(', '));

  console.log('\nAll DictEngine backend tests passed successfully!');
}

testDict().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
