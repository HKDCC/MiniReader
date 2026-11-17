/**
 * 选中文本的归一化 / 分词工具。
 * 纯函数，无 DOM、无 Node 依赖，主进程与渲染层共用。
 *
 * 关键约定：normalizeSpan 保留大小写。
 * 因为 ECDICT 里 "US" 与 "us" 是两个词条，统一小写会把专有名词查成名/代词。
 * 需要大小写无关的场合（缓存 key、sw 查询）单独调用 spanCacheKey / compactKey。
 */

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const CURLY_SINGLE = /[\u2018\u2019\u201A\u201B\u2032\u2035]/g;
const CURLY_DOUBLE = /[\u201C\u201D\u201E\u201F\u2033]/g;
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;

const LEADING_NON_ALNUM = /^[^\p{L}\p{N}]+/u;
const TRAILING_NON_ALNUM = /[^\p{L}\p{N}]+$/u;

const PARTICLES = new Set([
  'down', 'up', 'out', 'off', 'through', 'around', 'away',
  'back', 'over', 'in', 'on', 'about', 'along', 'across', 'by',
]);

/** 去标点、统一引号与破折号、折叠空白。保留大小写。 */
export function normalizeSpan(raw: string): string {
  if (typeof raw !== 'string' || !raw) return '';

  let s = raw.normalize('NFKC');
  s = s.replace(ZERO_WIDTH, '');
  s = s.replace(CURLY_SINGLE, "'");
  s = s.replace(CURLY_DOUBLE, '"');
  s = s.replace(DASHES, '-');
  s = s.replace(/\u2026/g, '...');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(LEADING_NON_ALNUM, '').replace(TRAILING_NON_ALNUM, '');

  return s;
}

/** 按空白 / 连字符 / 斜杠切分，再削掉每段首尾的非字母数字。 */
export function tokenizeSpan(normalized: string): string[] {
  if (!normalized) return [];
  return normalized
    .split(/[\s\-/]+/)
    .map((part) => part.replace(LEADING_NON_ALNUM, '').replace(TRAILING_NON_ALNUM, ''))
    .filter((part) => part.length > 0);
}

/** ECDICT 的 sw 字段是去空格归一形式（"break down" → "breakdown"）。 */
export function compactKey(normalized: string): string {
  return normalized.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
}

/** 缓存 key。刻意保留大小写：结果里含展示用的原文形态，不能跨大小写复用。 */
export function spanCacheKey(normalized: string): string {
  return normalized;
}

export function classifySpan(tokenCount: number): 'word' | 'phrase' | 'sentence' {
  if (tokenCount <= 1) return 'word';
  if (tokenCount <= 4) return 'phrase';
  return 'sentence';
}

export function isParticle(token: string): boolean {
  return PARTICLES.has(token.toLowerCase());
}

/**
 * 所有格 / 缩写的 's 尾巴。
 * 不做无条件剥离 —— "it's" 剥成 "it" 会查错词。
 * 只在原串查不到时作为一次额外尝试。
 */
export function stripPossessive(text: string): string | null {
  if (text.length <= 2) return null;
  const stripped = text.replace(/['\u2019]s$/i, '');
  if (stripped === text) return null;
  return stripped.length >= 2 ? stripped : null;
}

const SENTENCE_BOUNDARY = /[.!?\u2026\u3002\uFF01\uFF1F\n]/;

/**
 * 取选中范围所在的整句，供 LLM 做语境消歧。
 * 找不到边界（整段无标点）时返回整段，超过 maxLen 以选中位置为中心截断。
 */
export function extractSentence(text: string, start: number, end: number, maxLen = 240): string {
  if (typeof text !== 'string' || !text) return '';

  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));

  let left = from;
  while (left > 0 && !SENTENCE_BOUNDARY.test(text[left - 1])) left--;

  let right = to;
  while (right < text.length && !SENTENCE_BOUNDARY.test(text[right])) right++;
  // 把句末标点纳入；换行本身不必带
  if (right < text.length && text[right] !== '\n') right++;

  if (right <= left) return '';

  let rawStart = left;
  let rawEnd = right;
  let prefix = '';
  let suffix = '';

  if (right - left > maxLen) {
    const half = Math.floor(maxLen / 2);
    rawStart = Math.max(left, from - half);
    rawEnd = Math.min(right, rawStart + maxLen);
    rawStart = Math.max(left, rawEnd - maxLen);
    prefix = rawStart > left ? '\u2026' : '';
    suffix = rawEnd < right ? '\u2026' : '';
  }

  const core = text
    .slice(rawStart, rawEnd)
    .replace(/\s+/g, ' ')
    .trim();

  if (!core) return '';
  return `${prefix}${core}${suffix}`;
}
