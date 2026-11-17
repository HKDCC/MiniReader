/**
 * 词典条目的唯一类型来源。
 * 主进程（electron/dictEngine.ts）与渲染层（src/services/vocabService.ts）共用，
 * 避免两侧各定义一份导致字段漂移。
 */

export interface DictEntry {
  id?: number;
  word: string;
  sw?: string;
  phonetic?: string;
  definition?: string;
  translation?: string;
  pos?: string;
  collins?: number;
  oxford?: number;
  tag?: string;
  bnc?: number;
  frq?: number;
  exchange?: string;
  detail?: string;
  audio?: string;
}

/**
 * 通过 IPC 回传时只保留展示字段。
 * ECDICT 的 detail 单条可达数 KB，拆解 4 个词时整包会膨胀到数十 KB，必须裁剪。
 */
export type DisplayEntry = Pick<
  DictEntry,
  | 'word'
  | 'phonetic'
  | 'definition'
  | 'translation'
  | 'pos'
  | 'tag'
  | 'collins'
  | 'exchange'
  // oxford / bnc / frq 体积很小，但 calculateDefaultLevel 需要它们判难度
  | 'oxford'
  | 'bnc'
  | 'frq'
>;

export type SpanKind = 'word' | 'phrase' | 'sentence';

export interface SpanToken {
  /** 表层形式，保留原始大小写，如 "Hurtling" */
  text: string;
  /** 该 token 自身的词条 */
  entry: DisplayEntry | null;
  /** 词根（exchange 的 0:/1:）；无词根时等于 text */
  lemma: string;
  /** 词根词条；lemma === text 时与 entry 相同 */
  lemmaEntry: DisplayEntry | null;
  hit: boolean;
}

export interface SpanResolution {
  /** 原始输入，未裁剪 */
  raw: string;
  /** 归一化结果，保留大小写，用于展示 */
  normalized: string;
  kind: SpanKind;
  /** 整串命中（word / phrase）；sentence 或整串未命中时为 null */
  primary: DisplayEntry | null;
  primaryLemma: string | null;
  primaryLemmaEntry: DisplayEntry | null;
  /** word: 1 项；phrase: 各 token；sentence: 空数组（不查词） */
  tokens: SpanToken[];
  missedTokens: string[];
  /** 命中的省略号词条，如 "break ... down" */
  matchedPattern?: string;
}

export function emptySpanResolution(raw: string, normalized = ''): SpanResolution {
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
