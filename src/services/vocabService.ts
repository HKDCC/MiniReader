import { db, VocabWord, VocabSettings } from '../db/db';
import type { DictEntry, SpanResolution } from '../shared/dictTypes';
import { normalizeSpan, spanCacheKey } from '../shared/spanText';

export type { DictEntry, SpanResolution };

export type BaseProficiencyLevel = 'middle_school' | 'high_school' | 'cet4' | 'cet6' | 'toefl' | 'gre';

const PROFICIENCY_CONFIGS: Record<BaseProficiencyLevel, { label: string; desc: string }> = {
  middle_school: { label: '中考 / 初中基础', desc: '掌握初中 2,000 基础词，高中及以上词汇着色' },
  high_school: { label: '高考核心词', desc: '掌握高中 3,500 核心词，四级及以上词汇着色' },
  cet4: { label: '大学英语四级 (CET-4)', desc: '掌握四级 4,500 核心词，推荐大部分进阶读者' },
  cet6: { label: '大学英语六级 (CET-6)', desc: '掌握六级 6,000 词，仅考研/托福/GRE 难词着色' },
  toefl: { label: '托福 / 雅思 / 考研', desc: '掌握 8,000+ 词汇，仅文学与高级罕见词着色' },
  gre: { label: 'GRE / 母语级词汇', desc: '全书极少着色，仅生僻冷门词提醒' },
};

/**
 * 熟练度配色：回到 5 级色相区分（热→冷 = 难→易）。
 *
 * 之所以现在可以放心用色相：笔记已经改用手绘**下划线**，让出了背景通道。
 * 背景=熟练度、下划线=笔记，两条通道互不覆盖，同一个词可以同时看到两种信息。
 */
export const LEVEL_COLORS: Record<number, { bg: string; text: string; label: string; badge: string }> = {
  1: {
    bg: 'rgba(239, 68, 68, 0.30)', // 红：最陌生
    text: '#B91C1C',
    label: '1 陌生',
    badge: 'bg-red-500/15 text-red-600 border-red-500/30',
  },
  2: {
    bg: 'rgba(249, 115, 22, 0.26)', // 橙
    text: '#C2410C',
    label: '2 模糊',
    badge: 'bg-orange-500/15 text-orange-600 border-orange-500/30',
  },
  3: {
    bg: 'rgba(250, 204, 21, 0.26)', // 黄
    text: '#A16207',
    label: '3 认识',
    badge: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30',
  },
  4: {
    bg: 'rgba(52, 211, 153, 0.18)', // 青绿：快掌握了
    text: '#047857',
    label: '4 熟悉',
    badge: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  },
  5: {
    bg: 'transparent', // 掌握：不留底色
    text: 'inherit',
    label: '5 掌握',
    badge: 'bg-transparent text-inherit border-current/15',
  },
};

class VocabService {
  private memoryDictCache = new Map<string, DictEntry | null>();
  private memorySpanCache = new Map<string, SpanResolution>();
  private memoryLemmaCache = new Map<string, string>();
  private defaultLevelCache = new Map<string, number>();
  private currentBaseLevel: BaseProficiencyLevel | null = null;

  public getProficiencyConfigs() {
    return PROFICIENCY_CONFIGS;
  }

  public clearLevelCache() {
    this.defaultLevelCache.clear();
    this.currentBaseLevel = null;
  }

  public async getSettings(): Promise<VocabSettings> {
    const existing = await db.vocabSettings.get('global');
    if (existing) return existing;
    const defaultSettings: VocabSettings = {
      id: 'global',
      baseLevel: 'cet4',
      intensiveModeEnabled: true,
      highlightStyle: 'background',
      definitionMode: 'both',
      llmEnabled: false,
      llmModelTier: 'auto',
    };
    await db.vocabSettings.put(defaultSettings);
    return defaultSettings;
  }

