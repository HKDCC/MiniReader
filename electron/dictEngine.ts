import path from 'path';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import type {
  DictEntry,
  DisplayEntry,
  SpanResolution,
  SpanToken,
} from '../src/shared/dictTypes';
import {
  classifySpan,
  compactKey,
  isParticle,
  normalizeSpan,
  spanCacheKey,
  stripPossessive,
  tokenizeSpan,
} from '../src/shared/spanText';

export type { DictEntry };

const MAX_SPAN_INPUT = 200;
const SPAN_CACHE_LIMIT = 500;

export class DictEngine {
  private db: DatabaseSync | null = null;
  private stmtLookupWord: any = null;
  private stmtLookupSw: any = null;
  private dbPath: string | null = null;
  private spanCache = new Map<string, SpanResolution>();

  constructor() {
    this.initDatabase();
  }

  public initDatabase(): boolean {
    if (this.db) return true;

    const candidatePaths = [
      path.join(process.resourcesPath || '', 'dict', 'stardict.db'),
      path.join(process.resourcesPath || '', 'dict', 'ecdict.db'),
      path.join(__dirname, '..', 'resources', 'dict', 'stardict.db'),
      path.join(__dirname, '..', 'resources', 'dict', 'ecdict.db'),
      path.join(__dirname, '..', '..', 'resources', 'dict', 'stardict.db'),
      path.join(__dirname, '..', '..', 'resources', 'dict', 'ecdict.db'),
      'D:\\MiniReader\\resources\\dict\\stardict.db',
      'D:\\MiniReader\\resources\\dict\\ecdict.db',
      'D:\\MiniReader\\Mini Reader\\resources\\dict\\stardict.db',
      'D:\\MiniReader\\Mini Reader\\resources\\dict\\ecdict.db',
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          this.db = new DatabaseSync(p, { readOnly: true });
          this.dbPath = p;
          console.log(`[DictEngine] Loaded dictionary database from: ${p}`);
          this.prepareStatements();
          return true;
        } catch (err) {
          console.warn(`[DictEngine] Failed to open ${p}:`, err);
        }
      }
    }

    return false;
  }

  private prepareStatements() {
    if (!this.db) return;
    try {
      this.stmtLookupWord = this.db.prepare('SELECT * FROM stardict WHERE word = ? LIMIT 1');
      this.stmtLookupSw = this.db.prepare('SELECT * FROM stardict WHERE sw = ? LIMIT 1');
    } catch (e) {
      console.warn('[DictEngine] Error preparing statements:', e);
    }
  }

  public isAvailable(): boolean {
    if (!this.db) {
      this.initDatabase();
    }
    return !!this.db;
  }

  public lookup(rawWord: string): DictEntry | null {
    if (!this.isAvailable() || !rawWord) return null;
    const clean = rawWord.trim();
    if (!clean) return null;

    try {
      // 1. Exact match
      let row = this.stmtLookupWord?.get(clean) as DictEntry | undefined;
      if (row) return row;

      // 2. Lowercase match
      const lower = clean.toLowerCase();
      row = this.stmtLookupWord?.get(lower) as DictEntry | undefined;
      if (row) return row;

      // 3. Search-word (sw) match
      row = this.stmtLookupSw?.get(lower) as DictEntry | undefined;
      if (row) return row;

      return null;
    } catch (e) {
      console.error('[DictEngine] Lookup error:', e);
      return null;
    }
  }

  /** 直接按 ECDICT 的去空格归一形式查（多词短语专用）。 */
  private lookupByCompactKey(compact: string): DictEntry | null {
    if (!compact || !this.isAvailable()) return null;
    try {
      const row = this.stmtLookupSw?.get(compact) as DictEntry | undefined;
      return row ?? null;
    } catch (e) {
      console.error('[DictEngine] Compact lookup error:', e);
      return null;
    }
  }

  public lemmatize(rawWord: string): string {
    const entry = this.lookup(rawWord);
    if (!entry) return rawWord.toLowerCase();
    return this.rootFromExchange(entry.exchange) ?? entry.word.toLowerCase();
  }

  // ---------------------------------------------------------------------
  // Span resolution：一次 IPC 回答「这段选中的文字到底是什么」。
  // 级联顺序：归一化 → 整串(词/短语) → 省略号短语 → 逐词回退。
  // 全程只走 word / sw 索引，禁止 LIKE 与全表扫描。
  // ---------------------------------------------------------------------

  public resolveSpan(raw: string): SpanResolution {
    const input = typeof raw === 'string' ? raw : '';
    const normalized = normalizeSpan(input.slice(0, MAX_SPAN_INPUT));

    if (!normalized) {
      return this.emptyResolution(input, '');
    }

    const cacheKey = spanCacheKey(normalized);
    const cached = this.spanCache.get(cacheKey);
    if (cached) return cached;

    const resolution = this.computeResolution(input, normalized);
    this.cacheResolution(cacheKey, resolution);
    return resolution;
  }

  private computeResolution(raw: string, normalized: string): SpanResolution {
    const tokens = tokenizeSpan(normalized);

    if (tokens.length === 0) {
      return this.emptyResolution(raw, normalized);
    }

    // 单词：直接走 lookupWordResolved（内部已含 exact → 小写 → sw → 所有格回退）
    if (tokens.length === 1) {
      const token = this.lookupWordResolved(tokens[0]);
      return {
        raw,
        normalized,
        kind: 'word',
        primary: token.entry,
        primaryLemma: token.hit ? token.lemma : null,
        primaryLemmaEntry: token.lemmaEntry,
        tokens: [token],
        missedTokens: token.hit ? [] : [token.text],
      };
    }

    // 多词：先试整串。5 词以上的固定表达（谚语 / 习语）也能命中，
    // 成本只是一次索引查询，比事后拼接更可信。
    // sw 是去空格归一形式（"run out of" → "runoutof"），lookup() 只会拿带空格的
    // 原文去比对 sw，所以多词必须再单独试一次 compactKey。
    const whole = this.lookup(normalized) ?? this.lookupByCompactKey(compactKey(normalized));
    if (whole) {
      return this.buildWithPrimary(raw, normalized, whole, tokens);
    }

    const kind = classifySpan(tokens.length);
    if (kind === 'sentence') {
      return {
        raw,
        normalized,
        kind,
        primary: null,
        primaryLemma: null,
        primaryLemmaEntry: null,
        tokens: [],
        missedTokens: [],
      };
    }

    // 省略号词条：ECDICT 用 "break ... down" 记录可插入宾语的动词短语
    const pattern = this.matchEllipsisPattern(tokens);
    if (pattern) {
      const row = this.lookup(pattern);
      if (row) {
        return this.buildWithPrimary(raw, normalized, row, tokens, pattern);
      }
    }

    const resolved = tokens.map((token) => this.lookupWordResolved(token));
    return {
      raw,
      normalized,
      kind: 'phrase',
      primary: null,
      primaryLemma: null,
      primaryLemmaEntry: null,
      tokens: resolved,
      missedTokens: resolved.filter((token) => !token.hit).map((token) => token.text),
    };
  }

  /**
   * 两词短语且尾词是小品词时才尝试省略号词条。
   * 先试原形，再试词根 —— "hurled down" 要能找到 "hurl ... down"。
   */
  private matchEllipsisPattern(tokens: string[]): string | null {
    if (tokens.length !== 2 || !isParticle(tokens[1])) return null;

    const head = tokens[0];
    const headToken = this.lookupWordResolved(head);
    const candidates = [`${head} ... ${tokens[1]}`];

    if (headToken.lemma && headToken.lemma !== head.toLowerCase()) {
      candidates.push(`${headToken.lemma} ... ${tokens[1]}`);
      candidates.push(`${headToken.lemma} ${tokens[1]}`);
    }

    for (const candidate of candidates) {
      if (this.lookup(candidate)) return candidate;
    }
    return null;
  }

  private buildWithPrimary(
    raw: string,
    normalized: string,
    row: DictEntry,
    tokens: string[],
    matchedPattern?: string
  ): SpanResolution {
    const primary = this.toDisplayEntry(row);
    const canonical = row.word.toLowerCase();
    const lemma = this.rootFromExchange(row.exchange) ?? canonical;
    const lemmaRow = lemma === canonical ? row : this.lookup(lemma);
    const resolved = tokens.map((token) => this.lookupWordResolved(token));

    return {
      raw,
      normalized,
      kind: 'phrase',
      primary,
      primaryLemma: lemma,
      primaryLemmaEntry: lemmaRow ? this.toDisplayEntry(lemmaRow) : null,
      tokens: resolved,
      missedTokens: resolved.filter((token) => !token.hit).map((token) => token.text),
      matchedPattern,
    };
  }

  private lookupWordResolved(token: string): SpanToken {
    const row = this.resolveEntry(token);
    if (!row) {
      return {
        text: token,
        entry: null,
        lemma: token.toLowerCase(),
        lemmaEntry: null,
        hit: false,
      };
    }

    const canonical = row.word.toLowerCase();
    const lemma = this.rootFromExchange(row.exchange) ?? canonical;
    const lemmaRow = lemma === canonical ? row : this.lookup(lemma);

    return {
      text: token,
      entry: this.toDisplayEntry(row),
      lemma,
      lemmaEntry: lemmaRow ? this.toDisplayEntry(lemmaRow) : null,
      hit: true,
    };
  }

  /** lookup + 所有格回退。只在原串确实查不到时才剥 's，避免把 it's 查成 it。 */
  private resolveEntry(token: string): DictEntry | null {
    const direct = this.lookup(token);
    if (direct) return direct;

    const stem = stripPossessive(token);
    if (stem) return this.lookup(stem);

    return null;
  }

  private rootFromExchange(exchange?: string): string | null {
    if (!exchange) return null;
    for (const part of exchange.split('/')) {
      if (part.startsWith('0:') || part.startsWith('1:')) {
        const root = part.slice(2).trim();
        if (root) return root.toLowerCase();
      }
    }
    return null;
  }

  private toDisplayEntry(row: DictEntry): DisplayEntry {
    return {
      word: row.word,
      phonetic: row.phonetic,
      definition: row.definition,
      translation: row.translation,
      pos: row.pos,
      tag: row.tag,
      collins: row.collins,
      exchange: row.exchange,
      oxford: row.oxford,
      bnc: row.bnc,
      frq: row.frq,
    };
  }

  private emptyResolution(raw: string, normalized: string): SpanResolution {
    return {
      raw,
      normalized,
      kind: 'word',
      primary: null,
      primaryLemma: null,
      primaryLemmaEntry: null,
      tokens: [],
      missedTokens: [],
    };
  }

  private cacheResolution(key: string, resolution: SpanResolution) {
    if (this.spanCache.size >= SPAN_CACHE_LIMIT) {
      const oldest = this.spanCache.keys().next().value;
      if (oldest !== undefined) this.spanCache.delete(oldest);
    }
    this.spanCache.set(key, resolution);
  }

  public batchLookup(words: string[]): Record<string, DictEntry> {
    const result: Record<string, DictEntry> = {};
    if (!this.isAvailable() || !Array.isArray(words) || !this.db) return result;

    const uniqueWords = Array.from(
      new Set(
        words
          .map((w) => (typeof w === 'string' ? w.trim().toLowerCase() : ''))
          .filter((w) => w && w.length >= 2)
      )
    );

    if (uniqueWords.length === 0) return result;

    // Batch query in chunks of up to 400 parameters using SQLite indexed IN clause
    const CHUNK_SIZE = 400;
    for (let i = 0; i < uniqueWords.length; i += CHUNK_SIZE) {
      const chunk = uniqueWords.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      try {
        const stmt = this.db.prepare(
          `SELECT * FROM stardict WHERE word IN (${placeholders}) COLLATE NOCASE`
        );
        const rows = stmt.all(...chunk) as unknown as DictEntry[];
        for (const row of rows) {
          if (row?.word) {
            result[row.word.toLowerCase()] = row;
          }
        }
      } catch (err) {
        console.warn('[DictEngine] Batch lookup chunk error:', err);
      }
    }

    // For words not found by exact word, try standard lookup (handles sw, etc.)
    for (const w of uniqueWords) {
      if (!result[w]) {
        const fallback = this.lookup(w);
        if (fallback) {
          result[w] = fallback;
        }
      }
    }

    // Inherit tag & collins from lemma/root for inflected forms (e.g. games -> game, campaigns -> campaign)
    const rootsToFetch: string[] = [];
    for (const [w, entry] of Object.entries(result)) {
      if ((!entry.tag && !entry.collins) && entry.exchange) {
        const root = this.lemmatize(w);
        if (root && root !== w && !result[root]) {
          rootsToFetch.push(root);
        }
      }
    }

    if (rootsToFetch.length > 0) {
      for (let i = 0; i < rootsToFetch.length; i += CHUNK_SIZE) {
        const chunk = rootsToFetch.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        try {
          const stmt = this.db.prepare(
            `SELECT * FROM stardict WHERE word IN (${placeholders}) COLLATE NOCASE`
          );
          const rows = stmt.all(...chunk) as unknown as DictEntry[];
          for (const row of rows) {
            if (row?.word) {
              result[row.word.toLowerCase()] = row;
            }
          }
        } catch {}
      }

      for (const [w, entry] of Object.entries(result)) {
        if ((!entry.tag && !entry.collins) && entry.exchange) {
          const root = this.lemmatize(w);
          const parent = result[root];
          if (parent) {
            if (!entry.tag && parent.tag) entry.tag = parent.tag;
            if (!entry.collins && parent.collins) entry.collins = parent.collins;
            if (!entry.oxford && parent.oxford) entry.oxford = parent.oxford;
          }
        }
      }
    }

    return result;
  }
}

export const dictEngine = new DictEngine();
