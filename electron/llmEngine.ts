import { execFile } from 'node:child_process';
import type {
  Explanation,
  LlmExplainRequest,
  LlmModelTier,
  LlmStatus,
} from '../src/shared/llmTypes';
import { EXPLANATION_SCHEMA, isExplanation } from '../src/shared/llmTypes';

const OLLAMA_BASE = 'http://127.0.0.1:11434';
const MODEL_CANDIDATES = ['qwen3.5:9b', 'qwen3.5:4b', 'qwen3.5:2b'] as const;
/** 显存低于这个值就按低配处理，选 2B */
const VRAM_THRESHOLD_MB = 4000;

/** 只保留解释模型候选，避免把 embedding 模型也列进 UI */
function relevantModels(names: string[]): string[] {
  return names.filter((name) => name.startsWith('qwen3.5'));
}

interface OllamaChatChunk {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  error?: string;
}

function buildMessages(req: LlmExplainRequest) {
  const system =
    '你是英语阅读助手。只输出 JSON，不要输出任何解释性文字或 Markdown 代码块。';

  const user = [
    `选中的文本：「${req.span}」`,
    `所在句子：「${req.context || '（无上下文）'}」`,
    `词典已有结果（仅供参考，可能不完整或词性不符）：${req.ruleSummary || '无'}`,
    '',
    '请结合句子语境给出简明中文解释：',
    '- 若选中整句：给出整句中文翻译，并在 note 里写一句语气或含义说明；',
    '- 若是短语或习语：给出该语境下的整体含义，并在 tokens 里逐词简述；',
    '- 若是单词：给出该语境下的词性与中文释义，不要罗列全部义项；',
    '- 词典给的词性可能与该语境不符（例如 hurtling 在 "has been hurtling" 里是进行时动词而非形容词），以语境为准，并在 note 里说明；',
    '- 上下文不足以判断时，meaningZh 写「语境不足，以下为常见释义：…」，不要编造；',
    '- note 最多 30 字，可为空字符串；tokens 最多 4 项。',
  ].join('\n');

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

class OllamaProvider {
  private cachedVram: number | null | undefined;

  async detectVramMB(): Promise<number | null> {
    if (this.cachedVram !== undefined) return this.cachedVram;

    const probe = new Promise<number | null>((resolve) => {
      execFile(
        'nvidia-smi',
        ['--query-gpu=memory.total', '--format=csv,noheader,nounits'],
        { timeout: 3000, windowsHide: true },
        (error, stdout) => {
          if (error || !stdout) return resolve(null);
          const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
          const value = first ? Number.parseInt(first, 10) : NaN;
          resolve(Number.isFinite(value) ? value : null);
        }
      );
    });

    this.cachedVram = await probe;
    return this.cachedVram;
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`Ollama /api/tags 返回 ${response.status}`);
    const data = (await response.json()) as { models?: { name?: string; model?: string }[] };
    return (data.models || [])
      .map((item) => item.name || item.model || '')
      .filter((name): name is string => !!name);
  }

  /** 在已安装列表里按候选顺序找第一个可用模型 */
  pickModel(tier: LlmModelTier, installed: string[], vramMB: number | null): string | null {
    const matches = (tag: string) =>
      installed.find((name) => name === tag || name.startsWith(`${tag}-`)) ?? null;

    if (tier !== 'auto') {
      return matches(tier);
    }

    const preferred = (vramMB ?? 0) >= VRAM_THRESHOLD_MB ? 'qwen3.5:4b' : 'qwen3.5:2b';
    const order = [preferred, ...MODEL_CANDIDATES];
    for (const tag of order) {
      const hit = matches(tag);
      if (hit) return hit;
    }
    return null;
  }

  async status(tier: LlmModelTier): Promise<LlmStatus> {
    const vramMB = await this.detectVramMB();

    let installed: string[];
    try {
      installed = await this.listModels();
    } catch {
      return {
        available: false,
        provider: 'ollama',
        model: null,
        installed: [],
        vramMB,
        reason: '未检测到本地 Ollama 服务（127.0.0.1:11434）',
      };
    }

    const model = this.pickModel(tier, installed, vramMB);
    const relevant = relevantModels(installed);

    if (!model) {
      const wanted = tier === 'auto' ? 'qwen3.5:4b' : tier;
      return {
        available: false,
        provider: 'ollama',
        model: null,
        installed: relevant,
        vramMB,
        reason: `未找到可用模型，请先运行：ollama pull ${wanted}`,
      };
    }

    return { available: true, provider: 'ollama', model, installed: relevant, vramMB };
  }

  async explain(
    req: LlmExplainRequest,
    model: string,
    onProgress: (chars: number) => void,
    signal: AbortSignal
  ): Promise<Explanation> {
    // 空输出在小模型 + 结构化约束下偶发；重试一次再报错，不静默失败。
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.requestOnce(req, model, onProgress, signal, attempt);
      } catch (err) {
        if (signal.aborted) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastError ?? new Error('模型没有返回可用结果');
  }

  private async requestOnce(
    req: LlmExplainRequest,
    model: string,
    onProgress: (chars: number) => void,
    signal: AbortSignal,
    attempt: number
  ): Promise<Explanation> {
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        stream: true,
        // 必须与 format 同时给：qwen3.5 是 hybrid thinking，
        // 开着 think 时推理链会占满 num_predict，content 直接返回空。
        think: false,
        keep_alive: '10m',
        format: EXPLANATION_SCHEMA,
        options: {
          temperature: attempt === 0 ? 0.2 : 0,
          num_predict: 400,
          num_ctx: 2048,
        },
        messages: buildMessages(req),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Ollama 返回 ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}`);
    }
    if (!response.body) throw new Error('Ollama 响应没有可读流');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let streamError = '';

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let chunk: OllamaChatChunk;
      try {
        chunk = JSON.parse(line) as OllamaChatChunk;
      } catch {
        return;
      }
      if (chunk.error) {
        streamError = chunk.error;
        return;
      }
      // think:false 下 thinking 应为空；万一有，丢弃不进 content
      const delta = chunk.message?.content;
      if (delta) {
        content += delta;
        onProgress(content.length);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        handleLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
      }
    }
    handleLine(buffer);

    if (streamError) throw new Error(`Ollama 流式错误：${streamError}`);
    if (!content.trim()) {
      throw new Error('模型返回为空（可能是 thinking 模式未被关闭）');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('模型返回的不是合法 JSON');
    }
    if (!isExplanation(parsed)) {
      throw new Error('模型返回的 JSON 不符合约定结构');
    }
    return parsed;
  }
}

class BundledProvider {
  async status(): Promise<LlmStatus> {
    return {
      available: false,
      provider: 'bundled',
      model: null,
      installed: [],
      vramMB: null,
      reason: '内置推理运行时将在下个版本提供',
    };
  }
}

export class LlmEngine {
  private ollama = new OllamaProvider();
  private bundled = new BundledProvider();
  private inFlight = new Map<string, AbortController>();

  async status(provider: 'ollama' | 'bundled', tier: LlmModelTier): Promise<LlmStatus> {
    if (provider === 'bundled') return this.bundled.status();
    return this.ollama.status(tier);
  }

  async explain(
    requestId: string,
    req: LlmExplainRequest,
    tier: LlmModelTier,
    onProgress: (chars: number) => void
  ): Promise<Explanation> {
    const controller = new AbortController();
    this.inFlight.set(requestId, controller);

    try {
      const status = await this.ollama.status(tier);
      if (!status.available || !status.model) {
        throw new Error(status.reason || '本地模型不可用');
      }
      return await this.ollama.explain(req, status.model, onProgress, controller.signal);
    } finally {
      this.inFlight.delete(requestId);
    }
  }

  cancel(requestId: string) {
    const controller = this.inFlight.get(requestId);
    if (!controller) return;
    controller.abort();
    this.inFlight.delete(requestId);
  }

  /** 窗口关闭 / 应用退出时清干净在途请求 */
  abortAll() {
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
  }
}

export const llmEngine = new LlmEngine();
