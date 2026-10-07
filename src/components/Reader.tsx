import React, { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, Maximize, Minimize, ArrowLeft, List, StickyNote, Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Theme } from '../App';
import { BookMeta, db } from '../db/db';
import SettingsPanel from './SettingsPanel';
import NotesPanel from './NotesPanel';
import TocPanel from './TocPanel';
import type { EpubViewerRef } from './EpubViewer';
import TxtViewer from './TxtViewer';
const EpubViewer = lazy(() => import('./EpubViewer'));
const PdfViewer = lazy(() => import('./PdfViewer'));
import { readerCopy } from '../shared/copy';
import { isEditableTarget } from '../shared/dom';
import type { ReaderPageInfo } from './readerTypes';

export default function Reader({
  book,
  onClose,
  theme,
  setTheme,
  currentTheme,
}: {
  book: BookMeta;
  onClose: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  currentTheme: { bg: string; text: string; ui: string };
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState(book.progress || 0);
  const [pageInfo, setPageInfo] = useState<ReaderPageInfo | null>(null);
  const [sliderPreview, setSliderPreview] = useState<number | null>(null);
  const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);
  const [txtData, setTxtData] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const viewerRef = useRef<EpubViewerRef | any>(null);
  const viewerSurfaceRef = useRef<HTMLDivElement | null>(null);
  const sliderFocusedRef = useRef(false);
  const lastLocationRef = useRef<string | null>(null);
  const fadeAnimationRef = useRef<Animation | null>(null);
  const sliderInteractionRef = useRef<'pointer' | 'keyboard' | null>(null);
  const keyboardSeekProgressRef = useRef<number | null>(null);
  const pendingKeyboardSeekCountRef = useRef(0);
  const lastKeyboardSeekAtRef = useRef(0);
  const pendingSliderSeekRef = useRef<{ fromLocation: string | null; timeout: number } | null>(null);
  const leftControlsRef = useRef<HTMLDivElement | null>(null);
  const rightControlsRef = useRef<HTMLDivElement | null>(null);

  const [uiVisible, setUiVisible] = useState(false);
  const [leftRailVisible, setLeftRailVisible] = useState(false);
  const [progressVisible, setProgressVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMessage, setSearchMessage] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toc, setToc] = useState<any[]>([]);
  const [showHint, setShowHint] = useState(true);
  const handleViewerReady = useCallback(() => setIsLoading(false), []);

  const [fontSize, setFontSize] = useState(() => {
    const value = localStorage.getItem('mr_fontSize');
    return value ? Number(value) : 24;
  });
  const [lineHeight, setLineHeight] = useState(() => {
    const value = localStorage.getItem('mr_lineHeight');
    return value ? Number(value) : 1.7;
  });
  const [margin, setMargin] = useState(() => {
    const value = localStorage.getItem('mr_margin');
    return value ? Number(value) : 2200;
  });
  const [fontFamily, setFontFamily] = useState(() => {
    const saved = localStorage.getItem('mr_fontFamily');
    return saved === 'SimSun' ? 'Source Han Serif SC' : saved || 'Source Han Serif SC';
  });
  const [isTwoPage, setIsTwoPage] = useState(() => localStorage.getItem('mr_isTwoPage') !== 'false');
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  const notes = useLiveQuery(() => db.notes.where('bookId').equals(book.id).reverse().toArray()) || [];
  const [selection, setSelection] = useState<{ cfiRange: string; text: string; x: number; y: number } | null>(null);
  const [isWritingNote, setIsWritingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [selectedColor, setSelectedColor] = useState('#fcd34d');

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 3200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => localStorage.setItem('mr_fontSize', String(fontSize)), [fontSize]);
  useEffect(() => localStorage.setItem('mr_lineHeight', String(lineHeight)), [lineHeight]);
  useEffect(() => localStorage.setItem('mr_margin', String(margin)), [margin]);
  useEffect(() => localStorage.setItem('mr_fontFamily', fontFamily), [fontFamily]);
  useEffect(() => localStorage.setItem('mr_isTwoPage', String(isTwoPage)), [isTwoPage]);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!selection) {
      setIsWritingNote(false);
      setNoteText('');
      setSelectedColor('#fcd34d');
    }
  }, [selection]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const loadContent = async () => {
      setIsLoading(true);
      setLoadError(null);
      setEpubData(null);
      setTxtData(null);
      setPdfData(null);
      try {
        const contentRecord = await db.contents.get(book.id);
        if (!contentRecord) {
          throw new Error('Content not found');
        }

        if (book.format === 'txt') {
          setTxtData(contentRecord.data as string);
        } else if (book.format === 'epub') {
          setEpubData(contentRecord.data as ArrayBuffer);
        } else if (book.format === 'pdf') {
          setPdfData(contentRecord.data as ArrayBuffer);
        }
      } catch (error) {
        console.error('Failed to load content', error);
        setLoadError('无法加载书籍内容，请重新导入文件。');
        setIsLoading(false);
      }
    };

    loadContent();
  }, [book.id, book.format]);

  useEffect(() => {
    setProgress(book.progress || 0);
    setPageInfo(null);
    setSliderPreview(null);
    keyboardSeekProgressRef.current = null;
    pendingKeyboardSeekCountRef.current = 0;
    lastKeyboardSeekAtRef.current = 0;
    if (pendingSliderSeekRef.current) window.clearTimeout(pendingSliderSeekRef.current.timeout);
    pendingSliderSeekRef.current = null;
    fadeAnimationRef.current?.cancel();
    fadeAnimationRef.current = null;
    lastLocationRef.current = null;
    setToc([]);
    setSelection(null);
    setSettingsOpen(false);
    setNotesOpen(false);
    setTocOpen(false);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchMessage('');
  }, [book.id]);

  const handleLocationChange = useCallback(
    async (percentage: number, cfi: string, nextPageInfo?: ReaderPageInfo) => {
      const normalizedProgress = percentage > 1 ? percentage : percentage * 100;
      const nextProgress = Number.isNaN(normalizedProgress) ? 0 : Math.min(100, Math.max(0, Math.round(normalizedProgress)));
      setProgress(nextProgress);
      setPageInfo((previous) => {
        const next = nextPageInfo ?? null;
        if (previous?.current === next?.current && previous?.total === next?.total) return previous;
        return next;
      });
      if (pendingKeyboardSeekCountRef.current > 0) {
        pendingKeyboardSeekCountRef.current -= 1;
      } else {
        keyboardSeekProgressRef.current = null;
      }

      const previousLocation = lastLocationRef.current;
      lastLocationRef.current = cfi;
      if (previousLocation && previousLocation !== cfi && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        fadeAnimationRef.current?.cancel();
        const surface = viewerSurfaceRef.current;
        if (surface) {
          fadeAnimationRef.current = surface.animate(
            [{ opacity: 1 }, { opacity: 0.84, offset: 0.45 }, { opacity: 1 }],
            { duration: 120, easing: 'ease-out' }
          );
        }
      }

      const pendingSliderSeek = pendingSliderSeekRef.current;
      if (pendingSliderSeek && cfi !== pendingSliderSeek.fromLocation) {
        window.clearTimeout(pendingSliderSeek.timeout);
        pendingSliderSeekRef.current = null;
        setSliderPreview(null);
      } else if (!pendingSliderSeek && sliderInteractionRef.current === null) {
        setSliderPreview(null);
      }
      await db.books.update(book.id, {
        progress: nextProgress,
        cfi,
        lastReadAt: Date.now(),
      });
    },
    [book.id]
  );

  const finishSliderSeek = useCallback((value: number, keyboard = false) => {
    sliderInteractionRef.current = null;
    const normalized = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : progress;
    setSliderPreview(normalized);
    if (pendingSliderSeekRef.current) window.clearTimeout(pendingSliderSeekRef.current.timeout);
    const timeout = window.setTimeout(() => {
      pendingSliderSeekRef.current = null;
      setSliderPreview(null);
    }, 1500);
    pendingSliderSeekRef.current = { fromLocation: lastLocationRef.current, timeout };
    if (keyboard) {
      keyboardSeekProgressRef.current = normalized;
      pendingKeyboardSeekCountRef.current += 1;
      lastKeyboardSeekAtRef.current = Date.now();
    } else {
      keyboardSeekProgressRef.current = null;
      pendingKeyboardSeekCountRef.current = 0;
    }
    viewerRef.current?.seekToProgress(normalized / 100);
  }, [progress]);

  const cancelSliderSeek = useCallback(() => {
    sliderInteractionRef.current = null;
    if (pendingSliderSeekRef.current) window.clearTimeout(pendingSliderSeekRef.current.timeout);
    pendingSliderSeekRef.current = null;
    setSliderPreview(null);
  }, []);

  const nextPage = useCallback(() => {
    keyboardSeekProgressRef.current = null;
    pendingKeyboardSeekCountRef.current = 0;
    viewerRef.current?.next();
  }, []);

  const prevPage = useCallback(() => {
    keyboardSeekProgressRef.current = null;
    pendingKeyboardSeekCountRef.current = 0;
    viewerRef.current?.prev();
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((error) => console.error(error));
      setIsFullscreen(true);
      return;
    }

    if (document.exitFullscreen) {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  const handleAddHighlight = async (color: string, note: string = '') => {
    if (!selection) return;

    await db.notes.add({
      bookId: book.id,
      text: selection.text,
      note,
      color,
      cfi: selection.cfiRange,
      createdAt: Date.now(),
    });

    setSelection(null);
    viewerRef.current?.clearSelection();
  };

  const closeAllPanels = useCallback(() => {
    setSettingsOpen(false);
    setNotesOpen(false);
    setTocOpen(false);
  }, []);

  const handleKeyPress = useCallback(
    (key: string) => {
      if (key === 'ArrowRight' || key === ' ') {
        nextPage();
        return;
      }

      if (key === 'ArrowLeft') {
        prevPage();
        return;
      }

      if (key === 'Escape') {
        if (settingsOpen || notesOpen || tocOpen) {
          closeAllPanels();
        } else if (selection) {
          setSelection(null);
          viewerRef.current?.clearSelection();
        } else if (isFullscreen) {
          document.exitFullscreen();
          setIsFullscreen(false);
        } else {
          onClose();
        }
        return;
      }

      if (key === 'm' || key === 'M') {
        setSettingsOpen((previous) => !previous);
        setNotesOpen(false);
        setTocOpen(false);
        setUiVisible(true);
        return;
      }

      if (key === 'n' || key === 'N') {
        setNotesOpen((previous) => !previous);
        setSettingsOpen(false);
        setTocOpen(false);
        setUiVisible(true);
        return;
      }

      if (key === 'f' || key === 'F') {
        toggleFullscreen();
      }
    },
    [closeAllPanels, isFullscreen, nextPage, notesOpen, onClose, prevPage, selection, settingsOpen, tocOpen, toggleFullscreen]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        setUiVisible(true);
        return;
      }
      if (isEditableTarget(event.target)) {
        if (event.key === 'Escape') {
          handleKeyPress(event.key);
        }
        return;
      }

      handleKeyPress(event.key);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyPress]);

  const uiTimeoutRef = useRef<number | null>(null);
  const leftRailTimeoutRef = useRef<number | null>(null);
  const progressTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const isNearTopEdge = event.clientY < 24;
      const isNearRightEdge = event.clientX > window.innerWidth - 24;
      const isNearLeftEdge = event.clientX < 72;
      const isNearBottomEdge = event.clientY > window.innerHeight - 72;

      if (isNearLeftEdge) {
        setLeftRailVisible(true);
        if (leftRailTimeoutRef.current) {
          window.clearTimeout(leftRailTimeoutRef.current);
          leftRailTimeoutRef.current = null;
        }
      } else if (!notesOpen && !tocOpen) {
        if (leftRailTimeoutRef.current) {
          window.clearTimeout(leftRailTimeoutRef.current);
        }
        leftRailTimeoutRef.current = window.setTimeout(() => setLeftRailVisible(false), 720);
      }

      if (isNearBottomEdge || sliderInteractionRef.current !== null || sliderFocusedRef.current) {
        setProgressVisible(true);
        if (progressTimeoutRef.current) {
          window.clearTimeout(progressTimeoutRef.current);
          progressTimeoutRef.current = null;
        }
      } else {
        if (progressTimeoutRef.current) {
          window.clearTimeout(progressTimeoutRef.current);
        }
        progressTimeoutRef.current = window.setTimeout(() => {
          if (!sliderFocusedRef.current && sliderInteractionRef.current === null) setProgressVisible(false);
        }, 720);
      }

      if (isNearTopEdge || isNearRightEdge) {
        setUiVisible(true);
        if (uiTimeoutRef.current) {
          window.clearTimeout(uiTimeoutRef.current);
          uiTimeoutRef.current = null;
        }
        return;
      }

      if (!settingsOpen && !notesOpen && !tocOpen) {
        if (uiTimeoutRef.current) {
          window.clearTimeout(uiTimeoutRef.current);
        }
        uiTimeoutRef.current = window.setTimeout(() => setUiVisible(false), 1600);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (uiTimeoutRef.current) {
        window.clearTimeout(uiTimeoutRef.current);
      }
      if (leftRailTimeoutRef.current) {
        window.clearTimeout(leftRailTimeoutRef.current);
      }
      if (progressTimeoutRef.current) {
        window.clearTimeout(progressTimeoutRef.current);
      }
    };
  }, [notesOpen, settingsOpen, tocOpen]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!uiVisible || settingsOpen || notesOpen || tocOpen) return;

      const target = event.target as Node | null;
      if (!target) return;

      if (leftControlsRef.current?.contains(target) || rightControlsRef.current?.contains(target)) {
        return;
      }

      setUiVisible(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [notesOpen, settingsOpen, tocOpen, uiVisible]);

  const iconButtonStyle = (active: boolean = false) => ({
    backgroundColor: active ? `${currentTheme.text}1D` : `${currentTheme.ui}D8`,
    color: currentTheme.text,
    border: `1px solid ${currentTheme.text}${active ? '28' : '12'}`,
    boxShadow: active ? `0 16px 34px ${currentTheme.text}1C` : `0 10px 24px ${currentTheme.text}10`,
  });

  const runSearch = async (direction = 1) => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchMessage('请输入关键词');
      return;
    }
    setSearchBusy(true);
    try {
      const result = viewerRef.current?.search?.(query, direction) ?? false;
      const found = result instanceof Promise ? await result : result;
      setSearchMessage(found ? '' : '未找到匹配内容');
    } catch (error) {
      console.warn('Search failed', error);
      setSearchMessage('搜索失败');
    } finally {
      setSearchBusy(false);
    }
  };

  const viewerMaxWidth = Math.max(720, Math.min(margin, windowWidth - 48));
  const pageHitZoneWidth = windowWidth < 900 ? 24 : windowWidth < 1280 ? 32 : 44;

  return (
    <div className="w-full h-full min-h-0 relative flex justify-center items-center">
      {(settingsOpen || notesOpen || tocOpen) && <div className="absolute inset-0 z-30" onClick={closeAllPanels} />}

      <div ref={leftControlsRef} className="absolute left-4 top-4 z-40 flex flex-col items-start gap-2">
        <motion.button
          onClick={onClose}
          whileHover={{ x: 2, y: -1, transition: { duration: 0.18 } }}
          whileTap={{ scale: 0.96 }}
          className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-xl transition-opacity opacity-70 hover:opacity-100"
          style={iconButtonStyle(false)}
          title={readerCopy.back}
          aria-label={readerCopy.back}
        >
          <ArrowLeft size={18} strokeWidth={1.8} />
        </motion.button>

        <AnimatePresence>
          {(leftRailVisible || notesOpen || tocOpen) && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
              exit={{ opacity: 0, x: -10, transition: { duration: 0.16 } }}
              className="flex flex-col gap-2"
            >
              <motion.button
                onClick={() => {
                  setTocOpen((previous) => !previous);
                  setNotesOpen(false);
                  setSettingsOpen(false);
                  setLeftRailVisible(true);
                }}
                whileHover={{ x: 2, y: -1, transition: { duration: 0.18 } }}
                whileTap={{ scale: 0.96 }}
                className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-xl transition-opacity opacity-70 hover:opacity-100"
                style={iconButtonStyle(tocOpen)}
                title={readerCopy.toc}
                aria-label={readerCopy.toc}
              >
                <List size={18} strokeWidth={1.8} />
              </motion.button>

              <motion.button
                onClick={() => {
                  setNotesOpen((previous) => !previous);
                  setSettingsOpen(false);
                  setTocOpen(false);
                  setLeftRailVisible(true);
                }}
                whileHover={{ x: 2, y: -1, transition: { duration: 0.18 } }}
                whileTap={{ scale: 0.96 }}
                className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-xl transition-opacity opacity-70 hover:opacity-100"
                style={iconButtonStyle(notesOpen)}
                title={readerCopy.notes}
                aria-label={readerCopy.notes}
              >
                <StickyNote size={18} strokeWidth={1.8} />
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {(uiVisible || settingsOpen) && (
          <motion.div
            ref={rightControlsRef}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="absolute right-4 top-4 z-40 flex flex-col gap-3"
          >
            <button
              onClick={() => {
                setSearchOpen((previous) => !previous);
                setSettingsOpen(false);
                setNotesOpen(false);
                setTocOpen(false);
              }}
              className="p-2.5 rounded-xl transition-all"
              style={{
                backgroundColor: searchOpen ? `${currentTheme.text}22` : `${currentTheme.ui}CC`,
                opacity: searchOpen ? 1 : 0.55,
              }}
              title="搜索 (Ctrl+F)"
              aria-label="搜索"
            >
              <Search size={16} strokeWidth={1.5} />
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-2.5 rounded-xl opacity-55 hover:opacity-100 transition-opacity"
              style={{ backgroundColor: `${currentTheme.ui}CC` }}
              title={`${readerCopy.fullscreen} (F)`}
            >
              {isFullscreen ? <Minimize size={16} strokeWidth={1.5} /> : <Maximize size={16} strokeWidth={1.5} />}
            </button>

            <button
              onClick={() => {
                setSettingsOpen((previous) => !previous);
                setNotesOpen(false);
                setTocOpen(false);
              }}
              className="p-2.5 rounded-xl transition-all"
              style={{
                backgroundColor: settingsOpen ? `${currentTheme.text}22` : `${currentTheme.ui}CC`,
                opacity: settingsOpen ? 1 : 0.55,
              }}
              title={`${readerCopy.settings} (M)`}
            >
              <Settings size={16} strokeWidth={1.5} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {searchOpen && (
          <motion.form
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            onSubmit={(event) => {
              event.preventDefault();
              runSearch(1);
            }}
            className="absolute right-4 top-20 z-40 flex items-center gap-1 rounded-2xl border p-2 shadow-xl backdrop-blur-xl"
            style={{ backgroundColor: `${currentTheme.ui}F2`, borderColor: `${currentTheme.text}18` }}
          >
            <Search size={14} className="mx-1 opacity-50" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchMessage('');
              }}
              placeholder="搜索书内内容"
              className="w-44 bg-transparent px-1 text-sm outline-none"
              style={{ color: currentTheme.text }}
              aria-label="搜索书内内容"
            />
            <button type="button" disabled={searchBusy} onClick={() => void runSearch(-1)} className="rounded-lg p-1.5 opacity-60 hover:opacity-100 disabled:opacity-30" title="上一个">
              <ChevronUp size={15} />
            </button>
            <button type="button" disabled={searchBusy} onClick={() => void runSearch(1)} className="rounded-lg p-1.5 opacity-60 hover:opacity-100 disabled:opacity-30" title="下一个">
              <ChevronDown size={15} />
            </button>
            <button type="button" onClick={() => setSearchOpen(false)} className="rounded-lg p-1.5 opacity-60 hover:opacity-100" title="关闭">
              <X size={15} />
            </button>
            {searchMessage && <span className="px-2 text-xs opacity-60">{searchMessage}</span>}
          </motion.form>
        )}
      </AnimatePresence>

      <div ref={viewerSurfaceRef} className="w-full h-full min-h-0 flex justify-center items-center px-8 py-4 overflow-hidden" style={{ maxWidth: viewerMaxWidth }}>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="opacity-50 font-serif animate-pulse">{readerCopy.loading}</div>
          </div>
        )}

        <Suspense fallback={<div className="opacity-50 font-serif animate-pulse">{readerCopy.loading}</div>}>
        {book.format === 'epub' && epubData ? (
          <div className={`w-full h-full min-h-0 transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
            <EpubViewer
              key={book.id}
              ref={viewerRef}
              data={epubData}
              theme={theme}
              currentTheme={currentTheme}
              fontSize={fontSize}
              lineHeight={lineHeight}
              fontFamily={fontFamily}
              isTwoPage={isTwoPage}
              initialCfi={book.cfi}
              notes={notes}
              onLocationChange={handleLocationChange}
              onTextSelected={setSelection}
              onKeyPress={handleKeyPress}
              onReady={handleViewerReady}
              onError={() => {
                setLoadError('无法解析 EPUB 文件，请重新导入。');
                setIsLoading(false);
              }}
              onTocLoaded={setToc}
            />
          </div>
        ) : null}

        {loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center opacity-70">
            <p className="font-serif text-lg">{loadError}</p>
            <button className="px-4 py-2 rounded-xl border border-current/20 hover:bg-black/5 dark:hover:bg-white/5" onClick={onClose}>
              返回书架
            </button>
          </div>
        ) : null}

        {book.format === 'txt' && txtData !== null && !loadError ? (
          <div className={`w-full h-full min-h-0 transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
            <TxtViewer
              key={book.id}
              ref={viewerRef}
              text={txtData}
              theme={theme}
              currentTheme={currentTheme}
              fontSize={fontSize}
              lineHeight={lineHeight}
              fontFamily={fontFamily}
              isTwoPage={isTwoPage}
              initialCfi={book.cfi}
              notes={notes}
              onLocationChange={handleLocationChange}
              onTextSelected={setSelection}
              onKeyPress={handleKeyPress}
              onReady={handleViewerReady}
            />
          </div>
        ) : null}

        {book.format === 'pdf' && pdfData ? (
          <div className={`w-full h-full min-h-0 transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
            <PdfViewer
              key={book.id}
              ref={viewerRef}
              data={pdfData}
              theme={theme}
              currentTheme={currentTheme}
              fontSize={fontSize}
              lineHeight={lineHeight}
              isTwoPage={isTwoPage}
              initialCfi={book.cfi}
              notes={notes}
              onLocationChange={handleLocationChange}
              onTextSelected={setSelection}
              onKeyPress={handleKeyPress}
              onReady={handleViewerReady}
              onError={() => {
                setLoadError('无法解析 PDF 文件，请重新导入。');
                setIsLoading(false);
              }}
              onTocLoaded={setToc}
            />
          </div>
        ) : null}
        </Suspense>
      </div>

      <AnimatePresence>
        {tocOpen && (
          <TocPanel
            toc={toc}
            onSelect={(href) => {
              viewerRef.current?.goTo(href);
              setTocOpen(false);
              setUiVisible(false);
            }}
            onClose={() => setTocOpen(false)}
            uiColor={currentTheme.ui}
            textColor={currentTheme.text}
          />
        )}
      </AnimatePresence>

      {!isLoading && (
          <motion.div
            initial={false}
            animate={{ opacity: progressVisible ? 1 : 0, y: progressVisible ? 0 : 14 }}
            transition={{ duration: 0.16 }}
            onMouseEnter={() => {
              setProgressVisible(true);
              if (progressTimeoutRef.current) {
                window.clearTimeout(progressTimeoutRef.current);
                progressTimeoutRef.current = null;
              }
            }}
            className="absolute bottom-0 left-0 right-0 z-40 px-8 pb-3 pt-8"
            style={{ pointerEvents: progressVisible ? 'auto' : 'none' }}
          >
            <div className="mx-auto w-full max-w-5xl">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="rounded-full px-2.5 py-1 text-[11px] font-serif backdrop-blur-md" style={{ backgroundColor: `${currentTheme.ui}D8`, color: currentTheme.text }}>
                  {pageInfo ? `第 ${pageInfo.current} / ${pageInfo.total} 页` : '页码计算中'}
                </span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-mono backdrop-blur-md" style={{ backgroundColor: `${currentTheme.ui}D8`, color: currentTheme.text }}>
                  {sliderPreview ?? progress}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={sliderPreview ?? progress}
                aria-label="阅读进度"
                aria-valuetext={`${pageInfo ? `第 ${pageInfo.current} / ${pageInfo.total} 页` : '页码计算中'}，${sliderPreview ?? progress}%`}
                onFocus={() => {
                  sliderFocusedRef.current = true;
                  setProgressVisible(true);
                  if (progressTimeoutRef.current) {
                    window.clearTimeout(progressTimeoutRef.current);
                    progressTimeoutRef.current = null;
                  }
                }}
                onBlur={(event) => {
                  sliderFocusedRef.current = false;
                  if (sliderInteractionRef.current === 'keyboard') {
                    if (keyboardSeekProgressRef.current !== null) {
                      finishSliderSeek(keyboardSeekProgressRef.current, true);
                    } else {
                      sliderInteractionRef.current = null;
                    }
                  }
                  if (progressTimeoutRef.current) window.clearTimeout(progressTimeoutRef.current);
                  progressTimeoutRef.current = window.setTimeout(() => {
                    if (!sliderFocusedRef.current && sliderInteractionRef.current === null) setProgressVisible(false);
                  }, 720);
                }}
                onChange={(event) => setSliderPreview(Number(event.currentTarget.value))}
                onPointerDown={(event) => {
                  if (pendingSliderSeekRef.current) window.clearTimeout(pendingSliderSeekRef.current.timeout);
                  pendingSliderSeekRef.current = null;
                  keyboardSeekProgressRef.current = null;
                  pendingKeyboardSeekCountRef.current = 0;
                  sliderInteractionRef.current = 'pointer';
                  setProgressVisible(true);
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerUp={(event) => {
                  if (sliderInteractionRef.current === 'pointer') finishSliderSeek(Number(event.currentTarget.value));
                }}
                onPointerCancel={cancelSliderSeek}
                onKeyDown={(event) => {
                  const supportedKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
                  if (!supportedKeys.includes(event.key)) return;
                  event.preventDefault();
                  if (pendingSliderSeekRef.current) window.clearTimeout(pendingSliderSeekRef.current.timeout);
                  pendingSliderSeekRef.current = null;
                  sliderInteractionRef.current = 'keyboard';
                  setProgressVisible(true);

                  if (['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown'].includes(event.key)) {
                    keyboardSeekProgressRef.current = null;
                    pendingKeyboardSeekCountRef.current = 0;
                    lastKeyboardSeekAtRef.current = 0;
                    setSliderPreview(null);
                    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextPage();
                    else prevPage();
                    return;
                  }

                  const now = Date.now();
                  if (!lastKeyboardSeekAtRef.current || now - lastKeyboardSeekAtRef.current > 1200) {
                    keyboardSeekProgressRef.current = null;
                    pendingKeyboardSeekCountRef.current = 0;
                  }
                  lastKeyboardSeekAtRef.current = now;

                  const current = keyboardSeekProgressRef.current ?? sliderPreview ?? progress;
                  const next = event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? 100
                      : event.key === 'PageDown'
                        ? current + 10
                        : current - 10;
                  const normalized = Math.min(100, Math.max(0, Math.round(next)));
                  keyboardSeekProgressRef.current = normalized;
                  setSliderPreview(normalized);
                }}
                onKeyUp={(event) => {
                  if (sliderInteractionRef.current === 'keyboard' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
                    if (keyboardSeekProgressRef.current !== null) {
                      finishSliderSeek(keyboardSeekProgressRef.current, true);
                    } else {
                      sliderInteractionRef.current = null;
                    }
                  }
                }}
                className="reader-progress-slider block h-3 w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4"
                style={{
                  color: currentTheme.text,
                  '--progress': `${sliderPreview ?? progress}%`,
                  '--progress-color': currentTheme.text,
                  '--track-color': `${currentTheme.text}24`,
                  touchAction: 'none',
                } as React.CSSProperties}
              />
            </div>
          </motion.div>
      )}

      <div className="absolute top-0 left-0 h-full cursor-w-resize z-10" style={{ width: pageHitZoneWidth }} onClick={prevPage} />
      <div className="absolute top-0 right-0 h-full cursor-e-resize z-10" style={{ width: pageHitZoneWidth }} onClick={nextPage} />

      <AnimatePresence>
        {showHint && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.4 }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full text-[11px] tracking-widest opacity-60 backdrop-blur-md"
            style={{
              backgroundColor: `${currentTheme.ui}CC`,
              border: `1px solid ${currentTheme.text}15`,
              color: currentTheme.text,
            }}
          >
            {readerCopy.keyboardHint}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <SettingsPanel
            theme={theme}
            setTheme={setTheme}
            fontSize={fontSize}
            setFontSize={setFontSize}
            lineHeight={lineHeight}
            setLineHeight={setLineHeight}
            margin={margin}
            setMargin={setMargin}
            fontFamily={fontFamily}
            setFontFamily={setFontFamily}
            isTwoPage={isTwoPage}
            setIsTwoPage={setIsTwoPage}
            uiColor={currentTheme.ui}
            textColor={currentTheme.text}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {notesOpen && (
          <NotesPanel
            uiColor={currentTheme.ui}
            textColor={currentTheme.text}
            notes={notes}
            onClose={() => setNotesOpen(false)}
            onDeleteNote={async (id: number) => {
              if (!window.confirm('确定删除这条笔记吗？')) return;
              await db.notes.delete(id);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selection && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 8 }}
            className="absolute z-50 flex flex-col gap-2 p-3 rounded-2xl shadow-xl backdrop-blur-xl min-w-64"
            style={{
              left: Math.min(selection.x, window.innerWidth - 280),
              top: selection.y < 80 ? selection.y + 16 : selection.y - 16,
              transform: selection.y < 80 ? 'none' : 'translateY(-100%)',
              backgroundColor: `${currentTheme.ui}F5`,
              border: `1px solid ${currentTheme.text}18`,
              color: currentTheme.text,
            }}
          >
            {isWritingNote ? (
              <div className="flex flex-col gap-2">
                <textarea
                  autoFocus
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  placeholder={readerCopy.notePlaceholder}
                  className="w-72 h-28 bg-transparent border border-current/15 rounded-xl p-3 text-sm focus:outline-none focus:border-current/40 resize-none"
                  style={{ color: currentTheme.text }}
                />
                <div className="flex justify-between items-center">
                  <div className="flex gap-1.5">
                    {[
                      { color: '#fcd34d', label: readerCopy.yellow },
                      { color: '#86efac', label: readerCopy.green },
                      { color: '#fca5a5', label: readerCopy.red },
                    ].map((item) => (
                      <button
                        key={item.color}
                        className={`w-4 h-4 rounded-full transition-all ${selectedColor === item.color ? 'ring-2 ring-offset-1 ring-current' : 'opacity-40 hover:opacity-80'}`}
                        style={{ backgroundColor: item.color }}
                        onClick={() => setSelectedColor(item.color)}
                        title={item.label}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button className="text-xs opacity-40 hover:opacity-80 transition-opacity px-2 py-1" onClick={() => setIsWritingNote(false)}>
                      {readerCopy.cancel}
                    </button>
                    <button
                      className="text-xs font-medium px-3 py-1 rounded-lg transition-colors"
                      style={{ backgroundColor: `${currentTheme.text}15` }}
                      onClick={() => handleAddHighlight(selectedColor, noteText)}
                    >
                      {readerCopy.save}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 mb-1">
                  {[
                    { color: '#fcd34d', label: readerCopy.yellow },
                    { color: '#86efac', label: readerCopy.green },
                    { color: '#fca5a5', label: readerCopy.red },
                  ].map((item) => (
                    <button
                      key={item.color}
                      className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all hover:scale-[1.02]"
                      style={{ backgroundColor: `${item.color}33` }}
                      onClick={() => handleAddHighlight(item.color)}
                    >
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    className="flex-1 py-2 rounded-xl text-xs font-medium transition-colors hover:opacity-80"
                    style={{ backgroundColor: `${currentTheme.text}12` }}
                    onClick={() => setIsWritingNote(true)}
                  >
                    {readerCopy.addNote}
                  </button>
                  <button className="px-3 py-2 rounded-xl text-xs opacity-40 hover:opacity-80 transition-opacity" onClick={() => setSelection(null)}>
                    {readerCopy.cancel}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
