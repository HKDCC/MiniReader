import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { X, Search, BookOpen, Pencil, Trash2, Check, Undo2, FileText } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookMeta, db } from '../db/db';
import { globalNotesCopy } from '../shared/copy';

type GlobalNotesPanelProps = {
  onClose: () => void;
  onOpenBook: (book: BookMeta) => void;
  textCol: string;
};

export default function GlobalNotesPanel({ onClose, onOpenBook, textCol }: GlobalNotesPanelProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftNote, setDraftNote] = useState('');

  const allNotes = useLiveQuery(() => db.notes.orderBy('createdAt').reverse().toArray()) || [];
  const allBooks = useLiveQuery(() => db.books.orderBy('sortOrder').toArray()) || [];

  const bookMap = useMemo(() => {
    const map = new Map<string, BookMeta>();
    allBooks.forEach((book) => map.set(book.id, book));
    return map;
  }, [allBooks]);

  const { filteredBooks, filteredNotes } = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return { filteredBooks: allBooks, filteredNotes: allNotes };

    const nextBooks = allBooks.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(term));
    const nextNotes = allNotes.filter((note) => {
      const bookTitle = bookMap.get(note.bookId)?.title || '';
      return `${bookTitle} ${note.text || ''} ${note.note || ''}`.toLowerCase().includes(term);
    });

    return { filteredBooks: nextBooks, filteredNotes: nextNotes };
  }, [allBooks, allNotes, bookMap, searchTerm]);

  const beginEdit = (id: number, currentNote: string) => {
    setEditingId(id);
    setDraftNote(currentNote);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftNote('');
  };

  const saveEdit = async () => {
    if (editingId == null) return;
    await db.notes.update(editingId, { note: draftNote.trim() });
    cancelEdit();
  };

  const removeNote = async (id: number) => {
    if (!window.confirm('确定删除这条笔记吗？')) return;
    await db.notes.delete(id);
    if (editingId === id) cancelEdit();
  };

  const hasResults = filteredBooks.length > 0 || filteredNotes.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="shelf-acrylic-surface absolute inset-4 md:inset-12 z-50 rounded-2xl border flex flex-col overflow-hidden"
      style={{ color: textCol }}
    >
      <div className="shelf-panel-header p-6 border-b flex justify-between items-center shrink-0">
        <h2 className="text-xl font-serif tracking-wide flex items-center gap-3">
          <Search size={20} />
          {globalNotesCopy.title}
        </h2>
        <button onClick={onClose} className="p-2 opacity-50 hover:opacity-100 transition-opacity rounded-full hover:bg-black/5" title={globalNotesCopy.cancel}>
          <X size={20} />
        </button>
      </div>

      <div className="p-6 shrink-0">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
          <input
            autoFocus
            type="text"
            placeholder={globalNotesCopy.search}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="shelf-field w-full rounded-xl py-3 pl-12 pr-4 outline-none transition-colors"
            style={{ color: textCol }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 pt-0 space-y-6">
        {!hasResults ? (
          <div className="text-center opacity-50 py-12 font-serif">{searchTerm ? globalNotesCopy.noResult : globalNotesCopy.empty}</div>
        ) : (
          <>
            {filteredBooks.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h3 className="text-xs tracking-widest opacity-50">{globalNotesCopy.books}</h3>
                  <span className="text-xs opacity-40">{globalNotesCopy.bookCount(filteredBooks.length)}</span>
                </div>
                <div className="space-y-2">
                  {filteredBooks.map((book) => (
                    <button
                      key={book.id}
                      type="button"
                      onClick={() => onOpenBook(book)}
                      className="shelf-note-card w-full text-left rounded-xl border px-4 py-3 flex items-center gap-3 transition-colors"
                      title={globalNotesCopy.openBook}
                    >
                      <BookOpen size={18} className="shrink-0 opacity-60" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-serif truncate">{book.title}</span>
                        <span className="block text-xs opacity-50 truncate">{book.author} · {book.format.toUpperCase()}</span>
                      </span>
                      <span className="text-xs opacity-40">{book.progress}%</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {filteredNotes.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h3 className="text-xs tracking-widest opacity-50">{globalNotesCopy.notes}</h3>
                  <span className="text-xs opacity-40">{globalNotesCopy.noteCount(filteredNotes.length)}</span>
                </div>
                <div className="space-y-4">
                  {filteredNotes.map((note) => {
                    const book = bookMap.get(note.bookId);
                    const isEditing = editingId === note.id;

                    return (
                      <div key={note.id} className="shelf-note-card rounded-xl border p-4 space-y-3">
                        <div className="flex justify-between items-start gap-4">
                          <button
                            type="button"
                            onClick={() => book && onOpenBook(book)}
                            className="text-xs opacity-60 font-serif flex items-center gap-2 min-w-0 truncate hover:opacity-100 transition-opacity"
                            disabled={!book}
                            title={book ? globalNotesCopy.openBook : undefined}
                          >
                            <FileText size={13} className="shrink-0" />
                            <span className="truncate">{book?.title || globalNotesCopy.unknownBook}</span>
                          </button>
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="text-xs opacity-40">{new Date(note.createdAt).toLocaleString('zh-CN')}</div>
                            {typeof note.id === 'number' && (
                              <>
                                {isEditing ? (
                                  <>
                                    <button onClick={saveEdit} className="p-1.5 rounded-full bg-black/5 hover:bg-black/10 transition-colors" title={globalNotesCopy.save}>
                                      <Check size={14} />
                                    </button>
                                    <button onClick={cancelEdit} className="p-1.5 rounded-full bg-black/5 hover:bg-black/10 transition-colors" title={globalNotesCopy.cancel}>
                                      <Undo2 size={14} />
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => beginEdit(note.id!, note.note)}
                                    className="p-1.5 rounded-full bg-black/5 hover:bg-black/10 transition-colors"
                                    title={globalNotesCopy.edit}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                )}
                                <button
                                  onClick={() => removeNote(note.id!)}
                                  className="p-1.5 rounded-full bg-black/5 hover:bg-red-500/15 hover:text-red-500 transition-colors"
                                  title={globalNotesCopy.delete}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="pl-3 border-l-4" style={{ borderColor: note.color }}>
                          <p className="text-sm leading-relaxed opacity-90 whitespace-pre-wrap line-clamp-3">{note.text}</p>
                        </div>

                        {isEditing ? (
                          <textarea
                            autoFocus
                            value={draftNote}
                            onChange={(event) => setDraftNote(event.target.value)}
                            placeholder={globalNotesCopy.addNote}
                            className="shelf-field w-full min-h-24 rounded-xl p-3 text-sm resize-y outline-none transition-colors"
                            style={{ color: textCol }}
                          />
                        ) : note.note ? (
                          <div className="bg-black/5 rounded-xl p-3 text-sm whitespace-pre-wrap line-clamp-3">
                            <span className="opacity-50 mr-2">{globalNotesCopy.noteLabel}</span>
                            {note.note}
                          </div>
                        ) : (
                          <button
                            onClick={() => typeof note.id === 'number' && beginEdit(note.id, '')}
                            className="text-sm px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 transition-colors"
                          >
                            {globalNotesCopy.addNote}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
