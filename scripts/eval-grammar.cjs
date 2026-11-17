/** 语法解释能力评测：自由提问 vs 强约束字段 */
const fs = require('fs');
const LOG_PATH = 'C:/Users/hkdcc/AppData/Local/Temp/yf/grammar-eval.log';
const OLLAMA = 'http://127.0.0.1:11434';
const MODEL = process.argv[2] || 'qwen3.5:9b';
const FREE_ONLY = process.argv[3] === 'free';

const SAMPLES = [
  {
    id: 'g1',
    span: 'hurtling down',
    context:
      "one of the side perks of the road to literary stardom she's been hurtling down since graduation",
    truth: '定语从句省略关系代词 that/which；down 是介词，宾语是前置的 the road（介词悬空）',
  },
  {
    id: 'g2',
    span: 'longer than my grocery list',
    context:
      'a history of awards nominations longer than my grocery list',
    truth: '形容词短语后置修饰 nominations，不是修饰 history；比较结构 longer than',
  },
  {
    id: 'g3',
    span: 'just this side of thirty',
    context:
      'Writers our age—young, ambitious up-and-comers just this side of thirty—tend to run in packs.',
    truth: '后置修饰 up-and-comers；this side of = 不到、接近但未满',
  },
  {
    id: 'g4',
    span: "doesn't name-drop, doesn't blurb or recommend",
    context:
      "She doesn't name-drop, doesn't blurb or recommend her colleagues' books, and doesn't publicly rub shoulders in that ostentatious way.",
    truth: '三个并列谓语共用主语 She；blurb 在此作动词（写推荐语）',
  },
  {
    id: 'g5',
    span: 'the way early career writers do',
    context:
      "doesn't publicly rub shoulders in that ostentatious, desperate way early career writers do",
    truth: 'way 引导方式状语从句；do 是代动词，替代 rub shoulders',
  },
  {
    id: 'g6',
    span: 'so stupidly, ridiculously successful that',
    context:
      "Athena is so stupidly, ridiculously successful that it makes sense she wouldn't want to mingle with mere mortals.",
    truth: 'so + adj + that 结果状语从句；stupidly/ridiculously 修饰 successful',
  },
  {
    id: 'g7',
    span: 'used to think that',
    context: 'I used to think that she was simply aloof.',
    truth: 'used to + 动词原形表过去习惯；that 引导宾语从句',
  },
  {
    id: 'g8',
    span: 'presumably',
    context: 'Athena, presumably, chats exclusively with blue check holders.',
    truth: '插入语/评注性状语，修饰整句而非 chats；逗号隔开',
  },
  {
    id: 'g9',
    span: 'one of the side perks',
    context:
      "just another feather in her cap, one of the side perks of the road to literary stardom",
    truth: '同位语，回指 another feather in her cap',
  },
  {
    id: 'g10',
    span: "wouldn't want to mingle",
    context:
      "it makes sense she wouldn't want to mingle with mere mortals",
    truth: '宾语从句省略 that；would 表推测而非过去将来',
  },
];

const COMPLETION_SCHEMA = {
  type: 'object',
  properties: {
    parse: { type: 'string' },
    attach: { type: 'string' },
    caveat: { type: 'string' },
  },
  required: ['parse', 'attach', 'caveat'],
};

async function chat(messages, format) {
  try {
    return await chatOnce(messages, format, true);
  } catch {
    // 部分模型（如 gemma）不接受 think 参数，退回不传
    return await chatOnce(messages, format, false);
  }
}

async function chatOnce(messages, format, withThink) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  const body = {
    model: MODEL,
    messages,
    stream: false,
    options: { temperature: 0.2, top_p: 0.9 },
  };
  if (withThink) body.think = false;
  if (format) body.format = format;

  const started = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  if (!res.ok) {
    clearTimeout(timer);
    throw new Error(`HTTP ${res.status}`);
  }
  const json = await res.json();
  clearTimeout(timer);
  return {
    content: (json.message?.content || '').trim(),
    elapsed: Date.now() - started,
  };
}

function freePrompt(sample) {
  return [
    {
      role: 'system',
      content: '你是英语阅读助手，用中文回答。',
    },
    {
      role: 'user',
      content: `选中的部分：「${sample.span}」\n完整句子：「${sample.context}」\n\n请解释这个部分在句中的语法结构：它充当什么成分、修饰谁、句子该怎么断句。`,
    },
  ];
}

