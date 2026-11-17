import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { settingsCopy } from '../shared/copy';
import { getReaderFontStack } from '../shared/fonts';
import { vocabService } from '../services/vocabService';
import { llmService } from '../services/llmService';
import type { LlmModelTier, LlmStatus } from '../shared/llmTypes';

interface CustomFont {
  id: string;
  name: string;
  url?: string;
  builtIn?: boolean;
}

function normalizeFont(value: unknown): CustomFont | null {
  if (!value || typeof value !== 'object') return null;
  const font = value as { id?: unknown; name?: unknown; url?: unknown };
  if (typeof font.id !== 'string' || typeof font.name !== 'string') return null;
  const id = font.id.trim().replace(/[^\w -]/g, '').slice(0, 80);
  if (!id) return null;
  const url = typeof font.url === 'string' ? font.url.trim().slice(0, 2_000) : undefined;
  if (url) {
    try {
      const protocol = new URL(url).protocol;
      if (!['http:', 'https:', 'file:', 'data:'].includes(protocol)) return null;
    } catch {
      return null;
    }
  }
  return { id, name: font.name.trim().slice(0, 80) || id, url };
}

function fontFaceCss(font: CustomFont) {
  const source = font.url ? ` src: url(${JSON.stringify(font.url)}) format('woff2');` : '';
  return `@font-face { font-family: ${JSON.stringify(font.id)};${source} }`;
}

