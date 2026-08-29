import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Plus, UploadCloud, Trash2, Library, Search, GripVertical, Download, Upload } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, BookMeta } from '../db/db';
import { importFile } from '../utils/parser';
import { appCopy, shelfCopy } from '../shared/copy';
import { exportLibraryBackup, importLibraryBackup } from '../shared/backup';
import { getBookDragId, isExternalFileDrag, isInternalBookDrag, setBookDragData } from './shelf/dragDrop';
import GlobalNotesPanel from './GlobalNotesPanel';

async function persistBookOrder(books: BookMeta[]) {
  await db.transaction('rw', db.books, async () => {
    await Promise.all(books.map((book, index) => db.books.update(book.id, { sortOrder: index })));
  });
}

export default function Shelf({ onOpenBook, uiColor }: { onOpenBook: (book: BookMeta) => void; uiColor: string }) {
  const books = useLiveQuery(() => db.books.orderBy('sortOrder').toArray()) || [];
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isNotesPanelOpen, setIsNotesPanelOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; bookId: string } | null>(null);
  const [draggingBookId, setDraggingBookId] = useState<string | null>(null);
  const [highlightedBookId, setHighlightedBookId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const bookRefs = useRef(new Map<string, HTMLDivElement>());
  const highlightTimeoutRef = useRef<number | null>(null);

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
    await db.books.delete(id);
    await db.contents.delete(id);
    const notes = await db.notes.where('bookId').equals(id).toArray();
    await Promise.all(notes.map((note) => (note.id ? db.notes.delete(note.id) : Promise.resolve())));
  };

  const handleContextMenu = (event: React.MouseEvent, bookId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, bookId });
  };

  const reorderBook = async (sourceBookId: string, targetBookId: string) => {
    if (sourceBookId === targetBookId) return;

    const nextBooks = [...books];
    const fromIndex = nextBooks.findIndex((book) => book.id === sourceBookId);
    const toIndex = nextBooks.findIndex((book) => book.id === targetBookId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = nextBooks.splice(fromIndex, 1);
    nextBooks.splice(toIndex, 0, moved);
    await persistBookOrder(nextBooks);
  };

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full p-12 max-w-6xl mx-auto overflow-y-auto scrollbar-none relative"
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
            className="absolute inset-0 z-50 flex flex-col items-center justify-center backdrop-blur-sm border-4 border-dashed rounded-3xl m-4 pointer-events-none"
            style={{ backgroundColor: `${uiColor}E6`, borderColor: 'currentColor' }}
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
            className="absolute inset-0 z-50 flex flex-col items-center justify-center backdrop-blur-sm rounded-3xl m-4"
            style={{ backgroundColor: `${uiColor}E6` }}
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
            className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full shadow-xl text-sm font-medium"
            style={{
              backgroundColor: toast.type === 'success' ? '#22c55e' : '#ef4444',
              color: '#fff',
            }}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-4xl font-serif tracking-tight mb-2">{shelfCopy.title}</h1>
          <p className="text-sm opacity-50">{shelfCopy.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            onClick={handleExportBackup}
            className="px-4 py-2 rounded-full bg-current/5 hover:bg-current/10 transition-colors flex items-center gap-2 text-sm"
            title={shelfCopy.exportBackup}
          >
            <Download size={16} strokeWidth={2} />
            <span className="font-medium">{shelfCopy.exportBackup}</span>
          </button>
          <input type="file" ref={backupInputRef} onChange={handleBackupSelect} accept=".json,application/json" className="hidden" />
          <button
            onClick={() => backupInputRef.current?.click()}
            className="px-4 py-2 rounded-full bg-current/5 hover:bg-current/10 transition-colors flex items-center gap-2 text-sm"
            title={shelfCopy.importBackup}
          >
            <Upload size={16} strokeWidth={2} />
            <span className="font-medium">{shelfCopy.importBackup}</span>
          </button>
          <button
            onClick={() => setIsNotesPanelOpen(true)}
            className="px-4 py-2 rounded-full bg-current/5 hover:bg-current/10 transition-colors flex items-center gap-2 text-sm"
          >
            <Search size={16} strokeWidth={2} />
            <span className="font-medium">{shelfCopy.search}</span>
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".txt,.epub,.pdf" className="hidden" multiple />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 rounded-full bg-current/5 hover:bg-current/10 transition-colors flex items-center gap-2 text-sm"
          >
            <Plus size={16} strokeWidth={2} />
            <span className="font-medium">{shelfCopy.importBooks}</span>
          </button>
        </div>
      </header>

      {books.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 opacity-30">
          <Library size={48} className="mb-4" strokeWidth={1} />
          <p className="font-serif text-lg">{shelfCopy.emptyTitle}</p>
          <p className="text-sm mt-2">{shelfCopy.emptyDescription}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-8 gap-y-12">
          {books.map((book, index) => (
            <motion.div
              key={book.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.05, 0.5) }}
              ref={(element) => {
                if (element) bookRefs.current.set(book.id, element);
                else bookRefs.current.delete(book.id);
              }}
              className={`group cursor-pointer flex flex-col relative rounded-xl transition-all duration-300 ${
                draggingBookId === book.id ? 'opacity-50' : ''
              } ${highlightedBookId === book.id ? 'ring-4 ring-black/30 ring-offset-4 ring-offset-transparent scale-[1.03]' : ''}`}
              draggable
              onDragStart={(event) => {
                const dragEvent = event as unknown as React.DragEvent<HTMLDivElement>;
                dragEvent.stopPropagation();
                setBookDragData(dragEvent.dataTransfer, book.id);
                setDraggingBookId(book.id);
                setIsDraggingFiles(false);
              }}
              onDragEnd={() => {
                setDraggingBookId(null);
                setIsDraggingFiles(false);
              }}
              onDragOver={(event) => {
                const dragEvent = event as unknown as React.DragEvent<HTMLDivElement>;
                if (!isInternalBookDrag(dragEvent.dataTransfer.types)) return;
                dragEvent.preventDefault();
                dragEvent.stopPropagation();
                dragEvent.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                const dragEvent = event as unknown as React.DragEvent<HTMLDivElement>;
                if (!isInternalBookDrag(dragEvent.dataTransfer.types)) return;
                dragEvent.preventDefault();
                dragEvent.stopPropagation();
                const sourceBookId = getBookDragId(dragEvent.dataTransfer) || draggingBookId;
                if (sourceBookId) {
                  void reorderBook(sourceBookId, book.id);
                }
                setDraggingBookId(null);
              }}
              onClick={() => onOpenBook(book)}
            >
              <div
                className="aspect-[3/4] rounded-md mb-4 relative overflow-hidden shadow-sm flex items-center justify-center border border-black/5 bg-white/50"
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
                <div className="absolute top-2 right-2 p-1.5 rounded-full bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GripVertical size={14} />
                </div>
                <div className="absolute bottom-0 left-0 h-1.5 bg-black/10 w-full">
                  <div className="h-full bg-black/60" style={{ width: `${book.progress}%` }} />
                </div>
              </div>
              <h3 className="font-serif text-base leading-snug mb-1 group-hover:opacity-70 transition-opacity line-clamp-2">{book.title}</h3>
              <div className="flex justify-between items-center mt-auto pt-1">
                <p className="text-xs opacity-50 truncate pr-2">{book.author}</p>
                <p className="text-[10px] opacity-40 font-mono">{book.progress}%</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {isNotesPanelOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 backdrop-blur-sm"
              style={{ backgroundColor: `${uiColor}E6` }}
              onClick={() => setIsNotesPanelOpen(false)}
            />
            <GlobalNotesPanel
              onClose={() => setIsNotesPanelOpen(false)}
              onOpenBook={(book) => {
                setIsNotesPanelOpen(false);
                onOpenBook(book);
              }}
              uiColor={uiColor}
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
              className="fixed z-50 py-2 rounded-xl shadow-2xl border backdrop-blur-xl text-sm"
              style={{
                left: contextMenu.x,
                top: contextMenu.y,
                backgroundColor: `${uiColor}EE`,
                borderColor: `${uiColor}40`,
                color: 'currentColor',
              }}
            >
              <button
                onClick={() => handleDeleteBook(contextMenu.bookId)}
                className="w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-black/10 transition-colors text-red-500"
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
