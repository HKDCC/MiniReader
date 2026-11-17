import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { BookOpen, Plus, UploadCloud, Trash2, Library, Search, GripVertical, Download, Upload, Sun, Moon, ArrowRight, ChevronDown, Grid2X2, List, MoreHorizontal, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, BookMeta } from '../db/db';
import { importFile, repairMissingBookCovers } from '../utils/parser';
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
type ShelfFilter = 'all' | 'reading' | 'unread' | 'finished';
type ShelfSort = 'recent' | 'title' | 'progress';
type ShelfView = 'grid' | 'list';

function shelfStatus(book: BookMeta): Exclude<ShelfFilter, 'all'> {
  if (book.progress >= 100) return 'finished';
  if (book.progress > 0) return 'reading';
  return 'unread';
}

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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShelfFilter>('all');
  const [sortMode, setSortMode] = useState<ShelfSort>('recent');
  const [viewMode, setViewMode] = useState<ShelfView>('grid');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const [highlightedBookId, setHighlightedBookId] = useState<string | null>(null);
  const [pendingFocusBookId, setPendingFocusBookId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (books.length > 0) {
      void repairMissingBookCovers(books);
    }
  }, [books]);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2500);
  };

  const focusBook = (bookId: string) => {
    setPendingFocusBookId(bookId);
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
      const focusId = importedIds[0] || duplicateBookIds[0];
      if (focusId) focusBook(focusId);
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

  const openLibrarySearch = () => {
    setIsMoreMenuOpen(false);
    setIsSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const closeLibrarySearch = () => {
    setIsSearchOpen(false);
    setSearchQuery('');
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
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const visibleBooks = displayBooks
    .filter((book) => statusFilter === 'all' || shelfStatus(book) === statusFilter)
    .filter((book) => !normalizedQuery || `${book.title} ${book.author}`.toLocaleLowerCase().includes(normalizedQuery))
    .sort((a, b) => {
      if (sortMode === 'title') return a.title.localeCompare(b.title, 'zh-CN');
      if (sortMode === 'progress') return b.progress - a.progress || (b.lastReadAt || 0) - (a.lastReadAt || 0);
      return displayBooks.indexOf(a) - displayBooks.indexOf(b);
    });
  const continueBook = recentBooks[0] || books[0] || null;
  const canReorder = viewMode === 'grid' && statusFilter === 'all' && !normalizedQuery && sortMode === 'recent';

  // Import completion can precede Dexie's live query and the card's DOM commit.
  useEffect(() => {
    if (isImporting || !pendingFocusBookId || !bookRefs.current.has(pendingFocusBookId)) return;
    const frame = window.requestAnimationFrame(() => {
      bookRefs.current.get(pendingFocusBookId)?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'center', inline: 'center' });
      setHighlightedBookId(pendingFocusBookId);
      setPendingFocusBookId(null);
      if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = window.setTimeout(() => setHighlightedBookId(null), 3000);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [books, isImporting, pendingFocusBookId, reduceMotion]);

  useEffect(() => () => {
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
  }, []);

  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null);
      setIsMoreMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setIsMoreMenuOpen(false);
        setIsNotesPanelOpen(true);
      } else if (event.key === '/' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        openLibrarySearch();
      } else if (event.key === 'Escape') {
        setIsMoreMenuOpen(false);
        if (isSearchOpen) closeLibrarySearch();
      }
    };

    document.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSearchOpen]);

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
      className="shelf-shell w-full h-full overflow-y-auto scrollbar-none relative"
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

      <header className="shelf-topbar" data-docked={isToolbarDocked}>
        <div className="shelf-topbar-inner">
          <div className="shelf-brand" aria-label={shelfCopy.title}>
            <svg className="shelf-brand-mark" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <path d="M5 5.5h9.2c2 0 3.3 1.2 3.3 3.1v14c0-1.9-1.3-3.1-3.3-3.1H5v-14Z" />
              <path d="M23 5.5h-5.5v17.1c0-1.9 1.3-3.1 3.3-3.1H23v-14Z" />
            </svg>
            <span className="shelf-brand-name">{shelfCopy.title}</span>
            <span className="shelf-brand-edition">Library</span>
          </div>
          <nav aria-label="书架工具" className="shelf-header-actions">
            <div className={`shelf-search-wrap ${isSearchOpen ? 'open' : ''}`} aria-hidden={!isSearchOpen}>
              <div className="shelf-search-field">
                <Search size={16} strokeWidth={1.7} />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Escape') closeLibrarySearch(); }}
                  placeholder="搜索书名或作者"
                  aria-label="搜索书名或作者"
                  tabIndex={isSearchOpen ? 0 : -1}
                />
                <button type="button" onClick={closeLibrarySearch} aria-label="关闭搜索" tabIndex={isSearchOpen ? 0 : -1}>
                  <X size={15} />
                </button>
              </div>
            </div>
            {!isSearchOpen && (
              <ShelfAction label="搜索书籍（/）" onClick={openLibrarySearch}>
                <Search size={18} strokeWidth={1.7} />
              </ShelfAction>
            )}
            <button type="button" className="shelf-import-button" onClick={() => fileInputRef.current?.click()} aria-label={shelfCopy.importBooks}>
              <Plus size={18} strokeWidth={1.7} />
              <span>{shelfCopy.importBooks}</span>
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".txt,.epub,.pdf" className="hidden" multiple />
            <div className="shelf-more-wrap">
              <button
                type="button"
                className="shelf-control shelf-icon-button"
                aria-label="更多书架工具"
                aria-expanded={isMoreMenuOpen}
                onClick={(event) => { event.stopPropagation(); setIsMoreMenuOpen((open) => !open); }}
              >
                <MoreHorizontal size={19} />
              </button>
              <AnimatePresence>
                {isMoreMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="shelf-more-menu shelf-acrylic-surface"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button type="button" onClick={() => { setIsMoreMenuOpen(false); setIsNotesPanelOpen(true); }}>
                      <BookOpen size={15} />全局书摘与笔记
                    </button>
                    <button type="button" onClick={() => { setIsMoreMenuOpen(false); void handleExportBackup(); }}>
                      <Upload size={15} />{shelfCopy.exportBackup}
                    </button>
                    <button type="button" onClick={() => { setIsMoreMenuOpen(false); backupInputRef.current?.click(); }}>
                      <Download size={15} />{shelfCopy.importBackup}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <input type="file" ref={backupInputRef} onChange={handleBackupSelect} accept=".json,application/json" className="hidden" />
            <span className="shelf-header-divider" aria-hidden="true" />
            <ShelfAction label={shelfTheme === 'light' ? '切换到暗色书架' : '切换到亮色书架'} onClick={onToggleShelfTheme} isThemeSwitch checked={shelfTheme === 'dark'}>
              {shelfTheme === 'light' ? <Moon size={18} strokeWidth={1.6} /> : <Sun size={18} strokeWidth={1.6} />}
            </ShelfAction>
          </nav>
        </div>
      </header>

      <main className="shelf-main">
        {books.length === 0 ? (
          <div className="shelf-empty shelf-empty-library">
            <Library size={34} strokeWidth={1.2} />
            <h2>{shelfCopy.emptyTitle}</h2>
            <p>{shelfCopy.emptyDescription}</p>
          </div>
        ) : (
          <>
            {continueBook && !normalizedQuery && statusFilter === 'all' && (
              <section className="shelf-continue" aria-labelledby="shelf-continue-title">
                <div className="shelf-section-eyebrow">继续阅读</div>
                <div className="shelf-continue-body">
                  <button
                    type="button"
                    className="shelf-cover shelf-hero-cover"
                    onClick={() => onOpenBook(continueBook)}
                    aria-label={`继续阅读《${continueBook.title}》`}
                  >
                    {continueBook.cover ? (
                      <img src={continueBook.cover} alt="" draggable={false} />
                    ) : (
                      <span className="shelf-cover-placeholder"><BookOpen size={30} strokeWidth={1.2} /><span>{continueBook.format}</span></span>
                    )}
                  </button>
                  <div className="shelf-continue-copy">
                    <h1 id="shelf-continue-title">{continueBook.title}</h1>
                    <p className="shelf-continue-author">{continueBook.author}</p>
                    <p className="shelf-continue-location">
                      {continueBook.format.toUpperCase()}<span>·</span>{continueBook.progress > 0 ? `上次读到 ${Math.round(continueBook.progress)}%` : '尚未开始阅读'}
                    </p>
                    <div className="shelf-hero-progress" aria-label={`阅读进度 ${Math.round(continueBook.progress)}%`}>
                      <div className="shelf-progress-track"><span style={{ width: `${Math.min(100, Math.max(0, continueBook.progress))}%` }} /></div>
                      <span>{Math.round(continueBook.progress)} / 100</span>
                    </div>
                    <button type="button" className="shelf-primary-button" onClick={() => onOpenBook(continueBook)}>
                      {continueBook.progress > 0 ? '继续阅读' : '开始阅读'}<ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="shelf-reading-stat" aria-hidden="true">
                    <strong>{Math.round(continueBook.progress)}<small>%</small></strong>
                    <span>保持自己的节奏</span>
                  </div>
                </div>
              </section>
            )}

            <section className="shelf-library" aria-labelledby="shelf-library-title">
              <div className="shelf-library-heading">
                <div className="shelf-library-title">
                  <h2 id="shelf-library-title">书架</h2>
                  <span>{visibleBooks.length} 本书</span>
                </div>
                <div className="shelf-view-switch" aria-label="书架视图">
                  <button type="button" className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} aria-label="网格视图" aria-pressed={viewMode === 'grid'}><Grid2X2 size={15} /></button>
                  <button type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} aria-label="列表视图" aria-pressed={viewMode === 'list'}><List size={16} /></button>
                </div>
              </div>
              <div className="shelf-library-tools">
                <div className="shelf-filters" role="tablist" aria-label="按阅读状态筛选">
                  {([['all', '全部'], ['reading', '在读'], ['unread', '未读'], ['finished', '已读完']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      className={statusFilter === value ? 'active' : ''}
                      aria-selected={statusFilter === value}
                      onClick={() => setStatusFilter(value)}
                    >{label}</button>
                  ))}
                </div>
                <label className="shelf-sort-control">排序
                  <select value={sortMode} onChange={(event) => setSortMode(event.target.value as ShelfSort)} aria-label="书籍排序方式">
                    <option value="recent">最近阅读</option>
                    <option value="title">书名</option>
                    <option value="progress">阅读进度</option>
                  </select>
                  <ChevronDown size={12} />
                </label>
              </div>

              <div ref={gridRef} className={`shelf-books-grid ${viewMode === 'list' ? 'list-view' : ''}`}>
                {visibleBooks.map((book, index) => {
                  const isRecentBook = recentBookIds.has(book.id);
                  const status = shelfStatus(book);
                  return (
                    <motion.div
                      key={book.id}
                      layout="position"
                      data-book-id={book.id}
                      data-reordering={Boolean(canReorder && draggingId && draggingId !== book.id && !isRecentBook)}
                      style={{ '--shelf-wiggle-delay': `${(index % 3) * -70}ms` } as React.CSSProperties}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: draggingId === book.id ? 0.25 : 1, y: 0, scale: draggingId === book.id ? 0.98 : 1 }}
                      transition={{
                        layout: reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 },
                        opacity: { duration: 0.16 }, scale: { duration: 0.18 },
                        y: { delay: reduceMotion ? 0 : Math.min(index * 0.025, 0.25), duration: reduceMotion ? 0 : 0.18 },
                      }}
                      ref={(element) => {
                        if (element) bookRefs.current.set(book.id, element);
                        else bookRefs.current.delete(book.id);
                      }}
                      className={`shelf-book-item ${highlightedBookId === book.id ? 'shelf-highlighted ring-4' : ''}`}
                      draggable={false}
                      role="button"
                      tabIndex={0}
                      aria-label={`打开《${book.title}》`}
                      onPointerDown={(event) => { if (canReorder && !isRecentBook) beginDrag(event, book); }}
                      onClick={() => { if (!shouldSuppressClick()) onOpenBook(book); }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onOpenBook(book);
                        }
                      }}
                      onContextMenu={(event) => handleContextMenu(event, book.id)}
                    >
                      <div className="shelf-cover">
                        {book.cover ? (
                          <img src={book.cover} alt="" draggable={false} />
                        ) : (
                          <span className="shelf-cover-placeholder"><BookOpen size={28} strokeWidth={1.1} /><span>{book.format}</span></span>
                        )}
                        {canReorder && !isRecentBook && <span className="shelf-drag-indicator"><GripVertical size={13} /></span>}
                      </div>
                      <div className="shelf-book-info">
                        <h3>{book.title}</h3>
                        <p>{book.author}</p>
                      </div>
                      {status === 'reading' ? (
                        <div className="shelf-book-progress">
                          <div className="shelf-progress-track"><span style={{ width: `${Math.min(100, Math.max(0, book.progress))}%` }} /></div>
                          <span>{Math.round(book.progress)}%</span>
                        </div>
                      ) : (
                        <div className={`shelf-book-progress ${status}`}>{status === 'finished' ? '已读完' : '未读'}</div>
                      )}
                      <span className="shelf-list-state">{book.format.toUpperCase()} · {status === 'finished' ? '已读完' : status === 'reading' ? '在读' : '未读'}</span>
                      <ArrowRight className="shelf-list-arrow" size={15} />
                    </motion.div>
                  );
                })}
              </div>
              {visibleBooks.length === 0 && (
                <div className="shelf-empty">
                  <Search size={26} strokeWidth={1.2} />
                  <h3>这里暂时没有书</h3>
                  <p>换一个筛选条件，或试试其他关键词。</p>
                </div>
              )}
            </section>
          </>
        )}
      </main>

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

      <footer className="shelf-footer">
        {appCopy.appName} {appCopy.version} · 本地书库与笔记保存在此设备
      </footer>
    </motion.div>
  );
}
