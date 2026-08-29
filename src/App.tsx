import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Shelf from './components/Shelf';
import Reader from './components/Reader';
import { BookMeta } from './db/db';
import { appCopy } from './shared/copy';

export type Theme = 'warm-white' | 'beige' | 'eye-care' | 'dark' | 'night';

const THEMES = {
  'warm-white': { bg: '#F5F0EB', text: '#2C2C2C', ui: '#ECEBEA' },
  beige: { bg: '#F5F5DC', text: '#3E352B', ui: '#EAEAD1' },
  'eye-care': { bg: '#E8F0E6', text: '#2C3E2D', ui: '#DCE5DA' },
  dark: { bg: '#2C2C2C', text: '#E0E0E0', ui: '#3A3A3A' },
  night: { bg: '#000000', text: '#E0E0E0', ui: '#111111' },
};

const isElectron = () => typeof window !== 'undefined' && !!(window as any).electron;

export default function App() {
  const [currentView, setCurrentView] = useState<'shelf' | 'reader'>('shelf');
  const [activeBook, setActiveBook] = useState<BookMeta | null>(null);
  const [theme, setTheme] = useState<Theme>('warm-white');
  const [isMaximized, setIsMaximized] = useState(false);

  const currentTheme = THEMES[theme];

  useEffect(() => {
    if (!isElectron()) return;

    (window as any).electron.invoke('window:isMaximized').then((value: boolean) => setIsMaximized(value));
    const interval = setInterval(async () => {
      if (!isElectron()) return;
      const value = await (window as any).electron.invoke('window:isMaximized');
      setIsMaximized(value);
    }, 500);

    return () => clearInterval(interval);
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
    backgroundColor: currentTheme.ui,
    WebkitAppRegion: 'drag',
  } as any;

  const noDragStyle = { WebkitAppRegion: 'no-drag' } as any;

  return (
    <div
      className="w-full h-screen flex flex-col overflow-hidden font-sans selection:bg-black/10"
      style={{ backgroundColor: currentTheme.bg, color: currentTheme.text }}
    >
      {isElectron() && (
        <div className="h-8 flex items-center justify-between px-3 select-none shrink-0" style={dragStyle}>
          <div className="flex-1 truncate text-[11px] opacity-40 pr-4">{currentView === 'reader' && activeBook ? activeBook.title : appCopy.appName}</div>

          <div className="flex items-center gap-1" style={noDragStyle}>
            <button
              onClick={handleMinimize}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/10 transition-colors text-[10px] opacity-50 hover:opacity-100"
              title={appCopy.minimize}
            >
              -
            </button>
            <button
              onClick={handleMaximize}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/10 transition-colors text-[10px] opacity-50 hover:opacity-100"
              title={isMaximized ? appCopy.restore : appCopy.maximize}
            >
              {isMaximized ? '[]' : '[ ]'}
            </button>
            <button
              onClick={handleClose}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-500 hover:text-white transition-colors text-[10px] opacity-50 hover:opacity-100"
              title={appCopy.close}
            >
              x
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        {currentView === 'shelf' ? (
          <Shelf onOpenBook={openBook} uiColor={currentTheme.ui} />
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