  public async updateSettings(updates: Partial<VocabSettings>): Promise<void> {
    const current = await this.getSettings();
    if (updates.baseLevel && updates.baseLevel !== current.baseLevel) {
      this.clearLevelCache();
    }
    await db.vocabSettings.put({ ...current, ...updates, id: 'global' });
  }

  public async isDictAvailable(): Promise<boolean> {
    if (typeof window !== 'undefined' && (window as any).electron?.invoke) {
      try {
        const res = await (window as any).electron.invoke('dict:status');
        return !!res?.available;
      } catch {
        return false;
      }
    }
    return false;
  }

  public async lookup(word: string): Promise<DictEntry | null> {
    if (!word) return null;
    const clean = word.trim().toLowerCase();
    if (this.memoryDictCache.has(clean)) {
      return this.memoryDictCache.get(clean) ?? null;
    }

    const invoke = typeof window !== 'undefined' ? (window as any).electron?.invoke : undefined;
    if (typeof invoke !== 'function') return null;

    let entry: DictEntry | null;
    try {
      entry = (await invoke('dict:lookup', clean)) as DictEntry | null;
    } catch (err) {
      // IPC 抖动 / 主进程未就绪：不写缓存，否则本次会话该词会永久显示“暂无释义”。
      console.warn('IPC dict:lookup failed', err);
      return null;
    }

    this.memoryDictCache.set(clean, entry ?? null);
    return entry ?? null;
  }

  /**
   * 一次性解析任意长度的选中文本（单词 / 短语 / 整句）。
   * 取代原来「lookup + lemmatize 两次 IPC」的做法。
   */
  public async resolveSpan(raw: string): Promise<SpanResolution> {
    const normalized = normalizeSpan(typeof raw === 'string' ? raw : '');
    const key = spanCacheKey(normalized);

    const cached = this.memorySpanCache.get(key);
    if (cached) return cached;

    const invoke = typeof window !== 'undefined' ? (window as any).electron?.invoke : undefined;
    if (typeof invoke !== 'function') {
      return {
        raw: typeof raw === 'string' ? raw : '',
        normalized,
        kind: 'word',
        primary: null,
        primaryLemma: null,
        primaryLemmaEntry: null,
        tokens: [],
        missedTokens: [],
      };
    }

    try {
      const res = (await invoke('dict:resolve-span', raw)) as SpanResolution | null;
      if (!res) throw new Error('empty resolution');
      if (res.primary) {
        this.memoryDictCache.set(res.normalized.toLowerCase(), res.primary);
      }
      this.memorySpanCache.set(key, res);
      return res;
    } catch (err) {
      // 失败不缓存，下次点击会重试。
      console.warn('IPC dict:resolve-span failed', err);
      return {
        raw: typeof raw === 'string' ? raw : '',
        normalized,
        kind: 'word',
        primary: null,
        primaryLemma: null,
        primaryLemmaEntry: null,
        tokens: [],
        missedTokens: [],
      };
    }
  }

  public async lemmatize(word: string): Promise<string> {
    if (!word) return '';
    const clean = word.trim().toLowerCase();
    if (this.memoryLemmaCache.has(clean)) {
      return this.memoryLemmaCache.get(clean)!;
    }

    let lemma = clean;
    if (typeof window !== 'undefined' && (window as any).electron?.invoke) {
      try {
        lemma = (await (window as any).electron.invoke('dict:lemmatize', clean)) || clean;
      } catch {
        lemma = clean;
      }
    } else {
      const entry = await this.lookup(clean);
      if (entry?.exchange) {
        const parts = entry.exchange.split('/');
        for (const p of parts) {
          if (p.startsWith('0:') || p.startsWith('1:')) {
            lemma = p.slice(2).trim().toLowerCase() || clean;
            break;
          }
        }
      }
    }

    this.memoryLemmaCache.set(clean, lemma);
    return lemma;
  }

