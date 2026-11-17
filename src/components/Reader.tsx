import React, { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, Maximize, Minimize, ArrowLeft, Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Theme } from '../App';
import { BookMeta, db } from '../db/db';
import SettingsPanel from './SettingsPanel';
import NotesPanel from './NotesPanel';
import TocPanel from './TocPanel';
import VocabPanel from './VocabPanel';
import DictCard from './DictCard';
import { vocabService, BaseProficiencyLevel } from '../services/vocabService';
import type { EpubViewerRef } from './EpubViewer';
import TxtViewer from './TxtViewer';
const EpubViewer = lazy(() => import('./EpubViewer'));
const PdfViewer = lazy(() => import('./PdfViewer'));
import { readerCopy } from '../shared/copy';
import { isEditableTarget } from '../shared/dom';
import type { ReaderPageInfo, TextSelectionInfo } from './readerTypes';

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
  const sliderInteractionRef = useRef<'pointer' | 'keyboard' | null>(null);
  const keyboardSeekProgressRef = useRef<number | null>(null);
  const pendingKeyboardSeekCountRef = useRef(0);
  const lastKeyboardSeekAtRef = useRef(0);
  const pendingSliderSeekRef = useRef<{ fromLocation: string | null; timeout: number } | null>(null);

  const [uiVisible, setUiVisible] = useState(true);
  const [spineVisible, setSpineVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMessage, setSearchMessage] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toc, setToc] = useState<any[]>([]);
  const handleViewerReady = useCallback(() => setIsLoading(false), []);

  const [fontSize, setFontSize] = useState(() => {
    const value = localStorage.getItem('mr_fontSize');
    return value ? Number(value) : 20;
  });
  const [lineHeight, setLineHeight] = useState(() => {
    const value = localStorage.getItem('mr_lineHeight');
    return value ? Number(value) : 1.8;
  });
  const [chars, setChars] = useState(() => {
    const value = localStorage.getItem('mr_chars');
    return value ? Number(value) : 33;
  });
  const [fontFamily, setFontFamily] = useState(() => {
    const saved = localStorage.getItem('mr_fontFamily');
    return saved === 'SimSun' ? 'Source Han Serif SC' : saved || 'Source Han Serif SC';
  });
  const [isTwoPage, setIsTwoPage] = useState(() => localStorage.getItem('mr_isTwoPage') !== 'false');
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  const containerRef = useRef<HTMLDivElement>(null);

  const [intensiveMode, setIntensiveMode] = useState(() => localStorage.getItem('mr_intensiveMode') !== 'false');
  const [vocabOpen, setVocabOpen] = useState(false);
  const [activeDict, setActiveDict] = useState<{
    word: string;
    contextSentence?: string;
    position: { left: number; top?: number; bottom?: number; width?: number };
  } | null>(null);
  const [defaultLevels, setDefaultLevels] = useState<Record<string, number>>({});

  useEffect(() => {
    localStorage.setItem('mr_intensiveMode', String(intensiveMode));
  }, [intensiveMode]);

  const userVocabList = useLiveQuery(() => db.vocab.toArray()) || [];
  const vocabMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of userVocabList) {
      if (item.word) map.set(item.word.toLowerCase(), item.level);
      if (item.lemma) map.set(item.lemma.toLowerCase(), item.level);
    }
    return map;
  }, [userVocabList]);

  const handleWordClick = useCallback((word: string, rect: DOMRect, context?: string) => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const relTop = rect.top - containerRect.top;
    const relBottom = rect.bottom - containerRect.top;
    const relX = rect.left + rect.width / 2 - containerRect.left;

    const CARD_WIDTH = 320;
    // 词卡现在多了释义模式行与逐词拆解块，按 300 估算落位，实际高度另有 maxHeight 兜底
    const CARD_HEIGHT = 300;
    const GAP = 10;
    const SCREEN_PADDING = 12;

    const spaceAbove = relTop;
    const spaceBelow = containerRect.height - relBottom;
    const placeBelow = spaceAbove < CARD_HEIGHT + GAP + SCREEN_PADDING && spaceBelow > spaceAbove;

    const left = Math.max(SCREEN_PADDING, Math.min(relX - CARD_WIDTH / 2, containerRect.width - CARD_WIDTH - SCREEN_PADDING));

    const pos: { left: number; top?: number; bottom?: number; width?: number } = {
      left,
      width: CARD_WIDTH,
    };

    if (placeBelow) {
      pos.top = Math.max(SCREEN_PADDING, Math.min(relBottom + GAP, containerRect.height - CARD_HEIGHT - SCREEN_PADDING));
    } else {
      pos.bottom = Math.max(SCREEN_PADDING, Math.min(containerRect.height - relTop + GAP, containerRect.height - CARD_HEIGHT - SCREEN_PADDING));
    }

    setSelection(null);
    setActiveDict({
      word,
      contextSentence: context,
      position: pos,
    });
  }, []);

  const notes = useLiveQuery(() => db.notes.where('bookId').equals(book.id).reverse().toArray()) || [];
  const [selection, setSelection] = useState<TextSelectionInfo | null>(null);
  const [isWritingNote, setIsWritingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [selectedColor, setSelectedColor] = useState('#3b82f6');

  useEffect(() => localStorage.setItem('mr_fontSize', String(fontSize)), [fontSize]);
  useEffect(() => localStorage.setItem('mr_lineHeight', String(lineHeight)), [lineHeight]);
  useEffect(() => localStorage.setItem('mr_chars', String(chars)), [chars]);
  useEffect(() => localStorage.setItem('mr_fontFamily', fontFamily), [fontFamily]);
  useEffect(() => localStorage.setItem('mr_isTwoPage', String(isTwoPage)), [isTwoPage]);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      setWindowHeight(window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!selection) {
      setIsWritingNote(false);
      setNoteText('');
      setSelectedColor('#3b82f6');
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
    setVocabOpen(false);
    setActiveDict(null);
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
        if (searchOpen) {
          setSearchOpen(false);
          setSearchMessage('');
        } else if (settingsOpen || notesOpen || tocOpen || vocabOpen || activeDict) {
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
        setVocabOpen(false);
        setActiveDict(null);
        setUiVisible(true);
        return;
      }

      if (key === 'n' || key === 'N') {
        setNotesOpen((previous) => !previous);
        setSettingsOpen(false);
        setTocOpen(false);
        setVocabOpen(false);
        setActiveDict(null);
        setUiVisible(true);
        return;
      }

      if (key === 'v' || key === 'V') {
        setVocabOpen((previous) => !previous);
        setNotesOpen(false);
        setTocOpen(false);
        setSettingsOpen(false);
        setActiveDict(null);
        setUiVisible(true);
        return;
      }

      if (key === 'f' || key === 'F') {
        toggleFullscreen();
      }
    },
    [closeAllPanels, isFullscreen, nextPage, notesOpen, onClose, prevPage, searchOpen, selection, settingsOpen, tocOpen, toggleFullscreen, vocabOpen, activeDict]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        setSettingsOpen(false);
        setNotesOpen(false);
        setTocOpen(false);
        setVocabOpen(false);
        setActiveDict(null);
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
  const spineTimeoutRef = useRef<number | null>(null);
  const anyPanelOpen = settingsOpen || notesOpen || tocOpen || vocabOpen || searchOpen || !!activeDict;

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const nearBottom = event.clientY > window.innerHeight - 52;

      if (nearBottom && !anyPanelOpen) {
        setSpineVisible(true);
        if (spineTimeoutRef.current) {
          window.clearTimeout(spineTimeoutRef.current);
          spineTimeoutRef.current = null;
        }
      } else if (!anyPanelOpen) {
        if (spineTimeoutRef.current) window.clearTimeout(spineTimeoutRef.current);
        spineTimeoutRef.current = window.setTimeout(() => {
          if (sliderInteractionRef.current === null && !sliderFocusedRef.current) {
            setSpineVisible(false);
          }
        }, 650);
      } else {
        if (spineTimeoutRef.current) window.clearTimeout(spineTimeoutRef.current);
        setSpineVisible(false);
      }

      if (event.clientY < 68 || anyPanelOpen) {
        setUiVisible(true);
        if (uiTimeoutRef.current) {
          window.clearTimeout(uiTimeoutRef.current);
          uiTimeoutRef.current = null;
        }
        return;
      }

      if (!anyPanelOpen) {
        if (uiTimeoutRef.current) window.clearTimeout(uiTimeoutRef.current);
        uiTimeoutRef.current = window.setTimeout(() => setUiVisible(false), 1900);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (uiTimeoutRef.current) window.clearTimeout(uiTimeoutRef.current);
      if (spineTimeoutRef.current) window.clearTimeout(spineTimeoutRef.current);
    };
  }, [anyPanelOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!anyPanelOpen) setUiVisible(false);
    }, 2600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!uiVisible || anyPanelOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-reader-chrome]')) return;
      setUiVisible(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [anyPanelOpen, uiVisible]);

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

  const displayProgress = pageInfo && pageInfo.total > 1
    ? Math.round(((pageInfo.current - 1) / (pageInfo.total - 1)) * 100)
    : progress;

  const pageMargin = Math.max(56, Math.min(112, windowWidth * 0.075));
  const availableWidth = Math.max(320, windowWidth - pageMargin * 2);
  const singleWidth = Math.min(chars * fontSize, availableWidth);
  const spreadWidth = Math.min(chars * fontSize * 2 + 56, availableWidth);
  const effectiveTwoPage = isTwoPage && (spreadWidth - 56) / 2 >= 520;
  const viewerMaxWidth = effectiveTwoPage ? spreadWidth : singleWidth;
  const edgeZoneWidth = Math.max(20, (windowWidth - viewerMaxWidth) / 2 - 6);

  const CARD_WIDTH = 312;
  const GAP = 10;
  const SCREEN_PADDING = 12;

  const selectionPosition = useMemo(() => {
    if (!selection) return null;

    const containerRect = containerRef.current?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: windowWidth,
      height: windowHeight,
    };

    const rawTop = selection.top ?? selection.y;
    const rawBottom = selection.bottom ?? (rawTop + 32);

    const relTop = rawTop - containerRect.top;
    const relBottom = rawBottom - containerRect.top;
    const relX = selection.x - containerRect.left;

    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    // 紧凑工具条不需要 312px 那么宽，按内容自适应；只有写笔记时才固定宽度
    const estWidth = isWritingNote ? CARD_WIDTH : 214;
    const cardHeight = isWritingNote ? 180 : 46;
    const neededSpaceAbove = (isWritingNote ? 185 : 54) + GAP + SCREEN_PADDING;

    const spaceAbove = relTop;
    const spaceBelow = containerHeight - relBottom;

    // Prefer placing above if there is enough space;
    // only place below if above doesn't have enough space and below has more space
    const placeBelow = spaceAbove < neededSpaceAbove && spaceBelow > spaceAbove;

    const targetLeft = relX - estWidth / 2;
    const left = Math.max(SCREEN_PADDING, Math.min(targetLeft, containerWidth - estWidth - SCREEN_PADDING));

    const style: React.CSSProperties = {
      left,
      maxWidth: CARD_WIDTH,
      ...(isWritingNote ? { width: CARD_WIDTH } : {}),
      backgroundColor: `${currentTheme.ui}F5`,
      border: `1px solid ${currentTheme.text}18`,
      color: currentTheme.text,
      transformOrigin: placeBelow ? 'center top' : 'center bottom',
    };

    if (placeBelow) {
      const top = Math.min(relBottom + GAP, containerHeight - cardHeight - SCREEN_PADDING);
      style.top = Math.max(SCREEN_PADDING, top);
    } else {
      const bottom = Math.min(containerHeight - relTop + GAP, containerHeight - cardHeight - SCREEN_PADDING);
      style.bottom = Math.max(SCREEN_PADDING, bottom);
    }

    return { style, placeBelow };
  }, [selection, windowWidth, windowHeight, isWritingNote, currentTheme]);

  return (
    <div ref={containerRef} className="reader-paper w-full h-full min-h-0 relative flex justify-center items-center">
      {(settingsOpen || notesOpen || tocOpen || vocabOpen || activeDict) && <div className="absolute inset-0 z-30" onClick={closeAllPanels} />}

      <header
        data-reader-chrome
        className={`reader-paper absolute left-0 right-0 top-0 z-40 flex h-[54px] items-center justify-between gap-4 border-b px-3 transition-all duration-200 ${uiVisible || anyPanelOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0'}`}
        style={{ backgroundColor: currentTheme.bg, borderColor: `${currentTheme.text}16`, color: currentTheme.text }}
      >
        <div className="flex min-w-0 items-center gap-1">
          <button onClick={onClose} className="reader-icon-button" title={readerCopy.back} aria-label={readerCopy.back}>
            <ArrowLeft size={17} strokeWidth={1.7} />
          </button>
          <div className="min-w-0 pl-1">
            <div className="truncate text-[12.5px] leading-tight opacity-80">{book.title}</div>
            {book.author && <div className="truncate text-[10.5px] leading-tight opacity-40">{book.author}</div>}
          </div>
        </div>

        {searchOpen ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch(1);
            }}
            className="flex h-8 w-[min(360px,46vw)] items-center gap-1 rounded border px-2"
            style={{ borderColor: `${currentTheme.text}22`, backgroundColor: `${currentTheme.text}06` }}
          >
            <Search size={13} className="shrink-0 opacity-45" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchMessage('');
              }}
              placeholder="在本书中搜索"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
              style={{ color: currentTheme.text }}
              aria-label="搜索书内内容"
            />
            {searchMessage && <span className="shrink-0 text-[10px] opacity-50">{searchMessage}</span>}
            <button type="button" disabled={searchBusy} onClick={() => void runSearch(-1)} className="reader-icon-button !h-6 !w-6" title="上一个">
              <ChevronUp size={14} />
            </button>
            <button type="button" disabled={searchBusy} onClick={() => void runSearch(1)} className="reader-icon-button !h-6 !w-6" title="下一个">
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setSearchMessage('');
              }}
              className="reader-icon-button !h-6 !w-6"
              title="关闭搜索"
            >
              <X size={14} />
            </button>
          </form>
        ) : (
          <nav className="flex shrink-0 items-center gap-0.5">
            <button
              className="reader-tb-btn"
              aria-current={tocOpen ? 'page' : undefined}
              onClick={() => {
                setTocOpen((previous) => !previous);
                setNotesOpen(false);
                setVocabOpen(false);
                setSettingsOpen(false);
                setActiveDict(null);
                setSearchOpen(false);
              }}
            >
              目录
            </button>
            <button
              className="reader-tb-btn"
              aria-current={notesOpen || vocabOpen ? 'page' : undefined}
              onClick={() => {
                setNotesOpen((previous) => !previous);
                setVocabOpen(false);
                setTocOpen(false);
                setSettingsOpen(false);
                setActiveDict(null);
                setSearchOpen(false);
              }}
            >
              笔记
            </button>
            <span className="mx-2 h-4 w-px" style={{ backgroundColor: `${currentTheme.text}1C` }} />
            <button
              className="reader-icon-button"
              onClick={() => {
                setSearchOpen(true);
                setSettingsOpen(false);
                setNotesOpen(false);
                setTocOpen(false);
                setVocabOpen(false);
                setActiveDict(null);
              }}
              title="搜索 (Ctrl+F)"
              aria-label="搜索"
            >
              <Search size={15} strokeWidth={1.6} />
            </button>
            <button className="reader-icon-button" onClick={toggleFullscreen} title={`${readerCopy.fullscreen} (F)`} aria-label={readerCopy.fullscreen}>
              {isFullscreen ? <Minimize size={15} strokeWidth={1.6} /> : <Maximize size={15} strokeWidth={1.6} />}
            </button>
            <button
              className="reader-icon-button"
              aria-current={settingsOpen ? 'page' : undefined}
              onClick={() => {
                setSettingsOpen((previous) => !previous);
                setNotesOpen(false);
                setVocabOpen(false);
                setTocOpen(false);
                setActiveDict(null);
                setSearchOpen(false);
              }}
              title={`${readerCopy.settings} (M)`}
              aria-label={readerCopy.settings}
            >
              <Settings size={15} strokeWidth={1.6} />
            </button>
          </nav>
        )}
      </header>

      <div ref={viewerSurfaceRef} className="w-full h-full min-h-0 flex items-center justify-center overflow-hidden pb-[76px] pt-[74px]" style={{ maxWidth: viewerMaxWidth }}>
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
              isTwoPage={effectiveTwoPage}
              initialCfi={book.cfi}
              notes={notes}
              intensiveMode={intensiveMode}
              vocabMap={vocabMap}
              defaultLevels={defaultLevels}
              onWordClick={handleWordClick}
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
              isTwoPage={effectiveTwoPage}
              initialCfi={book.cfi}
              notes={notes}
              intensiveMode={intensiveMode}
              vocabMap={vocabMap}
              defaultLevels={defaultLevels}
              onWordClick={handleWordClick}
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
              isTwoPage={effectiveTwoPage}
              initialCfi={book.cfi}
              notes={notes}
              intensiveMode={intensiveMode}
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
        <div
          className={`absolute bottom-0 left-0 right-0 z-40 h-[26px] transition-all duration-200 ${spineVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1.5 opacity-0'}`}
          data-reader-chrome
        >
              <input
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={sliderPreview ?? displayProgress}
                aria-label="阅读进度"
                aria-valuetext={`${pageInfo ? `第 ${pageInfo.current} / ${pageInfo.total} 页` : '页码计算中'}，${sliderPreview ?? displayProgress}%`}
                onFocus={() => {
                  sliderFocusedRef.current = true;
                  setSpineVisible(true);
                }}
                onBlur={() => {
                  sliderFocusedRef.current = false;
                  if (sliderInteractionRef.current === 'keyboard') {
                    if (keyboardSeekProgressRef.current !== null) {
                      finishSliderSeek(keyboardSeekProgressRef.current, true);
                    } else {
                      sliderInteractionRef.current = null;
                    }
                  }
                  if (spineTimeoutRef.current) window.clearTimeout(spineTimeoutRef.current);
                  spineTimeoutRef.current = window.setTimeout(() => {
                    if (sliderInteractionRef.current === null && !sliderFocusedRef.current) {
                      setSpineVisible(false);
                    }
                  }, 650);
                }}
                onChange={(event) => setSliderPreview(Number(event.currentTarget.value))}
                onPointerDown={(event) => {
                  if (pendingSliderSeekRef.current) window.clearTimeout(pendingSliderSeekRef.current.timeout);
                  pendingSliderSeekRef.current = null;
                  keyboardSeekProgressRef.current = null;
                  pendingKeyboardSeekCountRef.current = 0;
                  sliderInteractionRef.current = 'pointer';
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
                className="reader-spine-input"
                style={{
                  color: currentTheme.text,
                  '--progress': `${sliderPreview ?? displayProgress}%`,
                  '--progress-color': currentTheme.text,
                  '--progress-bg': currentTheme.bg,
                  '--track-color': `${currentTheme.text}1A`,
                  touchAction: 'none',
                } as React.CSSProperties}
              />
        </div>
      )}

      <div
        className="pointer-events-none absolute bottom-[34px] left-1/2 z-30 flex -translate-x-1/2 items-baseline justify-between gap-6 text-[10.5px]"
        style={{ width: Math.min(viewerMaxWidth, windowWidth - 64), color: currentTheme.text, opacity: 0.42 }}
      >
        <span className="truncate">{book.title}</span>
        <span className="shrink-0 tabular-nums">{pageInfo ? `${pageInfo.current} / ${pageInfo.total}` : `${progress}%`}</span>
      </div>

      <div className="absolute bottom-0 left-0 top-0 z-10" style={{ width: edgeZoneWidth }} onClick={prevPage} aria-hidden="true" />
      <div className="absolute bottom-0 right-0 top-0 z-10" style={{ width: edgeZoneWidth }} onClick={nextPage} aria-hidden="true" />

      <AnimatePresence>
        {settingsOpen && (
          <SettingsPanel
            theme={theme}
            setTheme={setTheme}
            fontSize={fontSize}
            setFontSize={setFontSize}
            lineHeight={lineHeight}
            setLineHeight={setLineHeight}
            chars={chars}
            setChars={setChars}
            fontFamily={fontFamily}
            setFontFamily={setFontFamily}
            isTwoPage={isTwoPage}
            setIsTwoPage={setIsTwoPage}
            intensiveMode={intensiveMode}
            setIntensiveMode={setIntensiveMode}
            uiColor={currentTheme.ui}
            textColor={currentTheme.text}
            onClose={() => setSettingsOpen(false)}
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
            onSwitchTab={(tab) => {
              if (tab === 'vocab') {
                setNotesOpen(false);
                setVocabOpen(true);
              } else {
                setNotesOpen(true);
                setVocabOpen(false);
              }
            }}
            vocabCount={userVocabList.filter((item) => item.level >= 1 && item.level <= 3).length}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selection && selectionPosition && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            className="absolute z-50 flex flex-col gap-2 p-2.5 rounded-2xl shadow-xl backdrop-blur-xl"
            style={selectionPosition.style}
          >
            {isWritingNote ? (
              <div className="flex flex-col gap-2">
                <textarea
                  autoFocus
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  placeholder={readerCopy.notePlaceholder}
                  className="w-full h-28 bg-transparent border border-current/15 rounded-xl p-3 text-sm focus:outline-none focus:border-current/40 resize-none"
                  style={{ color: currentTheme.text }}
                />
                <div className="flex justify-between items-center">
                  <div className="flex gap-1.5">
                    {[
                      { color: '#3b82f6', label: readerCopy.blue },
                      { color: '#10b981', label: readerCopy.green },
                      { color: '#ec4899', label: readerCopy.red },
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
              <div className="flex items-center gap-3 px-0.5">
                <div className="flex items-center gap-1.5">
                  {[
                    { color: '#3b82f6', label: readerCopy.blue },
                    { color: '#10b981', label: readerCopy.green },
                    { color: '#ec4899', label: readerCopy.red },
                  ].map((item) => (
                    <button
                      key={item.color}
                      className="w-[15px] h-[15px] rounded-full transition-all opacity-70 hover:opacity-100"
                      style={{ backgroundColor: item.color }}
                      onClick={() => handleAddHighlight(item.color)}
                      title={item.label}
                      aria-label={item.label}
                    />
                  ))}
                </div>

                <button
                  className="text-xs opacity-70 hover:opacity-100 transition-opacity"
                  title="在词典中查询此词或多词短语并记录掌握度"
                  onClick={() => {
                    const text = selection.text.trim();
                    if (text) {
                      handleWordClick(text, {
                        top: selection.top ?? selection.y,
                        bottom: selection.bottom ?? ((selection.top ?? selection.y) + 30),
                        left: selection.x - 40,
                        right: selection.x + 40,
                        width: 80,
                        height: 30,
                      } as DOMRect, selection.context);
                    }
                  }}
                >
                  查词
                </button>

                <button
                  className="text-xs opacity-70 hover:opacity-100 transition-opacity"
                  onClick={() => setIsWritingNote(true)}
                >
                  笔记
                </button>

                <button
                  className="text-xs opacity-40 hover:opacity-100 transition-opacity"
                  onClick={() => {
                    setSelection(null);
                    viewerRef.current?.clearSelection();
                  }}
                >
                  取消
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {vocabOpen && (
          <VocabPanel
            uiColor={currentTheme.ui}
            textColor={currentTheme.text}
            onClose={() => setVocabOpen(false)}
            onSwitchTab={(tab) => {
              if (tab === 'notes') {
                setVocabOpen(false);
                setNotesOpen(true);
              } else {
                setVocabOpen(true);
                setNotesOpen(false);
              }
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeDict && (
          <DictCard
            word={activeDict.word}
            contextSentence={activeDict.contextSentence}
            bookId={book.id}
            position={activeDict.position}
            currentTheme={currentTheme}
            onClose={() => setActiveDict(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
