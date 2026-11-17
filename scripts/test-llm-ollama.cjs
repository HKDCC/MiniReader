const path = require('path');
const fs = require('fs');

const SENTENCE =
  "the road to literary stardom she's been hurtling down since graduation";

/** 内置样本：没有 --samples 时使用 */
const BUILTIN_SAMPLES = [
  {
    id: 'b1',
    bucket: '短语（词典整串查不到）',
    request: { span: 'hurtling down', context: SENTENCE, ruleSummary: '', kind: 'phrase' },
  },
  {
    id: 'b2',
    bucket: '单词（词典词性是形容词，语境是进行时）',
    request: { span: 'hurtling', context: SENTENCE, ruleSummary: '', kind: 'word' },
  },
  {
    id: 'b3',
    bucket: '整句',
    request: { span: SENTENCE, context: SENTENCE, ruleSummary: '', kind: 'sentence' },
  },
  {
    id: 'b4',
    bucket: '动词短语（词典命中）',
    request: {
      span: 'break down',
      context: 'The old engine finally began to break down on the highway.',
      ruleSummary: 'break down：毁掉, 制服, 压倒, 倒塌, 垮掉, 分解',
      kind: 'phrase',
    },
  },
  {
    id: 'b5',
    bucket: '词典未收录（观察是否编造）',
    request: {
      span: 'zzzzqqq',
      context: 'A zzzzqqq drifted past the window.',
      ruleSummary: 'zzzzqqq：词典未收录',
      kind: 'word',
    },
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  const modelArg = get('--models') || get('--compare') || 'auto';
  return {
    samplesPath: get('--samples'),
    models: modelArg.split(',').map((item) => item.trim()).filter(Boolean),
    outPath: get('--out'),
  };
}

function loadSamples(samplesPath) {
  if (!samplesPath) return BUILTIN_SAMPLES;
  const parsed = JSON.parse(fs.readFileSync(samplesPath, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('样本文件必须是非空数组');
  }
  return parsed.map((item, index) => ({
    id: item.id || `s${index + 1}`,
    bucket: item.bucket || '',
    dict: item.dict,
    request: item.request,
  }));
}

function fmt(value, width) {
  const text = String(value ?? '');
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

async function main() {
  const { samplesPath, models, outPath } = parseArgs();
  const samples = loadSamples(samplesPath);

  const enginePath = path.join(__dirname, '..', 'dist_electron', 'llmEngine.js');
  if (!fs.existsSync(enginePath)) {
    throw new Error('dist_electron/llmEngine.js 不存在，请先运行 electron:build');
  }
  const { llmEngine: engine } = require(enginePath);

  console.log('--- LLM 对比评估 ---');
  console.log(`样本数：${samples.length}   模型：${models.join(' / ')}`);

  const runs = [];

  for (const tier of models) {
    const status = await engine.status('ollama', tier);
    if (!status.available) {
      console.log(`\n[${tier}] 跳过：${status.reason}`);
      continue;
    }
    console.log(
      `\n[${tier}] 实际使用 ${status.model}  显存 ${status.vramMB ? Math.round(status.vramMB / 1024) + ' GB' : '未知'}`
    );

    const results = [];
    for (const sample of samples) {
      const startedAt = Date.now();
      try {
        const result = await engine.explain(`${tier}-${sample.id}`, sample.request, tier, () => {});
        results.push({ id: sample.id, elapsed: Date.now() - startedAt, result });
      } catch (err) {
        results.push({ id: sample.id, elapsed: Date.now() - startedAt, error: err.message });
      }
    }
    runs.push({ tier, model: status.model, results });
  }

  if (!runs.length) {
    console.log('\n本地 Ollama 无可用的解释模型，已跳过。');
    return;
  }

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    console.log(`\n${'='.repeat(78)}`);
    console.log(`[${sample.id}] ${sample.bucket}`);
    console.log(`span: ${sample.request.span}`);
    if (sample.request.context) console.log(`ctx : ${fmt(sample.request.context, 150)}`);
    if (sample.dict) {
      const gloss = sample.dict.primaryGloss ? ` (${fmt(sample.dict.primaryGloss, 40)})` : '';
      console.log(
        `词典: ${sample.dict.primaryWord || '未收录'}${gloss}  [${sample.dict.resolvedKind}]`
      );
    }

    for (const run of runs) {
      const item = run.results[index];
      console.log(`\n  --- ${run.tier}  ${item.elapsed}ms ---`);
      if (item.error) {
        console.log(`  ✗ ${item.error}`);
        continue;
      }
      console.log(`  释义: ${item.result.meaningZh}`);
      if (item.result.tokens?.length) {
        const parts = item.result.tokens.map(
          (token) => `${token.text}${token.pos ? `[${token.pos}]` : ''}=${token.meaningZh}`
        );
        console.log(`  拆解: ${parts.join(' | ')}`);
      }
      if (item.result.note) console.log(`  注  : ${item.result.note}`);
    }
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('汇总');
  console.log('='.repeat(78));
  console.log(`${'模型'.padEnd(22)}${'平均'.padEnd(10)}${'首次'.padEnd(10)}${'成功'.padEnd(8)}`);
  for (const run of runs) {
    const ok = run.results.filter((item) => !item.error);
    const avg = ok.length
      ? Math.round(ok.reduce((sum, item) => sum + item.elapsed, 0) / ok.length)
      : 0;
    const first = run.results[0]?.elapsed ?? 0;
    console.log(
      `${run.tier.padEnd(22)}${`${avg}ms`.padEnd(10)}${`${first}ms`.padEnd(10)}${`${ok.length}/${run.results.length}`.padEnd(8)}`
    );
  }

  if (outPath) {
    fs.writeFileSync(
      outPath,
      JSON.stringify({ createdAt: new Date().toISOString(), samples, runs }, null, 2),
      'utf8'
    );
    console.log(`\n结果已写入 ${outPath}`);
  }

  const failures = runs.flatMap((run) =>
    run.results.filter((item) => item.error).map((item) => `${run.tier}/${item.id}: ${item.error}`)
  );
  if (failures.length) {
    console.log(`\n失败 ${failures.length} 项：`);
    failures.forEach((line) => console.log(`  - ${line}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n评估脚本异常：', err);
  process.exit(1);
});
