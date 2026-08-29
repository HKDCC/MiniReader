import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, Maximize, Minimize, ArrowLeft, List, StickyNote } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Theme } from '../App';
import { BookMeta, db } from '../db/db';
import SettingsPanel from './SettingsPanel';
import NotesPanel from './NotesPanel';
import TocPanel from './TocPanel';
import EpubViewer, { EpubViewerRef } from './EpubViewer';
import TxtViewer from './TxtViewer';
import PdfViewer from './PdfViewer';
import { readerCopy } from '../shared/copy';
import { isEditableTarget } from '../shared/dom';

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
  const [progress, setProgress] = useState(book.progress || 0);
  const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);
  const [txtData, setTxtData] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const viewerRef = useRef<EpubViewerRef | any>(null);
  const leftControlsRef = useRef<HTMLDivElement | null>(null);
  const rightControlsRef = useRef<HTMLDivElement | null>(null);

  const [uiVisible, setUiVisible] = useState(false);
  const [leftRailVisible, setLeftRailVisible] = useState(false);
  const [progressVisible, setProgressVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toc, setToc] = useState<any[]>([]);
  const [showHint, setShowHint] = useState(true);

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
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('mr_fontFamily') || 'Noto Serif SC');
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
        setIsLoading(false);
      }
    };

    loadContent();
  }, [book.id, book.format]);

  const handleLocationChange = useCallback(
    async (percentage: number, cfi: string) => {
      const normalizedProgress = percentage > 1 ? percentage : percentage * 100;
      const nextProgress = Number.isNaN(normalizedProgress) ? 0 : Math.min(100, Math.max(0, Math.round(normalizedProgress)));
      setProgress(nextProgress);
      await db.books.update(book.id, {
        progress: nextProgress,
        cfi,
        lastReadAt: Date.now(),
      });
    },
    [book.id]
  );

  const nextPage = useCallback(() => {
    viewerRef.current?.next();
  }, []);

  const prevPage = useCallback(() => {
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

      if (isNearBottomEdge) {
        setProgressVisible(true);
        if (progressTimeoutRef.current) {
          window.clearTimeout(progressTimeoutRef.current);
          progressTimeoutRef.current = null;
        }
      } else {
        if (progressTimeoutRef.current) {
          window.clearTimeout(progressTimeoutRef.current);
        }
        progressTimeoutRef.current = window.setTimeout(() => setProgressVisible(false), 720);
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

      <div className="w-full h-full min-h-0 flex justify-center items-center px-8 py-4 overflow-hidden" style={{ maxWidth: viewerMaxWidth }}>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="opacity-50 font-serif animate-pulse">{readerCopy.loading}</div>
          </div>
        )}

        {book.format === 'epub' && epubData ? (
          <div className={`w-full h-full min-h-0 transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
            <EpubViewer
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
              onReady={() => setIsLoading(false)}
              onTocLoaded={setToc}
            />
          </div>
        ) : null}

        {book.format === 'txt' && txtData ? (
          <div className={`w-full h-full min-h-0 transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
            <TxtViewer
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
              onReady={() => setIsLoading(false)}
            />
          </div>
        ) : null}

        {book.format === 'pdf' && pdfData ? (
          <div className={`w-full h-full min-h-0 transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
            <PdfViewer
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
              onReady={() => setIsLoading(false)}
              onTocLoaded={setToc}
            />
          </div>
        ) : null}
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

      <AnimatePresence>
        {progressVisible && !isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            onMouseEnter={() => setProgressVisible(true)}
            className="absolute bottom-0 left-0 right-0 z-40 px-8 pb-3 pt-8 pointer-events-auto"
          >
            <div className="mx-auto w-full max-w-5xl">
              <div className="mb-1 flex justify-end">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-mono backdrop-blur-md"
                  style={{ backgroundColor: `${currentTheme.ui}D8`, color: currentTheme.text }}
                >
                  {progress}%
                </span>
              </div>
              <div
                className="h-3 rounded-full overflow-hidden shadow-2xl"
                style={{ backgroundColor: `${currentTheme.text}24`, boxShadow: `0 10px 30px ${currentTheme.text}1C` }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress}%`,
                    backgroundColor: currentTheme.text,
                    boxShadow: `0 0 18px ${currentTheme.text}66`,
                  }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