export default function SettingsPanel({
  theme,
  setTheme,
  fontSize,
  setFontSize,
  lineHeight,
  setLineHeight,
  chars,
  setChars,
  fontFamily,
  setFontFamily,
  isTwoPage,
  setIsTwoPage,
  intensiveMode,
  setIntensiveMode,
  uiColor,
  textColor,
  onClose,
}: any) {
  const themes = [
    { id: 'warm-white', name: '纸白', color: '#F6F3EA' },
    { id: 'kraft', name: '米纸', color: '#F0EADA' },
    { id: 'dark', name: '暗色', color: '#191B17' },
    { id: 'night', name: '夜间', color: '#000000' },
  ];

  const builtInFonts: CustomFont[] = [
    { id: 'LXGW WenKai', name: '\u971E\u9E5C\u6587\u6977', builtIn: true },
    { id: 'Source Han Serif SC', name: '\u601D\u6E90\u5B8B\u4F53', builtIn: true },
    { id: 'Microsoft YaHei', name: '\u5FAE\u8F6F\u96C5\u9ED1', builtIn: true },
    { id: 'Segoe UI', name: 'Segoe UI', builtIn: true },
  ];

  const [customFonts, setCustomFonts] = useState<CustomFont[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('mr_customFonts') || '[]');
      return Array.isArray(stored) ? stored.map(normalizeFont).filter((font): font is CustomFont => Boolean(font)).slice(0, 20) : [];
    } catch {
      return [];
    }
  });
  const [showAddFont, setShowAddFont] = useState(false);
  const [newFontName, setNewFontName] = useState('');
  const [newFontUrl, setNewFontUrl] = useState('');

  const [llmEnabled, setLlmEnabled] = useState(false);
  const [llmTier, setLlmTier] = useState<LlmModelTier>('auto');
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [llmChecking, setLlmChecking] = useState(false);

  useEffect(() => {
    vocabService.getSettings().then((s) => {
      setLlmEnabled(!!s.llmEnabled);
      setLlmTier(s.llmModelTier ?? 'auto');
    });
  }, []);

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

  const toggleLlm = async () => {
    const next = !llmEnabled;
    setLlmEnabled(next);
    await vocabService.updateSettings({ llmEnabled: next });
    if (next) void checkLlm(next, llmTier);
    else setLlmStatus(null);
  };

  const changeLlmTier = async (next: LlmModelTier) => {
    setLlmTier(next);
    await vocabService.updateSettings({ llmModelTier: next });
    if (llmEnabled) void checkLlm(llmEnabled, next);
  };

  useEffect(() => {
    localStorage.setItem('mr_customFonts', JSON.stringify(customFonts));
    customFonts.forEach((font) => {
      if (font.url && !document.getElementById(`font-${font.id}`)) {
        const style = document.createElement('style');
        style.id = `font-${font.id}`;
        style.textContent = fontFaceCss(font);
        document.head.appendChild(style);
      }
    });
  }, [customFonts]);

  const handleAddFont = () => {
    if (!newFontName.trim()) return;

    const normalized = normalizeFont({ id: newFontName, name: newFontName, url: newFontUrl || undefined });
    if (!normalized || customFonts.some((font) => font.id === normalized.id)) return;
    const nextFont: CustomFont = {
      ...normalized,
    };

    if (nextFont.url && !document.getElementById(`font-${nextFont.id}`)) {
      const style = document.createElement('style');
      style.id = `font-${nextFont.id}`;
      style.textContent = fontFaceCss(nextFont);
      document.head.appendChild(style);
    }

    setCustomFonts((previous) => [...previous, nextFont]);
    setNewFontName('');
    setNewFontUrl('');
    setShowAddFont(false);
  };

  const handleRemoveFont = (id: string) => {
    setCustomFonts((previous) => previous.filter((font) => font.id !== id));
    const element = document.getElementById(`font-${id}`);
    if (element) element.remove();
    if (fontFamily === id) {
      setFontFamily('Source Han Serif SC');
    }
  };

  const allFonts = [...builtInFonts, ...customFonts];

  return (
    <motion.aside
      data-reader-panel
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="reader-paper absolute bottom-0 right-0 top-[54px] z-50 flex w-[21rem] max-w-full flex-col border-l"
      style={{
        backgroundColor: uiColor,
        color: textColor,
        borderColor: `${textColor}14`,
      }}
    >
      <div className="flex h-[56px] shrink-0 items-center justify-between border-b px-5" style={{ borderColor: `${textColor}12` }}>
        <span className="reader-panel-eyebrow">{settingsCopy.title}</span>
        <button onClick={onClose} className="reader-panel-close" aria-label="关闭设置">×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
      <div className="mb-8 pt-5">
        <div className="text-xs opacity-70 mb-3">{settingsCopy.theme}</div>
        <div className="flex gap-5">
          {themes.map((item) => (
            <button
              key={item.id}
              onClick={() => setTheme(item.id)}
              className="flex flex-col items-center gap-2"
              aria-pressed={theme === item.id}
              title={item.name}
            >
              <span
                className="h-7 w-7 rounded-full border transition-all"
                style={{
                  backgroundColor: item.color,
                  borderColor: theme === item.id ? textColor : `${textColor}55`,
                  boxShadow: theme === item.id ? `0 0 0 2px ${uiColor}, 0 0 0 3.5px ${textColor}` : 'none',
                }}
              />
              <span className="text-[9.5px] tracking-wide opacity-55">{item.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <div className="flex justify-between text-xs opacity-70 mb-2">
            <span>{settingsCopy.font}</span>
            <button className="text-xs opacity-50 hover:opacity-100 transition-opacity" onClick={() => setShowAddFont((previous) => !previous)}>
              {showAddFont ? settingsCopy.cancel : settingsCopy.add}
            </button>
          </div>

          {showAddFont && (
            <div className="mb-3 p-3 rounded-lg bg-current/5 space-y-2">
              <input
                type="text"
                placeholder={settingsCopy.fontNamePlaceholder}
                value={newFontName}
                onChange={(event) => setNewFontName(event.target.value)}
                className="w-full px-2 py-1 text-xs bg-transparent border border-current/20 rounded focus:outline-none focus:border-current/50"
                style={{ color: textColor }}
              />
              <input
                type="text"
                placeholder={settingsCopy.fontUrlPlaceholder}
                value={newFontUrl}
                onChange={(event) => setNewFontUrl(event.target.value)}
                className="w-full px-2 py-1 text-xs bg-transparent border border-current/20 rounded focus:outline-none focus:border-current/50"
                style={{ color: textColor }}
              />
              <button onClick={handleAddFont} className="w-full py-1 text-xs rounded bg-current/10 hover:bg-current/20 transition-colors">
                {settingsCopy.addFont}
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {allFonts.map((font) => (
              <div key={font.id} className="flex items-center gap-2">
                <button
                  onClick={() => setFontFamily(font.id)}
                  className={`flex-1 text-left px-3 py-2 rounded-lg text-sm transition-colors ${fontFamily === font.id ? 'bg-current/10 font-medium' : 'hover:bg-current/5 opacity-70'}`}
                  style={{ fontFamily: getReaderFontStack(font.id) }}
                >
                  {font.name}
                </button>
                {!font.builtIn && (
                  <button
                    onClick={() => handleRemoveFont(font.id)}
                    className="text-xs opacity-30 hover:opacity-100 hover:text-red-400 transition-opacity"
                    title={settingsCopy.deleteFont}
                  >
                    x
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs opacity-70 mb-2">
            <span>{settingsCopy.layout}</span>
          </div>
          <div className="flex bg-current/10 rounded-lg p-1">
            <button
              onClick={() => setIsTwoPage(false)}
              className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${!isTwoPage ? 'bg-white text-black shadow-sm' : 'opacity-70 hover:opacity-100'}`}
            >
              {settingsCopy.singlePage}
            </button>
            <button
              onClick={() => setIsTwoPage(true)}
              className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${isTwoPage ? 'bg-white text-black shadow-sm' : 'opacity-70 hover:opacity-100'}`}
            >
              {settingsCopy.doublePage}
            </button>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs opacity-70 mb-2" title="生词按掌握度着色，最高 13% 不透明度，不盖住字形。">
            <span>精读</span>
          </div>
          <div className="flex bg-current/10 rounded-lg p-1">
            <button
              onClick={() => setIntensiveMode(true)}
              className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${intensiveMode ? 'bg-white text-black shadow-sm' : 'opacity-70 hover:opacity-100'}`}
            >
              开
            </button>
            <button
              onClick={() => setIntensiveMode(false)}
              className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${!intensiveMode ? 'bg-white text-black shadow-sm' : 'opacity-70 hover:opacity-100'}`}
            >
              关
            </button>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs opacity-70 mb-2">
            <span>{settingsCopy.fontSize}</span>
            <span className="font-mono">{fontSize}px</span>
          </div>
          <input
            type="range"
            min="12"
            max="36"
            step="1"
            value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))}
            className="w-full h-1 bg-current/20 rounded-lg appearance-none cursor-pointer accent-current"
          />
        </div>

        <div>
          <div className="flex justify-between text-xs opacity-70 mb-2">
            <span>{settingsCopy.lineHeight}</span>
            <span className="font-mono">{lineHeight.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="1.2"
            max="2.5"
            step="0.1"
            value={lineHeight}
            onChange={(event) => setLineHeight(Number(event.target.value))}
            className="w-full h-1 bg-current/20 rounded-lg appearance-none cursor-pointer accent-current"
          />
        </div>

        <div>
          <div className="flex justify-between text-xs opacity-70 mb-2" title="窗口变窄时自动收缩，不做超宽行。">
            <span>每行字数</span>
            <span className="font-mono">{chars} 字</span>
          </div>
          <input
            type="range"
            min="26"
            max="46"
            step="2"
            value={chars}
            onChange={(event) => setChars(Number(event.target.value))}
            className="w-full h-1 bg-current/20 rounded-lg appearance-none cursor-pointer accent-current"
          />
        </div>

        <div>
          <div className="flex justify-between items-center text-xs opacity-70 mb-2">
            <span>AI 语境解释</span>
            <button
              onClick={toggleLlm}
              className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                llmEnabled
                  ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 font-medium'
                  : 'border-current/20 opacity-60 hover:opacity-90'
              }`}
            >
              {llmEnabled ? '已开启' : '已关闭'}
            </button>
          </div>

          {llmEnabled ? (
            <div className="flex flex-col gap-2">
              <select
                value={llmTier}
                onChange={(event) => changeLlmTier(event.target.value as LlmModelTier)}
                className="bg-transparent border border-current/20 rounded-lg p-2 text-xs focus:outline-none"
                style={{ color: textColor }}
              >
                <option value="auto" style={{ backgroundColor: uiColor, color: textColor }}>
                  自动（按显存选 4B / 2B）
                </option>
                <option value="qwen3.5:4b" style={{ backgroundColor: uiColor, color: textColor }}>
                  Qwen3.5-4B（约 2.7GB，推荐）
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
                <div className="text-[10px] leading-relaxed flex flex-col gap-0.5">
                  {llmStatus.available ? (
                    <>
                      <span className="text-emerald-600 opacity-90">
                        已就绪 · {llmStatus.model}
                      </span>
                      <span className="opacity-50">
                        {llmStatus.vramMB
                          ? `显存 ${Math.round(llmStatus.vramMB / 1024)} GB`
                          : '未检测到独立显卡，将使用 CPU 推理'}
                      </span>
                    </>
                  ) : (
                    <span className="text-amber-600 opacity-90">{llmStatus.reason}</span>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

      </div>
      </div>
    </motion.aside>
  );
}
