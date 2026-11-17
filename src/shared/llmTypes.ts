/**
 * LLM 解释层的共享类型与结构化输出 schema。
 * 主进程（electron/llmEngine.ts）与渲染层（src/services/llmService.ts）共用。
 */

export interface ExplanationToken {
  text: string;
  pos?: string;
  meaningZh: string;
}

export interface Explanation {
  spanType: 'word' | 'phrase' | 'idiom' | 'sentence';
  meaningZh: string;
  tokens: ExplanationToken[];
  note: string;
  examples?: string[];
}

export type LlmProviderId = 'ollama' | 'bundled';

/** 'auto' 表示按显存自动选档 */
export type LlmModelTier = 'auto' | 'qwen3.5:9b' | 'qwen3.5:4b' | 'qwen3.5:2b';

export interface LlmStatus {
  available: boolean;
  provider: LlmProviderId;
  /** 实际会使用的模型 tag；不可用时为 null */
  model: string | null;
  /** provider 上已安装的候选模型 */
  installed: string[];
  /** 探测到的显存（MB）；无独显或探测失败为 null */
  vramMB: number | null;
  /** 不可用时的原因文案 */
  reason?: string;
}

export interface LlmExplainRequest {
  span: string;
  context: string;
  /** 词典已有结果的摘要，给模型当事实锚点，避免它推翻确定信息 */
  ruleSummary: string;
  kind: 'word' | 'phrase' | 'sentence';
}

/**
 * 提示词版本。改了 prompt 或 schema 就 +1，让旧缓存自然失效。
 */
export const PROMPT_VERSION = 1;

/**
 * 结构化输出 schema。字段顺序即生成顺序，meaningZh 排最前。
 * Ollama 的 /api/chat 要求 format 传 schema 对象（不是字符串 "json"）。
 */
export const EXPLANATION_SCHEMA = {
  type: 'object',
  properties: {
    spanType: { type: 'string', enum: ['word', 'phrase', 'idiom', 'sentence'] },
    meaningZh: { type: 'string' },
    tokens: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          pos: { type: 'string' },
          meaningZh: { type: 'string' },
        },
        required: ['text', 'meaningZh'],
      },
    },
    note: { type: 'string' },
    examples: { type: 'array', maxItems: 2, items: { type: 'string' } },
  },
  required: ['spanType', 'meaningZh', 'tokens', 'note'],
} as const;

export function isExplanation(value: unknown): value is Explanation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Explanation>;
  return (
    typeof candidate.meaningZh === 'string' &&
    candidate.meaningZh.trim().length > 0 &&
    typeof candidate.note === 'string' &&
    Array.isArray(candidate.tokens) &&
    typeof candidate.spanType === 'string'
  );
}