  public async batchLookup(words: string[]): Promise<Record<string, DictEntry>> {
    if (!Array.isArray(words) || words.length === 0) return {};

    const needed: string[] = [];
    const result: Record<string, DictEntry> = {};

    for (const w of words) {
      const clean = w.trim().toLowerCase();
      if (!clean) continue;
      if (this.memoryDictCache.has(clean)) {
        const cached = this.memoryDictCache.get(clean);
        if (cached) result[clean] = cached;
      } else {
        needed.push(clean);
      }
    }

    if (needed.length > 0 && typeof window !== 'undefined' && (window as any).electron?.invoke) {
      try {
        const fetched = (await (window as any).electron.invoke('dict:batch-lookup', needed)) as Record<string, DictEntry>;
        for (const [k, v] of Object.entries(fetched || {})) {
          this.memoryDictCache.set(k, v);
          result[k] = v;
        }
        for (const k of needed) {
          if (!this.memoryDictCache.has(k)) {
            this.memoryDictCache.set(k, null);
          }
        }
      } catch (err) {
        console.warn('Batch lookup failed', err);
      }
    }

    return result;
  }

  /**
   * Get default proficiency levels (1-5) for a list of words, using local in-memory cache and ECDICT batch lookup
   */
  public async getDefaultLevels(words: string[]): Promise<Record<string, number>> {
    if (!Array.isArray(words) || words.length === 0) return {};

    const settings = await this.getSettings();
    const baseLevel = settings.baseLevel || 'cet4';

    if (this.currentBaseLevel !== baseLevel) {
      this.defaultLevelCache.clear();
      this.currentBaseLevel = baseLevel;
    }

    const result: Record<string, number> = {};
    const uncached: string[] = [];

    for (const w of words) {
      const clean = w.trim().toLowerCase();
      if (!clean || clean.length < 2) continue;
      if (this.defaultLevelCache.has(clean)) {
        result[clean] = this.defaultLevelCache.get(clean)!;
      } else {
        uncached.push(clean);
      }
    }

    if (uncached.length > 0) {
      const entries = await this.batchLookup(uncached);
      for (const w of uncached) {
        const entry = entries[w] || null;
        const lvl = this.calculateDefaultLevel(entry, baseLevel);
        this.defaultLevelCache.set(w, lvl);
        result[w] = lvl;
      }
    }

    return result;
  }

  /**
   * Calculate default proficiency level (1-5) for a word based on ECDICT tags & user baseLevel
   */
  public calculateDefaultLevel(entry: DictEntry | null, baseLevel: BaseProficiencyLevel): number {
    // If not in ECDICT (names, brand names, numbers, or slang not found), default to 5 so page stays clean
    if (!entry) return 5;

    const tags = (entry.tag || '').toLowerCase().split(/\s+/);
    const collins = entry.collins || 0;
    const oxford = entry.oxford || 0;
    const bnc = entry.bnc || 0;
    const frq = entry.frq || 0;

    const isZk = tags.includes('zk');
    const isGk = tags.includes('gk');
    const isCet4 = tags.includes('cet4');
    const isCet6 = tags.includes('cet6');
    const isKy = tags.includes('ky');
    const isToefl = tags.includes('toefl') || tags.includes('ielts');
    const isGre = tags.includes('gre');
    const isTopCore = oxford === 1 || (frq > 0 && frq <= 3000) || (bnc > 0 && bnc <= 3000);

    // Common stop words and high frequency vocabulary are always clean
    if (isTopCore && collins >= 3) return 5;

    switch (baseLevel) {
      case 'middle_school':
        if (isZk || (collins >= 5 && isTopCore)) return 5;
        if (isGk || collins === 4) return 4;
        if (isCet4 || collins === 3) return 3;
        if (isCet6 || isKy || collins === 2) return 2;
        return 1;

      case 'high_school':
        if (isZk || isGk || (collins >= 4 && isTopCore)) return 5;
        if (isCet4 || collins === 3) return 4;
        if (isCet6 || isKy || collins === 2) return 3;
        if (isToefl || collins === 1) return 2;
        return 1;

      case 'cet4':
      default:
        if (isZk || isGk || isCet4 || collins >= 3 || isTopCore) return 5;
        if (isCet6 || collins === 2) return 4;
        if (isKy || isToefl) return 3;
        if (collins === 1) return 2;
        return 1;

      case 'cet6':
        if (isZk || isGk || isCet4 || isCet6 || collins >= 2 || isTopCore) return 5;
        if (isKy || isToefl) return 4;
        if (collins === 1) return 3;
        if (isGre) return 2;
        return 1;

      case 'toefl':
        if (isZk || isGk || isCet4 || isCet6 || isKy || isToefl || collins >= 1 || isTopCore) return 5;
        if (isGre) return 3;
        return 2;

      case 'gre':
        if (isGre) return 4;
        return 5;
    }
  }

