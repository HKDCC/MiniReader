import Dexie, { Table } from 'dexie';
import type { Explanation, LlmModelTier } from '../shared/llmTypes';

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  cover?: string;
  format: 'txt' | 'epub' | 'pdf';
  contentHash?: string;
  progress: number;
  cfi?: string;
  addedAt: number;
  lastReadAt: number;
  sortOrder: number;
}

export interface BookContent {
  id: string;
  data: string | ArrayBuffer;
}

export interface Note {
  id?: number;
  bookId: string;
  text: string;
  note: string;
  color: string;
  cfi: string;
  createdAt: number;
}

export interface VocabWord {
  id?: number;
  word: string;         // lowercase or exact word form
  lemma: string;        // canonical root lemma
  level: number;        // 1 to 5 (1: 陌生, 2: 模糊, 3: 认识, 4: 熟悉, 5: 掌握)
  translation?: string; // brief Chinese translation
  phonetic?: string;    // phonetic transcription
  tags?: string;        // exam tags, e.g. "zk gk cet4 cet6 toefl gre"
  collins?: number;     // Collins star rating (1-5)
  isPhrase?: boolean;   // true if phrase / idiom
  contextSentence?: string; // context snippet
  bookId?: string;      // book id
  reviewCount: number;  // lookup / review count
  lastSeenAt: number;   // timestamp
  addedAt: number;      // timestamp
}

/** 词卡释义显示方式：仅英中 / 仅英英 / 中英对照 */
export type DefinitionMode = 'zh' | 'en' | 'both';

export interface VocabSettings {
  id: string; // 'global'
  baseLevel: 'middle_school' | 'high_school' | 'cet4' | 'cet6' | 'toefl' | 'gre';
  intensiveModeEnabled: boolean;
  highlightStyle: 'background' | 'underline' | 'dot';
  /** 非索引字段，新增无需升 Dexie 版本；旧记录读出为 undefined，读取处用 ?? 'zh' 兜底 */
  definitionMode?: DefinitionMode;
  /** AI 解释总开关，默认关闭 */
  llmEnabled?: boolean;
  /** 模型档位，默认自动按显存选 */
  llmModelTier?: LlmModelTier;
}

/** AI 解释结果缓存，key = model + promptVersion + span + context */
export interface LlmCacheRecord {
  key: string;
  span: string;
  context: string;
  model: string;
  result: Explanation;
  createdAt: number;
}

class MiniReaderDB extends Dexie {
  books!: Table<BookMeta, string>;
  contents!: Table<BookContent, string>;
  notes!: Table<Note, number>;
  vocab!: Table<VocabWord, number>;
  vocabSettings!: Table<VocabSettings, string>;
  llmCache!: Table<LlmCacheRecord, string>;

  constructor() {
    super('MiniReaderDB');

    this.version(1).stores({
      books: 'id, title, author, addedAt, lastReadAt',
      contents: 'id',
      notes: '++id, bookId, createdAt',
    });

    this.version(2)
      .stores({
        books: 'id, title, author, addedAt, lastReadAt, sortOrder',
        contents: 'id',
        notes: '++id, bookId, createdAt',
      })
      .upgrade(async (tx) => {
        let index = 0;
        await tx
          .table('books')
          .toCollection()
          .modify((book: any) => {
            if (typeof book.sortOrder !== 'number') {
              book.sortOrder = index++;
            }
          });
      });

    this.version(3).stores({
      books: 'id, title, author, addedAt, lastReadAt, sortOrder, contentHash',
      contents: 'id',
      notes: '++id, bookId, createdAt',
    });

    this.version(4).stores({
      books: 'id, title, author, addedAt, lastReadAt, sortOrder, contentHash',
      contents: 'id',
      notes: '++id, bookId, createdAt',
      vocab: '++id, word, lemma, level, isPhrase, reviewCount, lastSeenAt, addedAt',
      vocabSettings: 'id',
    });

    this.version(5).stores({
      books: 'id, title, author, addedAt, lastReadAt, sortOrder, contentHash',
      contents: 'id',
      notes: '++id, bookId, createdAt',
      vocab: '++id, word, lemma, level, isPhrase, reviewCount, lastSeenAt, addedAt',
      vocabSettings: 'id',
      llmCache: 'key, createdAt, model',
    });

    // v6：笔记配色里去掉柠檬黄（和橙色熟练度高亮撞色），旧笔记一次性迁到天空蓝
    this.version(6)
      .stores({
        books: 'id, title, author, addedAt, lastReadAt, sortOrder, contentHash',
        contents: 'id',
        notes: '++id, bookId, createdAt',
        vocab: '++id, word, lemma, level, isPhrase, reviewCount, lastSeenAt, addedAt',
        vocabSettings: 'id',
        llmCache: 'key, createdAt, model',
      })
      .upgrade(async (tx) => {
        await tx
          .table('notes')
          .toCollection()
          .modify((note: { color?: string }) => {
            if ((note.color || '').toLowerCase() === '#fcd34d') {
              note.color = '#93c5fd';
            }
          });
      });

    // v7：笔记从背景填充改为手绘下划线，颜色换成同色系的笔触色（更饱和，细线才看得见）
    this.version(7)
      .stores({
        books: 'id, title, author, addedAt, lastReadAt, sortOrder, contentHash',
        contents: 'id',
        notes: '++id, bookId, createdAt',
        vocab: '++id, word, lemma, level, isPhrase, reviewCount, lastSeenAt, addedAt',
        vocabSettings: 'id',
        llmCache: 'key, createdAt, model',
      })
      .upgrade(async (tx) => {
        const strokeOf: Record<string, string> = {
          '#fcd34d': '#3b82f6', // v6 之前漏网的黄
          '#93c5fd': '#3b82f6',
          '#86efac': '#10b981',
          '#fca5a5': '#ec4899',
        };
        await tx
          .table('notes')
          .toCollection()
          .modify((note: { color?: string }) => {
            const next = strokeOf[(note.color || '').toLowerCase()];
            if (next) note.color = next;
          });
      });
  }
}

export const db = new MiniReaderDB();

db.on('populate', async () => {
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.books.add({
    id,
    title: '\u6B22\u8FCE\u4F7F\u7528 Mini Reader',
    author: 'Mini Reader Team',
    format: 'txt',
    progress: 0,
    addedAt: now,
    lastReadAt: now,
    sortOrder: 0,
  });

  await db.contents.add({
    id,
    data:
      '\u6B22\u8FCE\u6765\u5230 Mini Reader\u3002\n\n\u8FD9\u662F\u4E00\u4E2A\u4E13\u6CE8\u4E8E\u672C\u5730\u6C89\u6D78\u5F0F\u9605\u8BFB\u4F53\u9A8C\u7684\u9605\u8BFB\u5668\u3002\n\n\u4F60\u53EF\u4EE5\u70B9\u51FB\u53F3\u4E0A\u89D2\u7684\u201C\u5BFC\u5165\u4E66\u7C4D\u201D\u6309\u94AE\uFF0C\u6216\u8005\u76F4\u63A5\u628A TXT\u3001EPUB\u3001PDF \u6587\u4EF6\u62D6\u8FDB\u7A97\u53E3\u91CC\u3002\n\n\u795D\u4F60\u9605\u8BFB\u6109\u5FEB\u3002',
  });
});