function boundedPrompt(sample) {
  return [
    {
      role: 'system',
      content:
        '你是英语语法助教。只输出 JSON。每个字段都必须极短，宁可缺信息也不要展开论述。',
    },
    {
      role: 'user',
      content: [
        `选中部分：「${sample.span}」`,
        `完整句子：「${sample.context}」`,
        '',
        '按要求输出三个字段：',
        '- parse：这个部分在句中充当什么成分，最多 12 个字（如「定语从句」「后置修饰语」「同位语」）',
        '- attach：它修饰或依附于哪个词，最多 10 个字',
        '- caveat：最容易误读的地方，最多 12 个字；没有就写空字符串',
        '',
        '规则：只描述结构，不要解释含义，不要举例，不要重复原句。',
        '判断不了就在对应字段写「不确定」，绝对不要猜。',
      ].join('\n'),
    },
  ];
}

async function main() {
  const status = await fetch(`${OLLAMA}/api/tags`).then((r) => r.json());
  const has = (status.models || []).some((m) => {
    const name = m.name || '';
    return name === MODEL || name === `${MODEL}:latest` || name.split(':')[0] === MODEL;
  });
  if (!has) {
    console.log(`模型 ${MODEL} 未安装，跳过。`);
    return;
  }

  console.log(`模型：${MODEL}   样本：${SAMPLES.length}   模式：自由 / 约束\n`);
  fs.writeFileSync(LOG_PATH, '');
  const rows = [];

  for (const sample of SAMPLES) {
    let free;
    let bounded;
    try {
      free = await chat(freePrompt(sample));
    } catch (err) {
      free = { content: `（失败：${err.message}）`, elapsed: 0 };
    }
    if (!FREE_ONLY) {
      try {
        bounded = await chat(boundedPrompt(sample), COMPLETION_SCHEMA);
      } catch (err) {
        bounded = { content: `（失败：${err.message}）`, elapsed: 0 };
      }
    } else {
      bounded = { content: '', elapsed: 0 };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(bounded.content);
    } catch {
      parsed = null;
    }

    const boundedText = parsed
      ? [parsed.parse, parsed.attach, parsed.caveat].filter(Boolean).join(' / ')
      : bounded.content;

    rows.push({
      id: sample.id,
      span: sample.span,
      truth: sample.truth,
      free: free.content,
      freeChars: free.content.length,
      freeMs: free.elapsed,
      bounded: boundedText,
      boundedChars: boundedText.length,
      boundedMs: bounded.elapsed,
      jsonOk: !!parsed,
      total: parsed
        ? (parsed.parse || '').length + (parsed.attach || '').length + (parsed.caveat || '').length
        : null,
    });

    console.log(`[${sample.id}] ${sample.span}`);
    fs.appendFileSync(LOG_PATH, JSON.stringify(rows[rows.length - 1]) + '\n');
    console.log(`  正解: ${sample.truth}`);
    console.log(`  自由(${free.elapsed}ms, ${free.content.length}字): ${free.content.replace(/\n/g, ' ')}`);
    console.log(`  约束(${bounded.elapsed}ms, ${boundedText.length}字): ${boundedText}`);
    console.log('');
  }

  const avg = (key) => Math.round(rows.reduce((sum, r) => sum + r[key], 0) / rows.length);
  const over = rows.filter((r) => r.total !== null && r.total > 42).length;

  console.log('='.repeat(70));
  console.log(`自由模式平均 ${avg('freeChars')} 字 / ${avg('freeMs')}ms`);
  if (!FREE_ONLY) {
    const over = rows.filter((r) => r.total !== null && r.total > 42).length;
    console.log(`约束模式平均 ${avg('boundedChars')} 字 / ${avg('boundedMs')}ms`);
    console.log(`约束模式 JSON 合法 ${rows.filter((r) => r.jsonOk).length}/${rows.length}`);
    console.log(`约束模式超出字数预算（>42字）${over}/${rows.length}`);
  }
}

main().catch((err) => {
  console.error('评测失败：', err);
  process.exit(1);
});
