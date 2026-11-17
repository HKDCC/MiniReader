import { db } from '../db/db';
import type { SpanResolution } from '../shared/dictTypes';
import type {
  Explanation,
  LlmExplainRequest,
  LlmModelTier,
  LlmStatus,
} from '../shared/llmTypes';
import { PROMPT_VERSION, isExplanation } from '../shared/llmTypes';

const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 3000;

interface PendingRequest {
  resolve: (value: Explanation) => void;
  reject: (reason: Error) => void;
  onProgress?: (chars: number) => void;
}

function splitLines(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n|\\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

class LlmService {
  private pending = new Map<string, PendingRequest>();
  private activeRequestId: string | null = null;
  private listenersBound = false;

  private ensureListeners() {
    if (this.listenersBound) return;
    const api = typeof window !== 'undefined' ? (window as any).electron : undefined;
    if (!api?.on) return;

    api.on('llm:delta', (payload: { requestId: string; chars: number }) => {
      if (!payload?.requestId) return;
      this.pending.get(payload.requestId)?.onProgress?.(payload.chars ?? 0);
    });

    api.on('llm:done', (payload: { requestId: string; result: Explanation }) => {
      const entry = payload?.requestId ? this.pending.get(payload.requestId) : undefined;
      if (!entry) return;
      this.pending.delete(payload.requestId);
      if (isExplanation(payload.result)) {
        entry.resolve(payload.result);
      } else {
        entry.reject(new Error('模型返回的结构不完整'));
      }
    });

    api.on('llm:error', (payload: { requestId: string; message: string }) => {
      const entry = payload?.requestId ? this.pending.get(payload.requestId) : undefined;
      if (!entry) return;
      this.pending.delete(payload.requestId);
      entry.reject(new Error(payload.message || '本地模型调用失败'));
    });

    this.listenersBound = true;
  }

  public async status(tier: LlmModelTier): Promise<LlmStatus> {
    const api = typeof window !== 'undefined' ? (window as any).electron : undefined;
    if (!api?.invoke) {
      return {
        available: false,
        provider: 'ollama',
        model: null,
        installed: [],
        vramMB: null,
        reason: '仅在桌面端可用',
      };
    }
    try {
      return (await api.invoke('llm:status', { provider: 'ollama', tier })) as LlmStatus;
    } catch (err) {
      return {
        available: false,
        provider: 'ollama',
        model: null,
        installed: [],
        vramMB: null,
        reason: err instanceof Error ? err.message : '探测失败',
      };
    }
  }

  /**
   * 取解释。命中缓存直接返回，不发请求。
   *
   * 缓存 key 刻意不含 model：换成 4B 之后仍能复用 9B 生成过的结果，
   * 更重要的是离线（Ollama 没开）时缓存依然可用 —— 阅读场景里这比可复现性重要。
   * model 仅作为记录字段保留，便于排查。
   */
  public async explain(
    request: LlmExplainRequest,
    tier: LlmModelTier,
    onProgress?: (chars: number) => void
  ): Promise<Explanation> {
    const api = typeof window !== 'undefined' ? (window as any).electron : undefined;
    if (!api?.invoke) throw new Error('仅在桌面端可用');

    const cacheKey = this.buildCacheKey(request.span, request.context);
    const cached = await this.readCache(cacheKey);
    if (cached) {
      onProgress?.(cached.meaningZh.length);
      return cached;
    }

    this.ensureListeners();

    const { requestId } = (await api.invoke('llm:explain', {
      request,
      tier,
    })) as { requestId: string };

    if (!requestId) throw new Error('未能发起解释请求');
    this.activeRequestId = requestId;

    const result = await new Promise<Explanation>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => {
          this.activeRequestId = null;
          resolve(value);
        },
        reject: (reason) => {
          this.activeRequestId = null;
          reject(reason);
        },
        onProgress,
      });
    });

    void this.writeCache(cacheKey, request, result, tier);
    return result;
  }

  /** 取消当前在途请求（词卡只有一张，不需要按 id 取消） */
  public cancelActive() {
    if (this.activeRequestId) this.cancel(this.activeRequestId);
  }

  public cancel(requestId: string) {
    const api = typeof window !== 'undefined' ? (window as any).electron : undefined;
    api?.invoke?.('llm:cancel', requestId).catch(() => undefined);
    const entry = this.pending.get(requestId);
    if (entry) {
      this.pending.delete(requestId);
      entry.reject(new Error('已取消'));
    }
  }

  /** 词典已有结果摘要，给模型当事实锚点，避免它推翻确定信息 */
  public buildRuleSummary(resolution: SpanResolution | null): string {
    if (!resolution) return '';

    const describe = (label: string, lines: string[], lemma?: string) => {
      const gloss = lines[0] || '';
      if (!gloss) return '';
      const tail = lemma ? `（词根 ${lemma}）` : '';
      return `${label}：${gloss}${tail}`;
    };

    const parts: string[] = [];

    if (resolution.primary) {
      const gloss = splitLines(resolution.primary.translation)[0];
      const english = splitLines(resolution.primary.definition)[0];
      parts.push(
        describe(
          `整串「${resolution.primary.word}」`,
          [gloss || english]
        )
      );
    }

    for (const token of resolution.tokens) {
      if (!token.hit) {
        parts.push(`${token.text}：词典未收录`);
        continue;
      }
      const gloss = splitLines(token.entry?.translation)[0];
      const lemma = token.lemma !== token.text.toLowerCase() ? token.lemma : undefined;
      parts.push(describe(token.text, [gloss || ''], lemma));
    }

    return parts.filter(Boolean).join('；').slice(0, 400);
  }

  private buildCacheKey(span: string, context: string): string {
    return [PROMPT_VERSION, span, context].join('\u0000');
  }

  private async readCache(key: string): Promise<Explanation | null> {
    try {
      const record = await db.llmCache.get(key);
      if (!record) return null;
      if (Date.now() - record.createdAt > CACHE_TTL_MS) {
        void db.llmCache.delete(key);
        return null;
      }
      return record.result;
    } catch {
      return null;
    }
  }

  private async writeCache(
    key: string,
    request: LlmExplainRequest,
    result: Explanation,
    tier: LlmModelTier
  ) {
    try {
      await db.llmCache.put({
        key,
        span: request.span,
        context: request.context,
        model: tier,
        result,
        createdAt: Date.now(),
      });
      void this.pruneCache();
    } catch {
      // 缓存失败不影响主流程
    }
  }

  private async pruneCache() {
    try {
      const count = await db.llmCache.count();
      if (count <= CACHE_LIMIT) return;
      const stale = await db.llmCache.orderBy('createdAt').limit(count - CACHE_LIMIT).primaryKeys();
      if (stale.length) await db.llmCache.bulkDelete(stale);
    } catch {
      // 忽略
    }
  }
}

export const llmService = new LlmService();
