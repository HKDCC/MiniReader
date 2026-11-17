const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function testSpanResolve() {
  console.log('--- Testing span resolution cascade ---');
  const dictEnginePath = path.join(__dirname, '..', 'dist_electron', 'dictEngine.js');
  if (!fs.existsSync(dictEnginePath)) {
    throw new Error('dist_electron/dictEngine.js does not exist. Run electron:build first.');
  }

  const { DictEngine } = require(dictEnginePath);
  const engine = new DictEngine();
  assert.strictEqual(engine.isAvailable(), true, 'dict engine should load stardict.db');

  // 1. 多词短语：整串不存在，但逐词都能查到的典型场景
  const phrase = engine.resolveSpan('hurtling down');
  assert.strictEqual(phrase.kind, 'phrase');
  assert.strictEqual(phrase.primary, null, 'whole phrase should miss');
  assert.strictEqual(phrase.tokens.length, 2);
  assert.deepStrictEqual(phrase.missedTokens, [], 'both tokens should resolve');
  assert.strictEqual(phrase.tokens[0].lemma, 'hurtle', 'hurtling -> hurtle');
  assert.strictEqual(phrase.tokens[0].hit, true);
  assert.ok(
    /猛冲|疾驰|飞奔/.test(phrase.tokens[0].lemmaEntry?.translation || ''),
    'lemma entry should carry a Chinese gloss'
  );
  console.log('✓ "hurtling down" -> phrase breakdown:', phrase.tokens.map((t) => t.text).join(' + '));

  // 2. 单词：整词命中，且能给出词根
  const word = engine.resolveSpan('hurtling');
  assert.strictEqual(word.kind, 'word');
  assert.ok(word.primary, 'hurtling should hit as a headword');
  assert.ok(/疾驰|飞奔/.test(word.primary.translation || ''));
  assert.strictEqual(word.primaryLemma, 'hurtle');
  console.log('✓ "hurtling" ->', word.primary.translation.split('\n')[0], '| lemma:', word.primaryLemma);

  // 3. 弯引号 + 尾逗号剥离
  const quoted = engine.resolveSpan('\u201CHurtling down,\u201D');
  assert.strictEqual(quoted.normalized, 'Hurtling down', 'quotes and comma stripped, case preserved');
  assert.strictEqual(quoted.kind, 'phrase');
  assert.strictEqual(quoted.primary, null);
  console.log('✓ quote stripping ->', JSON.stringify(quoted.normalized));

  // 3b. 首冠词 + 句点
  const withArticle = engine.resolveSpan('the hurtling down.');
  assert.strictEqual(withArticle.normalized, 'the hurtling down');
  assert.strictEqual(withArticle.tokens.length, 3);
  assert.deepStrictEqual(withArticle.missedTokens, []);
  console.log('✓ trailing period ->', JSON.stringify(withArticle.normalized));

  // 4. exact 必须优先于 sw，否则会拿到 "break ... down"
  const breakDown = engine.resolveSpan('break down');
  assert.ok(breakDown.primary, 'break down should hit');
  assert.strictEqual(breakDown.primary.word, 'break down', 'exact must win over sw');
  assert.strictEqual(breakDown.matchedPattern, undefined);
  console.log('✓ "break down" ->', breakDown.primary.translation.split('\n')[0]);

  // 5. 三词短语
  const runOutOf = engine.resolveSpan('run out of');
  assert.ok(runOutOf.primary, 'run out of should hit');
  assert.strictEqual(runOutOf.tokens.length, 3);
  console.log('✓ "run out of" ->', runOutOf.primary.translation.split('\n')[0]);

  // 6. 整句：只分类，不查词
  const sentence = engine.resolveSpan(
    "she's been hurtling down the road since graduation"
  );
  assert.strictEqual(sentence.kind, 'sentence');
  assert.strictEqual(sentence.tokens.length, 0, 'sentence must not trigger token lookups');
  assert.strictEqual(sentence.primary, null);
  console.log('✓ full sentence classified, no SQL');

  // 7. 真 miss
  const miss = engine.resolveSpan('zzzzqqq');
  assert.strictEqual(miss.kind, 'word');
  assert.strictEqual(miss.primary, null);
  assert.deepStrictEqual(miss.missedTokens, ['zzzzqqq']);
  console.log('✓ "zzzzqqq" correctly reported as miss');

  // 8. 边界输入不应抛异常
  assert.strictEqual(engine.resolveSpan('   ').normalized, '');
  assert.doesNotThrow(() => engine.resolveSpan('a'.repeat(600)));
  assert.doesNotThrow(() => engine.resolveSpan(null));
  console.log('✓ empty / oversized / null inputs are safe');

  // 9. 连字符复合词
  const hyphenated = engine.resolveSpan('Hurtling-Down');
  assert.strictEqual(hyphenated.tokens.length, 2);
  console.log('✓ hyphenated span ->', hyphenated.tokens.map((t) => t.text).join(' + '));

  console.log('\nAll span resolution tests passed.');
}

testSpanResolve().catch((err) => {
  console.error('\nSpan resolution test failed:', err);
  process.exit(1);
});
