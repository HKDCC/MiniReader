import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { BookOpen, Plus, UploadCloud, Trash2, Library, Search, GripVertical, Download, Upload, Sun, Moon } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, BookMeta } from '../db/db';
import { importFile } from '../utils/parser';
import { appCopy, shelfCopy } from '../shared/copy';
import { exportLibraryBackup, importLibraryBackup } from '../shared/backup';
import { isExternalFileDrag } from './shelf/dragDrop';
import GlobalNotesPanel from './GlobalNotesPanel';
import ShelfAction from './shelf/ShelfAction';
import { useShelfReorder } from './shelf/useShelfReorder';

async function persistBookOrder(books: BookMeta[], orderSlots: number[]) {
  await db.transaction('rw', db.books, async () => {
    await Promise.all(books.map((book, index) => db.books.update(book.id, { sortOrder: orderSlots[index] ?? index })));
  });
}

type ShelfTheme = 'light' | 'dark';

export default function Shelf({
  onOpenBook,
  shelfTheme,
  onToggleShelfTheme,
}: {
  onOpenBook: (book: BookMeta) => void;
  shelfTheme: ShelfTheme;
  onToggleShelfTheme: () => void;
}) {
  const books = useLiveQuery(() => db.books.orderBy('sortOrder').toArray()) || [];
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isNotesPanelOpen, setIsNotesPanelOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; bookId: string } | null>(null);
  const [isToolbarDocked, setIsToolbarDocked] = useState(false);
  const reduceMotion = useReducedMotion();
  const [highlightedBookId, setHighlightedBookId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const bookRefs = useRef(new Map<string, HTMLDivElement>());
  const highlightTimeoutRef = useRef<number | null>(null);
  const { recentBooks, manualBooks, recentBookIds } = useMemo(() => {
    const mostRecent = [...books]
      .sort((a, b) => (b.lastReadAt || b.addedAt || 0) - (a.lastReadAt || a.addedAt || 0) || b.addedAt - a.addedAt || a.sortOrder - b.sortOrder)
      .slice(0, 3);
    const recentIds = new Set(mostRecent.map((book) => book.id));
    const remaining = books.filter((book) => !recentIds.has(book.id));
    return {
      recentBooks: mostRecent,
      manualBooks: remaining,
      recentBookIds: recentIds,
    };
  }, [books]);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2500);
  };

  const focusBook = (bookId: string) => {
    setHighlightedBookId(bookId);
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);

    window.requestAnimationFrame(() => {
      bookRefs.current.get(bookId)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    });

    highlightTimeoutRef.current = window.setTimeout(() => setHighlightedBookId(null), 3000);
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!isExternalFileDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDraggingFiles(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (!isExternalFileDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDraggingFiles(false);
  };

  const handleDrop = async (event: React.DragEvent) => {
    if (!isExternalFileDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    setIsDraggingFiles(false);

    if (event.dataTransfer.files?.length) {
      await processFiles(Array.from(event.dataTransfer.files));
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      await processFiles(Array.from(event.target.files));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processFiles = async (files: File[]) => {
    setIsImporting(true);
    const importedIds: string[] = [];
    const duplicateBookIds: string[] = [];
    let duplicateCount = 0;
    try {
      for (const file of files) {
        const result = await importFile(file);
        if (result.status === 'duplicate') {
          duplicateCount += 1;
          duplicateBookIds.push(result.existingBook.id);
        } else {
          importedIds.push(result.id);
        }
      }

      if (duplicateCount > 0) {
        const summary = importedIds.length > 0 ? shelfCopy.importSummary(importedIds.length, duplicateCount) : shelfCopy.importAllDuplicates;
        showToast(
          duplicateBookIds.length > 0 ? `${summary}，${shelfCopy.duplicateLocated}` : summary,
          importedIds.length > 0 ? 'success' : 'error'
        );
        if (duplicateBookIds[0]) focusBook(duplicateBookIds[0]);
      } else {
        showToast(shelfCopy.importSuccess, 'success');
      }
      return importedIds;
    } catch (error) {
      console.error('Import failed:', error);
      showToast(error instanceof Error ? error.message : shelfCopy.importFailure, 'error');
      return importedIds;
    } finally {
      setIsImporting(false);
    }
  };

  const processOpenedFilePaths = async (filePaths: string[]) => {
    const electronApi = (window as any).electron;
    if (!electronApi?.invoke || filePaths.length === 0) return;

    setIsImporting(true);
    try {
      const filePayloads = await electronApi.invoke('files:read', filePaths);
      const files = filePayloads.map((item: { name: string; data: Uint8Array | ArrayBuffer | { data: number[] } }) => {
        const bytes = item.data instanceof Uint8Array ? item.data : new Uint8Array((item.data as any).data || item.data);
        return new File([bytes], item.name);
      });
      const importedIds = await processFiles(files);
      const firstImportedBook = importedIds[0] ? await db.books.get(importedIds[0]) : null;
      if (firstImportedBook) {
        onOpenBook(firstImportedBook);
      }
    } catch (error) {
      console.error('Open file failed:', error);
      showToast(error instanceof Error ? error.message : shelfCopy.importFailure, 'error');
      setIsImporting(false);
    }
  };

  const consumeOpenedFilePaths = async () => {
    const electronApi = (window as any).electron;
    if (!electronApi?.invoke) return;

    const filePaths = await electronApi.invoke('files:consume-opened');
    if (Array.isArray(filePaths) && filePaths.length > 0) {
      await processOpenedFilePaths(filePaths);
    }
  };

  const handleExportBackup = async () => {
    try {
      await exportLibraryBackup();
      showToast(shelfCopy.backupExportSuccess, 'success');
    } catch (error) {
      console.error('Backup export failed:', error);
      showToast(error instanceof Error ? error.message : shelfCopy.importFailure, 'error');
    }
  };

  const handleBackupSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!window.confirm(shelfCopy.backupImportConfirm)) {
      if (backupInputRef.current) backupInputRef.current.value = '';
      return;
    }

    setIsImporting(true);
    try {
      await importLibraryBackup(file);
      showToast(shelfCopy.backupImportSuccess, 'success');
    } catch (error) {
      console.error('Backup import failed:', error);
      showToast(error instanceof Error ? error.message : shelfCopy.importFailure, 'error');
    } finally {
      setIsImporting(false);
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  };

  const handleDeleteBook = async (id: string) => {
    setContextMenu(null);
    const book = books.find((item) => item.id === id);
    if (!book || !window.confirm(`确定删除《${book.title || '未命名书籍'}》吗？书籍内容和笔记也会被删除。`)) return;

    try {
      await db.transaction('rw', db.books, db.contents, db.notes, async () => {
        await db.books.delete(id);
        await db.contents.delete(id);
        await db.notes.where('bookId').equals(id).delete();
      });
      showToast('书籍已删除', 'success');
    } catch (error) {
      console.error('Delete book failed:', error);
      showToast('删除失败，请重试', 'error');
    }
  };

  const handleContextMenu = (event: React.MouseEvent, bookId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, bookId });
  };

  const commitBookOrder = async (nextBooks: BookMeta[]) => {
    const orderSlots = manualBooks.map((book) => book.sortOrder).sort((a, b) => a - b);
    try {
      await persistBookOrder(nextBooks, orderSlots);
    } catch (error) {
      showToast('排序保存失败，请重试', 'error');
      throw error;
    }
  };
  const { draggingId, orderedBooks, beginDrag, shouldSuppressClick } = useShelfReorder(manualBooks, shelfRef, gridRef, bookRefs, commitBookOrder);
  const displayBooks = [...recentBooks, ...orderedBooks];

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setIsNotesPanelOpen(true);
      } else if (event.key === '/' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setIsNotesPanelOpen(true);
      }
    };

    document.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const electronApi = (window as any).electron;
    if (!electronApi?.on) return;

    const handleOpenedFiles = () => {
      void consumeOpenedFilePaths();
    };

    void consumeOpenedFilePaths();
    electronApi.on('files:opened', handleOpenedFiles);
    return () => electronApi.off?.('files:opened', handleOpenedFiles);
  }, []);

  return (
    <motion.div
      ref={shelfRef}
      layoutScroll
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full px-12 pb-12 max-w-6xl mx-auto overflow-y-auto scrollbar-none relative"
      data-shelf-theme={shelfTheme}
      onScroll={(event) => {
        const scrollTop = event.currentTarget.scrollTop;
        setIsToolbarDocked((docked) => scrollTop > (docked ? 16 : 40));
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <AnimatePresence>
        {isDraggingFiles && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="shelf-acrylic-surface absolute inset-0 z-50 flex flex-col items-center justify-center border-2 border-dashed rounded-2xl m-4 pointer-events-none"
          >
            <UploadCloud size={64} className="mb-4 opacity-50" />
            <h2 className="text-2xl font-serif">{shelfCopy.importOverlayTitle}</h2>
            <p className="opacity-50 mt-2">{shelfCopy.importOverlayDescription}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isImporting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="shelf-acrylic-surface absolute inset-0 z-50 flex flex-col items-center justify-center border rounded-2xl m-4"
          >
            <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin mb-4 opacity-50" />
            <h2 className="text-lg font-serif">{shelfCopy.importing}</h2>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="shelf-acrylic-surface shelf-toast absolute bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl border text-sm font-medium"
            data-status={toast.type}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <header className="shelf-acrylic-surface shelf-toolbar z-20 mt-12 mb-8 flex items-center justify-between gap-4 border px-5 py-3" data-docked={isToolbarDocked}>
        <h1 className="shelf-brand text-2xl font-medium tracking-tight">{shelfCopy.title}</h1>
        <nav aria-label="书架工具" className="flex items-center justify-end gap-2">
          <ShelfAction label={shelfTheme === 'light' ? '切换到暗色书架' : '切换到亮色书架'} onClick={onToggleShelfTheme} isThemeSwitch checked={shelfTheme === 'dark'}>
            <svg viewBox="0 0 52 28" width="52" height="28" fill="none" aria-hidden="true">
              <rect x="0.5" y="0.5" width="51" height="27" rx="13.5" className="shelf-switch-track" />
              <Sun x="6" y="6" width="16" height="16" strokeWidth={1.6} opacity=".4" />
              <Moon x="30" y="6" width="16" height="16" strokeWidth={1.6} opacity=".4" />
              <g className="shelf-switch-thumb" data-dark={shelfTheme === 'dark'}>
                <circle cx="14" cy="14" r="10.5" />
                {shelfTheme === 'light' ? <Sun x="7" y="7" width="14" height="14" strokeWidth={1.7} /> : <Moon x="7" y="7" width="14" height="14" strokeWidth={1.7} />}
              </g>
            </svg>
          </ShelfAction>
          <ShelfAction label={shelfCopy.exportBackup} onClick={handleExportBackup}>
            <Upload size={18} strokeWidth={1.7} />
          </ShelfAction>
          <input type="file" ref={backupInputRef} onChange={handleBackupSelect} accept=".json,application/json" className="hidden" />
          <ShelfAction label={shelfCopy.importBackup} onClick={() => backupInputRef.current?.click()}>
            <Download size={18} strokeWidth={1.7} />
          </ShelfAction>
          <ShelfAction label={shelfCopy.search} onClick={() => setIsNotesPanelOpen(true)}>
            <Search size={18} strokeWidth={1.7} />
          </ShelfAction>
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".txt,.epub,.pdf" className="hidden" multiple />
          <ShelfAction label={shelfCopy.importBooks} onClick={() => fileInputRef.current?.click()}>
            <Plus size={20} strokeWidth={1.7} />
          </ShelfAction>
        </nav>
      </header>

      {books.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 opacity-30">
          <Library size={48} className="mb-4" strokeWidth={1} />
          <p className="font-serif text-lg">{shelfCopy.emptyTitle}</p>
          <p className="text-sm mt-2">{shelfCopy.emptyDescription}</p>
        </div>
      ) : (
        <div ref={gridRef} className="relative grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-8 gap-y-12">
          {displayBooks.map((book, index) => {
            const isRecentBook = recentBookIds.has(book.id);
            return (
            <motion.div
              key={book.id}
              layout="position"
              data-book-id={book.id}
              data-reordering={Boolean(draggingId && draggingId !== book.id && !isRecentBook)}
              style={{ '--shelf-wiggle-delay': `${(index % 3) * -70}ms` } as React.CSSProperties}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: draggingId === book.id ? 0.25 : 1, y: 0, scale: draggingId === book.id ? 0.97 : 1 }}
              transition={{
                layout: reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 },
                opacity: { duration: 0.16 }, scale: { duration: 0.18 },
                y: { delay: reduceMotion ? 0 : Math.min(index * 0.025, 0.25), duration: reduceMotion ? 0 : 0.18 },
              }}
              ref={(element) => {
                if (element) bookRefs.current.set(book.id, element);
                else bookRefs.current.delete(book.id);
              }}
              className={`shelf-paper-card group cursor-pointer select-none flex flex-col relative rounded-xl border p-3 ${highlightedBookId === book.id ? 'ring-4 ring-black/30 ring-offset-4 ring-offset-transparent' : ''}`}
              draggable={false}
              onPointerDown={(event) => { if (!isRecentBook) beginDrag(event, book); }}
              onClick={() => { if (!shouldSuppressClick()) onOpenBook(book); }}
            >
              <div
                className="shelf-cover aspect-[3/4] rounded-lg mb-3 relative overflow-hidden flex items-center justify-center border"
                onContextMenu={(event) => handleContextMenu(event, book.id)}
              >
                {book.cover ? (
                  <img src={book.cover} alt={book.title} draggable={false} className="w-full h-full object-cover select-none pointer-events-none" />
                ) : (
                  <div className="flex flex-col items-center justify-center p-4 text-center opacity-40">
                    <BookOpen size={32} strokeWidth={1} className="mb-3" />
                    <span className="text-xs font-serif uppercase tracking-widest">{book.format}</span>
                  </div>
                )}
                {!isRecentBook && <div className="absolute top-2 right-2 p-1.5 rounded-full bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity z-10"><GripVertical size={14} /></div>}
                {isRecentBook && (
                  <span className="shelf-recent-badge absolute top-2 right-2 rounded-full px-2 py-0.5 text-[9px] font-medium tracking-wider shadow-sm z-10">
                    最近阅读
                  </span>
                )}
                <div className="shelf-cover-progress absolute bottom-1.5 left-2 right-2 h-1 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: `${book.progress}%` }} />
                </div>
              </div>
              <h3 className="font-serif text-base leading-snug mb-1 group-hover:opacity-70 transition-opacity line-clamp-2">{book.title}</h3>
              <div className="flex justify-between items-center mt-auto pt-1">
                <p className="text-xs opacity-50 truncate pr-2">{book.author}</p>
                <p className="text-[10px] opacity-40 font-mono">{book.progress}%</p>
              </div>
            </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {isNotesPanelOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="shelf-modal-scrim absolute inset-0 z-40"
              onClick={() => setIsNotesPanelOpen(false)}
            />
            <GlobalNotesPanel
              onClose={() => setIsNotesPanelOpen(false)}
              onOpenBook={(book) => {
                setIsNotesPanelOpen(false);
                onOpenBook(book);
              }}
              textCol="inherit"
            />
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {contextMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="shelf-acrylic-surface fixed z-50 py-1.5 rounded-xl border text-xs min-w-[150px] shadow-xl overflow-hidden"
              style={{
                left: contextMenu.x,
                top: contextMenu.y,
                color: 'currentColor',
              }}
            >
              <button
                onClick={() => {
                  setContextMenu(null);
                  setIsNotesPanelOpen(true);
                }}
                className="w-full text-left px-3.5 py-2 flex items-center gap-2 hover:bg-black/5 transition-colors"
              >
                <BookOpen size={14} className="opacity-60" />
                查看书摘与笔记
              </button>
              <div className="h-[1px] my-1 bg-black/10 mx-1" />
              <button
                onClick={() => handleDeleteBook(contextMenu.bookId)}
                className="w-full text-left px-3.5 py-2 flex items-center gap-2 hover:bg-red-50 hover:text-red-600 transition-colors text-red-500"
              >
                <Trash2 size={14} />
                {shelfCopy.deleteBook}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <footer className="mt-14 pb-2 text-center text-[11px] opacity-30">
        {appCopy.appName} {appCopy.version} · 本地书库与笔记保存在此设备
      </footer>
    </motion.div>
  );
}
