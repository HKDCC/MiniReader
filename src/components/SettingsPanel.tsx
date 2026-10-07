import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { settingsCopy } from '../shared/copy';
import { getReaderFontStack } from '../shared/fonts';

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
  margin,
  setMargin,
  fontFamily,
  setFontFamily,
  isTwoPage,
  setIsTwoPage,
  uiColor,
  textColor,
}: any) {
  const themes = [
    { id: 'warm-white', name: '\u6696\u767D', color: '#F5F0EB' },
    { id: 'beige', name: '\u7C73\u8272', color: '#F5F5DC' },
    { id: 'eye-care', name: '\u62A4\u773C', color: '#E8F0E6' },
    { id: 'dark', name: '\u6697\u8272', color: '#2C2C2C' },
    { id: 'night', name: '\u591C\u95F4', color: '#000000' },
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
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="absolute top-24 right-8 w-80 p-6 rounded-2xl shadow-2xl backdrop-blur-xl z-50 border max-h-[80vh] overflow-y-auto"
      style={{
        backgroundColor: `${uiColor}E6`,
        color: textColor,
        borderColor: `${textColor}15`,
      }}
    >
      <h3 className="text-xs tracking-widest opacity-50 mb-6 font-sans">{settingsCopy.title}</h3>

      <div className="mb-8">
        <div className="text-xs opacity-70 mb-3">{settingsCopy.theme}</div>
        <div className="flex gap-3">
          {themes.map((item) => (
            <button
              key={item.id}
              onClick={() => setTheme(item.id)}
              className={`w-8 h-8 rounded-full border-2 transition-all ${theme === item.id ? 'scale-110' : 'scale-100 opacity-70 hover:opacity-100'}`}
              style={{
                backgroundColor: item.color,
                borderColor: theme === item.id ? textColor : 'transparent',
                boxShadow: theme === item.id ? '0 0 0 1px rgba(0,0,0,0.1)' : 'none',
              }}
              title={item.name}
            />
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
          <div className="flex justify-between text-xs opacity-70 mb-2">
            <span>{settingsCopy.pageWidth}</span>
            <span className="font-mono">{margin}px</span>
          </div>
          <input
            type="range"
            min="400"
            max="2400"
            step="50"
            value={margin}
            onChange={(event) => setMargin(Number(event.target.value))}
            className="w-full h-1 bg-current/20 rounded-lg appearance-none cursor-pointer accent-current"
          />
        </div>

      </div>
    </motion.div>
  );
}
