import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Copy, Minus, Square, X } from 'lucide-react';
import Shelf from './components/Shelf';
import Reader from './components/Reader';
import { BookMeta } from './db/db';
import { appCopy } from './shared/copy';

export type Theme = 'warm-white' | 'kraft' | 'dark' | 'night';
type ShelfTheme = 'light' | 'dark';

const THEMES = {
  'warm-white': { bg: '#F6F3EA', text: '#23261F', ui: '#F0ECE1' },
  kraft: { bg: '#F0EADA', text: '#2A2720', ui: '#E9E3D2' },
  dark: { bg: '#191B17', text: '#E5E2D7', ui: '#141612' },
  night: { bg: '#000000', text: '#E0E0E0', ui: '#111111' },
};

const SHELF_THEMES: Record<ShelfTheme, { bg: string; text: string }> = {
  light: { bg: '#F4F4F0', text: '#20231F' },
  dark: { bg: '#171917', text: '#E8EAE4' },
};

const isElectron = () => typeof window !== 'undefined' && !!(window as any).electron;

export default function App() {
  const [currentView, setCurrentView] = useState<'shelf' | 'reader'>('shelf');
  const [activeBook, setActiveBook] = useState<BookMeta | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('mr_theme');
    if (saved === 'beige' || saved === 'eye-care') return 'kraft';
    return saved && Object.prototype.hasOwnProperty.call(THEMES, saved) ? (saved as Theme) : 'warm-white';
  });
  const [shelfTheme, setShelfTheme] = useState<ShelfTheme>(() => localStorage.getItem('mr_shelfTheme') === 'dark' ? 'dark' : 'light');
  const [isMaximized, setIsMaximized] = useState(false);

  const currentTheme = THEMES[theme];
  const currentShelfTheme = SHELF_THEMES[shelfTheme];

  useEffect(() => {
    localStorage.setItem('mr_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('mr_shelfTheme', shelfTheme);
  }, [shelfTheme]);

  useEffect(() => {
    if (!isElectron()) return;

    (window as any).electron.invoke('window:isMaximized').then((value: boolean) => setIsMaximized(value)).catch(() => undefined);
    const handleMaximizedChanged = (value: boolean) => setIsMaximized(Boolean(value));
    (window as any).electron.on('window:maximized-changed', handleMaximizedChanged);

    return () => (window as any).electron.off?.('window:maximized-changed', handleMaximizedChanged);
  }, []);

  useEffect(() => {
    if (!isElectron()) return;

    const handleOpenedFiles = () => {
      setActiveBook(null);
      setCurrentView('shelf');
    };

    (window as any).electron.on('files:opened', handleOpenedFiles);
    return () => (window as any).electron.off?.('files:opened', handleOpenedFiles);
  }, []);

  const handleMinimize = () => (window as any).electron.send('window:minimize');
  const handleMaximize = () => (window as any).electron.send('window:maximize');
  const handleClose = () => (window as any).electron.send('window:close');

  const openBook = (book: BookMeta) => {
    setActiveBook(book);
    setCurrentView('reader');
  };

  const closeBook = () => {
    setCurrentView('shelf');
    setActiveBook(null);
  };

  const dragStyle = {
    backgroundColor: currentView === 'shelf' ? undefined : currentTheme.bg,
    WebkitAppRegion: 'drag',
  } as any;

  const noDragStyle = { WebkitAppRegion: 'no-drag' } as any;

  return (
    <div
      className={`w-full h-screen flex flex-col overflow-hidden font-sans selection:bg-black/10 ${currentView === 'shelf' ? 'shelf-canvas' : ''}`}
      data-shelf-theme={currentView === 'shelf' ? shelfTheme : undefined}
      style={{
        backgroundColor: currentView === 'shelf' ? currentShelfTheme.bg : currentTheme.bg,
        color: currentView === 'shelf' ? currentShelfTheme.text : currentTheme.text,
        colorScheme:
          currentView === 'shelf'
            ? shelfTheme === 'dark'
              ? 'dark'
              : 'light'
            : theme === 'dark' || theme === 'night'
              ? 'dark'
              : 'light',
      }}
    >
      {isElectron() && (
        <div className={`h-8 flex items-center justify-between px-3 select-none shrink-0 ${currentView === 'shelf' ? 'shelf-window-bar' : ''}`} style={dragStyle}>
          <div className="flex-1 truncate text-[11px] opacity-40 pr-4">{currentView === 'reader' ? '' : appCopy.appName}</div>

          <div className="flex items-center" style={noDragStyle}>
            <button
              onClick={handleMinimize}
              className="w-11 h-8 flex items-center justify-center hover:bg-black/10 transition-colors text-current/75 hover:text-current"
              title={appCopy.minimize}
              aria-label={appCopy.minimize}
              type="button"
            >
              <Minus size={14} strokeWidth={1.5} />
            </button>
            <button
              onClick={handleMaximize}
              className="w-11 h-8 flex items-center justify-center hover:bg-black/10 transition-colors text-current/75 hover:text-current"
              title={isMaximized ? appCopy.restore : appCopy.maximize}
              aria-label={isMaximized ? appCopy.restore : appCopy.maximize}
              type="button"
            >
              {isMaximized ? <Copy size={13} strokeWidth={1.4} /> : <Square size={12} strokeWidth={1.5} />}
            </button>
            <button
              onClick={handleClose}
              className="w-11 h-8 flex items-center justify-center hover:bg-[#c42b1c] hover:text-white transition-colors text-current/75 hover:opacity-100"
              title={appCopy.close}
              aria-label={appCopy.close}
              type="button"
            >
              <X size={13} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        {currentView === 'shelf' ? (
          <Shelf
            onOpenBook={openBook}
            shelfTheme={shelfTheme}
            onToggleShelfTheme={() => setShelfTheme((mode) => mode === 'light' ? 'dark' : 'light')}
          />
        ) : (
          <AnimatePresence mode="wait">
            {activeBook && (
              <motion.div
                key="reader"
                className="w-full h-full min-h-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Reader book={activeBook} onClose={closeBook} theme={theme} setTheme={setTheme} currentTheme={currentTheme} />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