  /**
   * Save or update vocabulary word rating (1-5) and sync lemma
   */
  public async setWordLevel(params: {
    word: string;
    lemma: string;
    level: number;
    translation?: string;
    phonetic?: string;
    tags?: string;
    collins?: number;
    isPhrase?: boolean;
    contextSentence?: string;
    bookId?: string;
  }): Promise<void> {
    const { word, lemma, level } = params;
    const cleanWord = word.trim().toLowerCase();
    const cleanLemma = (lemma || cleanWord).trim().toLowerCase();
    const now = Date.now();

    // Find any existing record by lemma or word
    const existingLemmaRecord = await db.vocab.where('lemma').equals(cleanLemma).first();

    if (existingLemmaRecord && existingLemmaRecord.id) {
      await db.vocab.update(existingLemmaRecord.id, {
        level,
        word: cleanWord,
        translation: params.translation ?? existingLemmaRecord.translation,
        phonetic: params.phonetic ?? existingLemmaRecord.phonetic,
        tags: params.tags ?? existingLemmaRecord.tags,
        collins: params.collins ?? existingLemmaRecord.collins,
        isPhrase: params.isPhrase ?? existingLemmaRecord.isPhrase,
        contextSentence: params.contextSentence ?? existingLemmaRecord.contextSentence,
        reviewCount: (existingLemmaRecord.reviewCount || 0) + 1,
        lastSeenAt: now,
      });
    } else {
      await db.vocab.add({
        word: cleanWord,
        lemma: cleanLemma,
        level,
        translation: params.translation,
        phonetic: params.phonetic,
        tags: params.tags,
        collins: params.collins,
        isPhrase: !!params.isPhrase,
        contextSentence: params.contextSentence,
        bookId: params.bookId,
        reviewCount: 1,
        lastSeenAt: now,
        addedAt: now,
      });
    }
  }

  /**
   * Export vocabulary list as Anki TSV/CSV format
   */
  public generateAnkiExport(words: VocabWord[]): string {
    const headers = ['#Front (Word)', 'Phonetic', 'Back (Translation)', 'Tags', 'Level', 'Context', 'Lemma'];
    const lines = [headers.join('\t')];

    for (const item of words) {
      const cleanWord = item.word.replace(/\t/g, ' ');
      const phonetic = item.phonetic ? `[${item.phonetic}]` : '';
      const translation = (item.translation || '').replace(/\r?\n/g, '<br>').replace(/\t/g, ' ');
      const tags = item.tags || '';
      const level = `Level ${item.level}`;
      const context = (item.contextSentence || '').replace(/\r?\n/g, ' ').replace(/\t/g, ' ');
      const lemma = item.lemma || item.word;

      lines.push([cleanWord, phonetic, translation, tags, level, context, lemma].join('\t'));
    }

    return lines.join('\n');
  }

  /**
   * Play word pronunciation via Web Speech API
   */
  public speak(text: string): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error', e);
    }
  }
}

export const vocabService = new VocabService();
