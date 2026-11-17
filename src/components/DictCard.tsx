import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Volume2, X, Check, Sparkles, ArrowRight } from 'lucide-react';
import { vocabService, LEVEL_COLORS } from '../services/vocabService';
import { llmService } from '../services/llmService';
import type { DictEntry, DisplayEntry, SpanResolution, SpanToken } from '../shared/dictTypes';
import type { Explanation, LlmModelTier } from '../shared/llmTypes';
import { tokenizeSpan, isParticle } from '../shared/spanText';
import { db } from '../db/db';
import type { DefinitionMode } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';

interface DictCardProps {
  word: string;
  contextSentence?: string;
  bookId?: string;
  position: {
    left: number;
    top?: number;
    bottom?: number;
    width?: number;
  };
  currentTheme: { bg: string; text: string; ui: string };
  onClose: () => void;
  onLevelChanged?: (word: string, lemma: string, level: number) => void;
}

const MODE_LABELS: Record<DefinitionMode, string> = { zh: '中', en: '英', both: '双语' };
const MODE_ORDER: DefinitionMode[] = ['zh', 'en', 'both'];

/** 三档滑块（S3 反白胶囊）：深色滑块 + 选中档文字反白 */
function ModeSwitch({
  mode,
  onChange,
  ink,
  surface,
}: {
  mode: DefinitionMode;
  onChange: (next: DefinitionMode) => void;
  ink: string;
  surface: string;
}) {
  const width = 72;
  const pad = 2;
  const knob = (width - pad * 2) / 3;
  const index = Math.max(0, MODE_ORDER.indexOf(mode));

  return (
    <div
      role="group"
      aria-label="释义显示方式"
      className="relative shrink-0"
      style={{
        width,
        height: 18,
        borderRadius: 999,
        backgroundColor: `${ink}18`,
        boxShadow: `inset 0 1px 2px ${ink}22`,
      }}
    >
      <span
        className="absolute rounded-full"
        style={{
          top: pad,
          left: pad,
          width: knob,
          height: 18 - pad * 2,
          backgroundColor: ink,
          transform: `translateX(${index * knob}px)`,
          transition: 'transform .3s cubic-bezier(.34,1.35,.5,1)',
          boxShadow: `0 1px 3px ${ink}55`,
        }}
      />
      <div className="absolute inset-0 grid grid-cols-3 items-center" style={{ zIndex: 2 }}>
        {MODE_ORDER.map((value) => {
          const active = value === mode;
          return (
            <button
              key={value}
              onClick={() => onChange(value)}
              className="text-[10px] leading-none transition-opacity"
              style={{ color: active ? surface : ink, opacity: active ? 1 : 0.45 }}
            >
              {MODE_LABELS[value]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** AI 入口：虹彩渐变环 + 星芒图标 + 两个字母，紧凑到约 41px 宽 */
function AIButton({ onClick, surface }: { onClick: () => void; surface: string }) {
  return (
    <button
      onClick={onClick}
      className="ai-btn self-start shrink-0"
      style={{ '--ai-surface': surface } as React.CSSProperties}
      title="AI 深度解释"
      aria-label="AI 深度解释"
    >
      <span className="ai-btn-inner">
        <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
          <defs>
            <linearGradient id="mr-ai-spark" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#7C6BF5" />
              <stop offset="0.5" stopColor="#46C8C0" />
              <stop offset="1" stopColor="#F57FB4" />
            </linearGradient>
          </defs>
          <path
            fill="url(#mr-ai-spark)"
            d="M12 1.5Q13.2 10.8 22.5 12Q13.2 13.2 12 22.5Q10.8 13.2 1.5 12Q10.8 10.8 12 1.5Z"
          />
        </svg>
        <span className="text-[11px] font-semibold tracking-[0.06em]">AI</span>
      </span>
    </button>
  );
}

/**
 * ECDICT 的英英释义是 WordNet 原样：每行以词性标记开头（n / v / a / s / r），
 * 不分列的话 15 个义项糊成一片，扫读基本不可用。
 * 这里把词性拆成定宽首列并上色，释义正文换行时悬挂缩进对齐。
 */
const POS_SET = ['n', 'v', 'a', 's', 'r', 'adj', 'adv', 'prep', 'conj', 'pron', 'num', 'art', 'int', 'aux', 'vt', 'vi', 'abbr', 'phr'];

const POS_COLORS: Record<string, string> = {
  n: '#7FA6D9',
  v: '#7FB894',
  a: '#CDA96B',
  s: '#CDA96B',
  adj: '#CDA96B',
  r: '#B393C4',
  adv: '#B393C4',
};

function splitPos(line: string): { pos: string; body: string } {
  const match = line.match(/^([A-Za-z]{1,4})\.?\s+(\S.*)$/);
  if (!match) return { pos: '', body: line };
  const pos = match[1].toLowerCase();
  if (!POS_SET.includes(pos)) return { pos: '', body: line };
  return { pos, body: match[2] };
}
const TITLE_FONT = 'Georgia, "LXGW WenKai", "Noto Serif SC", serif';
const ZH_FONT = '"Noto Serif SC", "Source Han Serif SC", "LXGW WenKai", "Songti SC", serif';
const EN_FONT = 'Georgia, "Times New Roman", "Noto Serif SC", serif';

type AiState = 'idle' | 'loading' | 'done' | 'error';

function splitLines(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n|\\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 英中释义 + 英英释义，按 mode 组合。三种“缺失”情况各有不同文案。 */
function DefinitionBlock({ entry, mode }: { entry: DisplayEntry; mode: DefinitionMode }) {
  const zh = splitLines(entry.translation);
  const en = splitLines(entry.definition);

  const renderZh = () =>
    zh.map((line, idx) => {
      const { pos, body } = splitPos(line);
      return (
        <div key={`zh-${idx}`} className="flex items-baseline gap-1.5">
          {pos && (
            <span
              className="shrink-0 w-[16px] text-[9px] font-semibold uppercase leading-[1.7] tracking-tight"
              style={{ color: POS_COLORS[pos] ?? 'currentColor', opacity: POS_COLORS[pos] ? 1 : 0.4 }}
            >
              {pos}
            </span>
          )}
          <span
            className="flex-1 opacity-90 text-[13.5px] leading-[1.75]"
            style={{ fontFamily: ZH_FONT }}
          >
            {body}
          </span>
        </div>
      );
    });

  const renderEn = () =>
    en.map((line, idx) => {
      const { pos, body } = splitPos(line);
      return (
        <div
          key={`en-${idx}`}
          className="flex items-baseline gap-1.5"
          style={{ fontFamily: EN_FONT }}
        >
          {pos && (
            <span
              className="shrink-0 w-[16px] text-[9px] font-semibold uppercase leading-[1.6] tracking-tight"
              style={{ color: POS_COLORS[pos] ?? 'currentColor', opacity: POS_COLORS[pos] ? 1 : 0.4 }}
            >
              {pos}
            </span>
          )}
          <span className="flex-1 text-[12.5px] leading-[1.6] opacity-80">{body}</span>
        </div>
      );
    });

  if (mode === 'zh') {
    if (zh.length) return <>{renderZh()}</>;
    if (en.length) {
      return (
        <>
          <div className="text-[11px] opacity-50 mb-1">词典未提供中文释义，以下是英文释义</div>
          {renderEn()}
        </>
      );
    }
    return <div className="py-2 opacity-50">该词条在 ECDICT 中没有释义内容</div>;
  }

  if (mode === 'en') {
    if (en.length) return <>{renderEn()}</>;
    if (zh.length) {
      return (
        <>
          <div className="text-[11px] opacity-50 mb-1">词典未提供英文释义，以下是中文释义</div>
          {renderZh()}
        </>
      );
    }
    return <div className="py-2 opacity-50">该词条在 ECDICT 中没有释义内容</div>;
  }

  if (!zh.length && !en.length) {
    return <div className="py-2 opacity-50">该词条在 ECDICT 中没有释义内容</div>;
  }

  return (
    <>
      {zh.length > 0 && <>{renderZh()}</>}
      {zh.length > 0 && en.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-current/10" />
      )}
      {en.length > 0 && <>{renderEn()}</>}
    </>
  );
}

/**
 * 逐词拆解里只显示一行释义。
 * ECDICT 的释义行按词性堆叠，且顺序不固定（down 是 a.→adv.→prep.，break 是 n.→vt.→vi.）。
 * 直接取首行会把 break 显示成名词"休息"、把 down 显示成形容词"向下的"。
 *
 * 两个位置关系在句法上是确定的，可以直接用：
 *   - 小品词（down/up/out…）在短语里一定是副词或介词；
 *   - 小品词前面那个词一定是动词（动词短语结构）。
 * 其余情况没有可靠的词性线索，老老实实取首行，不猜。
 */
function pickGloss(entry?: DisplayEntry | null, prefer?: 'adverbial' | 'verb'): string {
  const lines = splitLines(entry?.translation);
  if (!lines.length) return '';
  if (prefer === 'adverbial') {
    const hit = lines.find((line) => /^(adv|prep)\./i.test(line));
    if (hit) return hit;
  } else if (prefer === 'verb') {
    const hit = lines.find((line) => /^(vt|vi|v)\./i.test(line));
    if (hit) return hit;
  }
  return lines[0];
}

/** 整串查不到时，把词组拆开逐个给释义。这是「hurtling down」这类查询的兜底。 */
function TokenBreakdown({ tokens }: { tokens: SpanToken[] }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] opacity-45">整串未收录，逐词释义：</div>
      {tokens.map((token, idx) => {
        const next = tokens[idx + 1];
        const prefer = isParticle(token.text)
          ? ('adverbial' as const)
          : next && isParticle(next.text)
            ? ('verb' as const)
            : undefined;
        const gloss = pickGloss(token.entry, prefer);
        const showLemma = token.lemma && token.lemma !== token.text.toLowerCase();
        return (
          <div
            key={`${token.text}-${idx}`}
            className={`flex items-baseline gap-1.5 text-[12.5px] ${token.hit ? '' : 'opacity-45'}`}
          >
            <span className="font-medium shrink-0 max-w-[104px] truncate">{token.text}</span>
            <span className="opacity-85 truncate flex-1 min-w-0" style={{ fontFamily: ZH_FONT }}>
              {token.hit ? gloss : '未收录'}
            </span>
            {showLemma && (
              <span className="text-[11px] opacity-45 shrink-0">← {token.lemma}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AiBlock({
  state,
  result,
  error,
  chars,
  onRun,
  onCancel,
  surface,
}: {
  state: AiState;
  result: Explanation | null;
  error: string;
  chars: number;
  onRun: () => void;
  onCancel: () => void;
  surface: string;
}) {
  if (state === 'idle') {
    return <AIButton onClick={onRun} surface={surface} />;
  }

  return (
    <div className="pt-1 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] opacity-45 flex items-center gap-1">
          <Sparkles size={10} />
          <span>AI 解释</span>
        </span>
        {state === 'loading' && (
          <button onClick={onCancel} className="text-[11px] opacity-45 hover:opacity-90">
            取消
          </button>
        )}
        {(state === 'done' || state === 'error') && (
          <span className="text-[9px] opacity-30">AI 推断，仅供参考</span>
        )}
      </div>

      {state === 'loading' && (
        <div className="text-[12px] opacity-55 leading-relaxed">
          {chars > 0 ? `正在生成… 已 ${chars} 字` : '正在生成…首次调用需要加载模型，可能稍慢'}
        </div>
      )}

      {state === 'error' && (
        <div className="text-[12px] opacity-60 leading-relaxed">
          {error}
          <button onClick={onRun} className="ml-1 underline decoration-dotted hover:opacity-100">
            重试
          </button>
        </div>
      )}

      {state === 'done' && result && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] leading-[1.75] opacity-90 select-text" style={{ fontFamily: ZH_FONT }}>{result.meaningZh}</div>

          {result.tokens.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {result.tokens.map((token, idx) => (
                <div key={`${token.text}-${idx}`} className="flex items-baseline gap-1.5 text-[12px]">
                  <span className="font-medium shrink-0 max-w-[88px] truncate">{token.text}</span>
                  {token.pos && (
                    <span className="text-[9px] opacity-40 shrink-0 uppercase">{token.pos}</span>
                  )}
                  <span className="opacity-80 truncate flex-1 min-w-0">{token.meaningZh}</span>
                </div>
              ))}
            </div>
          )}

          {result.note && (
            <div className="text-[11px] opacity-55 leading-relaxed" style={{ fontFamily: ZH_FONT }}>{result.note}</div>
          )}

          {result.examples && result.examples.length > 0 && (
            <div className="text-[11px] opacity-40 flex flex-col gap-0.5">
              {result.examples.map((example, idx) => (
                <div key={idx}>· {example}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DictCard({
  word,
  contextSentence,
  bookId,
  position,
  currentTheme,
  onClose,
  onLevelChanged,
}: DictCardProps) {
  const [loading, setLoading] = useState(true);
  const [resolution, setResolution] = useState<SpanResolution | null>(null);
  const [mode, setMode] = useState<DefinitionMode>('both');
  const [lemma, setLemma] = useState(word.trim().toLowerCase());
  const [activeLevel, setActiveLevel] = useState<number>(1);
  const [justSaved, setJustSaved] = useState(false);

  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiTier, setAiTier] = useState<LlmModelTier>('auto');
  const [aiState, setAiState] = useState<AiState>('idle');
  const [aiResult, setAiResult] = useState<Explanation | null>(null);
  const [aiError, setAiError] = useState('');
  const [aiChars, setAiChars] = useState(0);
  const aiAutoRunRef = useRef<string>('');

  const isSentence = resolution?.kind === 'sentence';
  const rawWord = word.trim();
  // 归一化后的展示形态：去掉选区带进来的引号、尾随标点。
  const displayWord = resolution?.normalized || rawWord;
  // 存进生词本时也用归一化形态，避免把 “hurtling down,” 这样的脏词收进词库。
  const persistWord = displayWord;

  // Live query user's current saved rating for this lemma/word
  const savedRecord = useLiveQuery(
    async () => {
      const cleanWord = persistWord.toLowerCase();
      const byWord = await db.vocab.where('word').equals(cleanWord).first();
      if (byWord) return byWord;
      return db.vocab.where('lemma').equals(lemma).first();
    },
    [persistWord, lemma]
  );

  useEffect(() => {
    let cancelled = false;
    const fetchDict = async () => {
      setLoading(true);
      try {
        const res = await vocabService.resolveSpan(word);
        const settings = await vocabService.getSettings();

        if (cancelled) return;

        setResolution(res);
        setMode(settings.definitionMode ?? 'both');
        setAiEnabled(!!settings.llmEnabled);
        setAiTier(settings.llmModelTier ?? 'auto');

        const resolvedLemma =
          res.kind === 'phrase' && !res.primary
            ? res.normalized.toLowerCase()
            : res.primaryLemma || res.tokens[0]?.lemma || res.normalized.toLowerCase();
        setLemma(resolvedLemma);

        if (savedRecord) {
          setActiveLevel(savedRecord.level);
        } else if (res.kind !== 'sentence') {
          const levelSource: DictEntry | null =
            res.primary ?? res.tokens[0]?.lemmaEntry ?? res.tokens[0]?.entry ?? null;
          setActiveLevel(vocabService.calculateDefaultLevel(levelSource, settings.baseLevel));
        }
      } catch (err) {
        console.warn('DictCard fetch error', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDict();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  useEffect(() => {
    if (savedRecord) {
      setActiveLevel(savedRecord.level);
    }
  }, [savedRecord]);

  const runAi = React.useCallback(async () => {
    if (!resolution) return;
    if (aiState === 'loading') return;

    setAiState('loading');
    setAiChars(0);
    setAiError('');

    try {
      const result = await llmService.explain(
        {
          span: resolution.normalized || rawWord,
          context: contextSentence || '',
          ruleSummary: llmService.buildRuleSummary(resolution),
          kind: resolution.kind,
        },
        aiTier,
        (chars) => setAiChars(chars)
      );
      setAiResult(result);
      setAiState('done');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 解释失败';
      if (message === '已取消') {
        setAiState('idle');
        return;
      }
      setAiError(message);
      setAiState('error');
    }
  }, [resolution, aiState, aiTier, contextSentence, rawWord]);

  // 规则层没覆盖，或整句——自动请求；词典完全命中则只留按钮。
  useEffect(() => {
    if (!aiEnabled || loading || !resolution) return;

    const uncovered =
      resolution.kind === 'sentence' ||
      (resolution.primary === null &&
        (resolution.tokens.length > 0 || resolution.missedTokens.length > 0));
    if (!uncovered) return;

    const key = `${resolution.normalized}|${contextSentence || ''}`;
    if (aiAutoRunRef.current === key) return;
    aiAutoRunRef.current = key;
    void runAi();
  }, [aiEnabled, loading, resolution, contextSentence, runAi]);

  const handleSetLevel = async (level: number) => {
    setActiveLevel(level);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1200);

    await vocabService.setWordLevel({
      word: persistWord,
      lemma,
      level,
      translation: resolution?.primary?.translation ?? resolution?.tokens[0]?.entry?.translation,
      phonetic: resolution?.primary?.phonetic,
      tags: resolution?.primary?.tag,
      collins: resolution?.primary?.collins,
      isPhrase: (resolution?.tokens.length ?? 0) > 1,
      contextSentence,
      bookId,
    });

    onLevelChanged?.(persistWord, lemma, level);
  };

  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
    vocabService.speak(displayWord || word);
  };

  const handleModeChange = (next: DefinitionMode) => {
    setMode(next);
    void vocabService.updateSettings({ definitionMode: next });
  };

  // 从词卡直接开启：写完设置后由 aiEnabled 的 effect 自动发起请求，避免重复调用
  const enableAi = async () => {
    setAiEnabled(true);
    await vocabService.updateSettings({ llmEnabled: true });
  };

  const CARD_WIDTH = position.width || 320;
  const primary = resolution?.primary ?? null;
  const tokens = resolution?.tokens ?? [];
  // 只有整体就是一个词（或整串命中了带词根的词条）时才提示词根。
  // 短语拆解的每个 token 各自在 TokenBreakdown 里标词根，这里再标会误导成“整个短语 = 词根”。
  const primaryLemmaHint = resolution?.primaryLemma ?? null;
  const showLemmaHint =
    !isSentence &&
    !!primaryLemmaHint &&
    primaryLemmaHint !== displayWord.toLowerCase() &&
    (resolution?.kind === 'word' || !!primary);
  const recognizeCount = resolution ? tokenizeSpan(resolution.normalized).length : 0;

  // 按实际可用空间限高：朝下展开时受 top 限制，朝上展开时受 bottom 限制。
  // 只写 calc(100% - 24px) 在“朝下 + 内容很长”时仍会溢出容器底部。
  const maxHeight =
    typeof position.top === 'number'
      ? `calc(100% - ${position.top + 12}px)`
      : typeof position.bottom === 'number'
        ? `calc(100% - ${position.bottom + 12}px)`
        : 'calc(100% - 24px)';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute z-50 flex flex-col gap-2 p-3 rounded-2xl shadow-2xl backdrop-blur-2xl overflow-hidden"
      style={{
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        width: CARD_WIDTH,
        maxHeight,
        backgroundColor: `${currentTheme.ui}F8`,
        border: `1px solid ${currentTheme.text}20`,
        color: currentTheme.text,
      }}
    >
      {/* Header: Word, phonetic, audio & close button */}
      <div className="flex items-start justify-between gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-bold text-[17px] tracking-tight select-text ${
                isSentence ? 'line-clamp-2 leading-snug' : 'truncate'
              }`}
              style={{ fontFamily: TITLE_FONT }}
            >
              {displayWord}
            </span>
            {!isSentence && primary?.phonetic && (
              <span className="text-xs opacity-60 font-mono tracking-tight select-text">
                /{primary.phonetic.replace(/^\/|\/$/g, '')}/
              </span>
            )}
            <button
              onClick={handleSpeak}
              className="p-1 rounded-full hover:bg-current/10 transition-colors opacity-70 hover:opacity-100"
              title="朗读发音"
            >
              <Volume2 size={14} />
            </button>
          </div>

          {/* Lemma indicator if this is a derived form */}
          {showLemmaHint && (
            <div className="text-[11px] opacity-65 flex items-center gap-1 mt-0.5">
              <span>词根</span>
              <ArrowRight size={10} />
              <span className="font-semibold underline decoration-dotted">{primaryLemmaHint}</span>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded-full opacity-40 hover:opacity-100 transition-opacity"
          title="关闭"
        >
          <X size={15} />
        </button>
      </div>

      {/* 单滚动区：词典结果先出，AI 结果后到，两者都不撑破卡片 */}
      <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto pr-0.5">
        {/* Translations */}
        <div className="flex flex-col gap-1 text-[13.5px] select-text">
          {loading ? (
            <div className="py-3 flex items-center justify-center opacity-40 text-xs">
              正在查询词典...
            </div>
          ) : isSentence ? (
            <div className="flex flex-col gap-1.5 py-1">
              <div className="text-[11px] opacity-45">
                已识别 {recognizeCount} 个单词 · 规则词典不做整句查询
              </div>
            </div>
          ) : primary ? (
            <DefinitionBlock entry={primary} mode={mode} />
          ) : tokens.length > 0 ? (
            <TokenBreakdown tokens={tokens} />
          ) : (
            <div className="py-2 opacity-50">
              ECDICT 未收录「{resolution?.normalized || displayWord}」
            </div>
          )}
        </div>

        {!aiEnabled && !loading && (isSentence || !primary) && (
          <AIButton onClick={() => void enableAi()} surface={currentTheme.ui} />
        )}

        {aiEnabled && !loading && (
          <AiBlock
            state={aiState}
            result={aiResult}
            error={aiError}
            chars={aiChars}
            onRun={() => void runAi()}
            onCancel={() => llmService.cancelActive()}
            surface={currentTheme.ui}
          />
        )}
      </div>

      {/* 极简页脚：左边五个熟练度圆点，右边释义模式文字。无边框、无标签。 */}
      {!isSentence && !loading && (
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-[7px]">
            {[1, 2, 3, 4, 5].map((lvl) => {
              const info = LEVEL_COLORS[lvl];
              const isSelected = activeLevel === lvl;
              return (
                <button
                  key={lvl}
                  onClick={() => handleSetLevel(lvl)}
                  title={info.label}
                  aria-label={info.label}
                  className="w-[11px] h-[11px] rounded-full transition-all"
                  style={{
                    backgroundColor: lvl === 5 ? 'transparent' : info.text,
                    border: lvl === 5 ? `1.5px solid ${currentTheme.text}66` : 'none',
                    opacity: isSelected ? 1 : 0.35,
                    boxShadow: isSelected
                      ? `0 0 0 2px ${currentTheme.ui}, 0 0 0 3.5px ${info.text}`
                      : 'none',
                  }}
                />
              );
            })}
            {justSaved && <Check size={11} className="text-emerald-500 ml-0.5" />}
          </div>

          <ModeSwitch
            mode={mode}
            onChange={handleModeChange}
            ink={currentTheme.text}
            surface={currentTheme.ui}
          />
        </div>
      )}
    </motion.div>
  );
}
