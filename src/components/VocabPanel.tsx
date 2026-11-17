import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Download, Trash2, Volume2, Settings2, Check } from 'lucide-react';
import ReaderPanelTabs from './ReaderPanelTabs';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, VocabWord } from '../db/db';
import { vocabService, LEVEL_COLORS, BaseProficiencyLevel } from '../services/vocabService';
import { llmService } from '../services/llmService';
import type { LlmModelTier, LlmStatus } from '../shared/llmTypes';

interface VocabPanelProps {
  uiColor: string;
  textColor: string;
  onClose: () => void;
  onJumpToWord?: (word: string) => void;
  onWordClick?: (word: string) => void;
  onSwitchTab: (tab: 'notes' | 'vocab') => void;
}

export default function VocabPanel({ uiColor, textColor, onClose, onJumpToWord, onWordClick, onSwitchTab }: VocabPanelProps) {
  const [filterLevel, setFilterLevel] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [baseLevel, setBaseLevel] = useState<BaseProficiencyLevel>('cet4');
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [llmTier, setLlmTier] = useState<LlmModelTier>('auto');
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [llmChecking, setLlmChecking] = useState(false);
  const [copiedAnki, setCopiedAnki] = useState(false);

  // Load user settings
  React.useEffect(() => {
    vocabService.getSettings().then((s) => {
      setBaseLevel(s.baseLevel);
      setLlmEnabled(!!s.llmEnabled);
      setLlmTier(s.llmModelTier ?? 'auto');
    });
  }, []);

  const handleBaseLevelChange = async (newLevel: BaseProficiencyLevel) => {
    setBaseLevel(newLevel);
    await vocabService.updateSettings({ baseLevel: newLevel });
  };

  const handleLlmToggle = async () => {
    const next = !llmEnabled;
    setLlmEnabled(next);
    await vocabService.updateSettings({ llmEnabled: next });
    if (next) void checkLlm(next, llmTier);
  };

  const handleLlmTierChange = async (next: LlmModelTier) => {
    setLlmTier(next);
    await vocabService.updateSettings({ llmModelTier: next });
    if (llmEnabled) void checkLlm(llmEnabled, next);
  };

  const checkLlm = async (enabled = llmEnabled, tier = llmTier) => {
    if (!enabled) {
      setLlmStatus(null);
      return;
    }
    setLlmChecking(true);
    try {
      setLlmStatus(await llmService.status(tier));
    } finally {
      setLlmChecking(false);
    }
  };

  // Live query all vocabulary; only levels 1-3 count as "new words" for this book
  const vocabList = useLiveQuery(() => db.vocab.toArray(), []) || [];
  const learningList = useMemo(
    () => vocabList.filter((item) => item.level >= 1 && item.level <= 3),
    [vocabList]
  );

  // Filtered list
  const filteredList = useMemo(() => {
    // 最近一次标记/查阅优先，避免已收词改级后仍埋在旧位置
    let result = [...learningList].sort(
      (a, b) => (b.lastSeenAt || b.addedAt || 0) - (a.lastSeenAt || a.addedAt || 0)
    );
    if (filterLevel !== 'all') {
      result = result.filter((item) => item.level === filterLevel);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (item) =>
          item.word.toLowerCase().includes(q) ||
          item.lemma.toLowerCase().includes(q) ||
          (item.translation && item.translation.toLowerCase().includes(q))
      );
    }
    return result;
  }, [learningList, filterLevel, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const counts = { 1: 0, 2: 0, 3: 0, total: learningList.length };
    for (const v of learningList) {
      if (counts[v.level as keyof typeof counts] !== undefined) {
        counts[v.level as keyof typeof counts]++;
      }
    }
    return counts;
  }, [learningList]);

  // Anki Export
  const handleExportAnki = () => {
    const content = vocabService.generateAnkiExport(learningList);
    const blob = new Blob([content], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MiniReader-Anki-Vocab-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setCopiedAnki(true);
    setTimeout(() => setCopiedAnki(false), 2000);
  };

  const handleDelete = async (id?: number) => {
    if (!id) return;
    if (window.confirm('确定从生词本中移除该词汇吗？')) {
      await db.vocab.delete(id);
    }
  };

  const handleLevelChange = async (item: VocabWord, newLevel: number) => {
    if (!item.id) return;
    await db.vocab.update(item.id, { level: newLevel, lastSeenAt: Date.now() });
  };

  return (
    <motion.aside
      data-reader-panel
      initial={{ x: -24, opacity: 0 }}
      animate={{ x: 0, opacity: 1, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
      exit={{ x: -24, opacity: 0, transition: { duration: 0.18 } }}
      className="reader-paper absolute bottom-0 left-0 top-[54px] z-50 flex w-[22rem] max-w-full flex-col border-r"
      style={{
        backgroundColor: uiColor,
        borderColor: `${textColor}14`,
        color: textColor,
      }}
    >
      {/* Header */}
      <div className="flex h-[56px] shrink-0 items-center justify-between border-b px-5" style={{ borderColor: `${textColor}12` }}>
        <ReaderPanelTabs active="vocab" onSwitch={onSwitchTab} vocabCount={stats.total} />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSettingsOpen((prev) => !prev)}
            className="reader-icon-button !h-7 !w-7"
            title="生词难度与分级设置"
            aria-label="生词设置"
          >
            <Settings2 size={15} />
          </button>
          <button onClick={onClose} className="reader-panel-close" title="关闭面板" aria-label="关闭面板">×</button>
        </div>
      </div>

      {/* Settings popup panel if open */}
      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b overflow-hidden p-3.5 flex flex-col gap-2.5 text-xs bg-current/5"
            style={{ borderColor: `${textColor}15` }}
          >
            <div className="font-semibold opacity-90 flex items-center justify-between">
              <span>初始基础词汇水平：</span>
              <span className="opacity-60 text-[11px]">低于该水平的词不着色</span>
            </div>
            <select
              value={baseLevel}
              onChange={(e) => handleBaseLevelChange(e.target.value as BaseProficiencyLevel)}
              className="bg-transparent border border-current/20 rounded-lg p-2 text-xs focus:outline-none"
              style={{ color: textColor }}
            >
              {Object.entries(vocabService.getProficiencyConfigs()).map(([k, v]) => (
                <option key={k} value={k} style={{ backgroundColor: uiColor, color: textColor }}>
                  {v.label} - {v.desc}
                </option>
              ))}
            </select>

            <div className="border-t border-current/10 pt-2.5 mt-1 flex flex-col gap-2">
              <div className="font-semibold opacity-90 flex items-center justify-between">
                <span>AI 语境解释：</span>
                <button
                  onClick={handleLlmToggle}
                  className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                    llmEnabled
                      ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 font-medium'
                      : 'border-current/20 opacity-60'
                  }`}
                >
                  {llmEnabled ? '已开启' : '已关闭'}
                </button>
              </div>

              {llmEnabled && (
                <>
                  <select
                    value={llmTier}
                    onChange={(e) => handleLlmTierChange(e.target.value as LlmModelTier)}
                    className="bg-transparent border border-current/20 rounded-lg p-2 text-xs focus:outline-none"
                    style={{ color: textColor }}
                  >
                    <option value="auto" style={{ backgroundColor: uiColor, color: textColor }}>
                      自动（按显存选 4B / 2B）
                    </option>
                    <option value="qwen3.5:4b" style={{ backgroundColor: uiColor, color: textColor }}>
                      Qwen3.5-4B（约 2.6GB，推荐）
                    </option>
                    <option value="qwen3.5:2b" style={{ backgroundColor: uiColor, color: textColor }}>
                      Qwen3.5-2B（约 1.4GB，低配）
                    </option>
                    <option value="qwen3.5:9b" style={{ backgroundColor: uiColor, color: textColor }}>
                      Qwen3.5-9B（约 6.6GB，较慢）
                    </option>
                  </select>

                  <button
                    onClick={() => void checkLlm()}
                    className="text-[11px] opacity-60 hover:opacity-100 transition-opacity underline decoration-dotted self-start"
                  >
                    {llmChecking ? '检测中…' : '检测本地模型'}
                  </button>

                  {llmStatus && (
                    <div className="text-[10px] leading-relaxed opacity-60 flex flex-col gap-0.5">
                      {llmStatus.available ? (
                        <>
                          <span className="text-emerald-600 opacity-90">
                            已就绪 · {llmStatus.model}
                          </span>
                          {llmStatus.vramMB ? <span>显存 {Math.round(llmStatus.vramMB / 1024)} GB</span> : <span>未检测到独立显卡，将使用 CPU 推理</span>}
                        </>
                      ) : (
                        <span className="text-amber-600 opacity-90">{llmStatus.reason}</span>
                      )}
                      {llmStatus.installed.length > 0 && (
                        <span className="opacity-70">已安装：{llmStatus.installed.join('、')}</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search and level filter tabs */}
      <div className="p-3 border-b flex flex-col gap-2.5" style={{ borderColor: `${textColor}12` }}>
        <div className="relative flex items-center">
          <Search size={14} className="absolute left-2.5 opacity-40 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索单词、词根或释义..."
            className="w-full bg-current/5 border border-current/10 rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-current/30"
          />
        </div>

        {/* Level filter tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[11px] no-scrollbar">
          <button
            onClick={() => setFilterLevel('all')}
            className={`px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap ${
              filterLevel === 'all' ? 'bg-current text-white font-medium shadow-sm' : 'opacity-60 hover:opacity-100 hover:bg-current/10'
            }`}
            style={{ color: filterLevel === 'all' ? uiColor : 'inherit' }}
          >
            全部 ({stats.total})
          </button>
          {[1, 2, 3].map((lvl) => {
            const count = stats[lvl as keyof typeof stats] || 0;
            const isSelected = filterLevel === lvl;
            return (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                className={`px-2 py-1 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1 ${
                  isSelected ? 'ring-1 ring-current font-bold' : 'opacity-60 hover:opacity-100'
                }`}
                style={{
                  backgroundColor: lvl === 5 ? `${textColor}10` : LEVEL_COLORS[lvl].bg,
                }}
              >
                <span>L{lvl}</span>
                <span className="opacity-75 text-[10px]">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Word List */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {filteredList.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center opacity-40 text-xs text-center p-4">
            <span>{searchQuery ? '未找到匹配的词汇' : '暂无待复习的生词（只收录 1–3 级；4–5 级视为已掌握）'}</span>
          </div>
        ) : (
          filteredList.map((item) => (
            <div
              key={item.id}
              className="p-2.5 rounded-xl border border-current/10 hover:border-current/25 bg-current/[0.02] flex flex-col gap-1.5 transition-all group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`font-bold text-sm tracking-tight ${onWordClick ? 'cursor-pointer hover:underline' : ''}`}
                      onClick={() => onWordClick?.(item.word)}
                      title={onWordClick ? '查看词典释义' : undefined}
                    >
                      {item.word}
                    </span>
                    {item.phonetic && (
                      <span className="text-[11px] opacity-60 font-mono">/{item.phonetic.replace(/^\/|\/$/g, '')}/</span>
                    )}
                    <button
                      onClick={() => vocabService.speak(item.word)}
                      className="opacity-50 hover:opacity-100 transition-opacity p-0.5 rounded"
                      title="朗读发音"
                    >
                      <Volume2 size={13} />
                    </button>
                  </div>
                  {item.lemma && item.lemma.toLowerCase() !== item.word.toLowerCase() && (
                    <div className="text-[10px] opacity-60">词根: {item.lemma}</div>
                  )}
                </div>

                {/* Level selector mini dots */}
                <div className="flex items-center gap-1">
                  <span className="mr-1 whitespace-nowrap text-[10.5px] opacity-60">
                    {LEVEL_COLORS[item.level]?.label}
                  </span>
                  {[1, 2, 3, 4, 5].map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => handleLevelChange(item, lvl)}
                      className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold transition-all ${
                        item.level === lvl ? 'ring-1.5 ring-current scale-110' : 'opacity-30 hover:opacity-80'
                      }`}
                      style={{
                        backgroundColor: lvl === 5 ? `${textColor}20` : LEVEL_COLORS[lvl].bg,
                      }}
                      title={lvl >= 4 ? `设为 Level ${lvl}（移出生词本）` : `设为 Level ${lvl}`}
                    >
                      {lvl}
                    </button>
                  ))}
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-red-500 hover:bg-red-500/10 ml-1"
                    title="移除"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Translation */}
              {item.translation && (
                <div className="text-xs opacity-85 line-clamp-2 leading-relaxed">{item.translation}</div>
              )}

              {/* Context if available */}
              {item.contextSentence && (
                <div className="text-[11px] opacity-55 italic line-clamp-1 border-l-2 border-current/20 pl-1.5">
                  "{item.contextSentence}"
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer / Anki Export */}
      <div className="p-3 border-t flex items-center justify-between gap-2" style={{ borderColor: `${textColor}12` }}>
        <button
          onClick={handleExportAnki}
          disabled={learningList.length === 0}
          className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold bg-current/10 hover:bg-current/15 disabled:opacity-30 transition-all"
        >
          {copiedAnki ? <Check size={14} className="text-emerald-500" /> : <Download size={14} />}
          <span>{copiedAnki ? '已生成并下载导出文件！' : '导出到 Anki (.txt)'}</span>
        </button>
      </div>
    </motion.aside>
  );
}
