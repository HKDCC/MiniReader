import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Download, Trash2, FileText, FileDown, X } from 'lucide-react';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { Note } from '../db/db';
import { notesCopy } from '../shared/copy';
import { buildBrowserNotesHtml, buildNotesMarkdown } from '../shared/notesExport';

const isElectron = () => typeof window !== 'undefined' && !!(window as any).electron;

export default function NotesPanel({
  uiColor,
  textColor,
  notes,
  onDeleteNote,
  onClose,
}: {
  uiColor: string;
  textColor: string;
  notes: Note[];
  onDeleteNote: (id: number) => void;
  onClose: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);

  const filteredNotes = notes.filter(
    (note) =>
      note.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.note.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleExportMarkdown = () => {
    if (notes.length === 0) return;

    const markdown = buildNotesMarkdown(notes);
    const blob = new Blob([`# ${notesCopy.exportTitle}\n\n${markdown}`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `notes-${Date.now()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const handleExportDocx = async () => {
    if (notes.length === 0) return;

    const children: Paragraph[] = [
      new Paragraph({ children: [new TextRun({ text: notesCopy.exportTitle, bold: true, size: 32 })] }),
      new Paragraph({ text: '' }),
    ];

    notes.forEach((note) => {
      const date = new Date(note.createdAt).toLocaleString('zh-CN');
      children.push(new Paragraph({ children: [new TextRun({ text: note.text, italics: true })] }));
      if (note.note) {
        children.push(new Paragraph({ children: [new TextRun({ text: `${notesCopy.noteLabel}\uFF1A${note.note}`, bold: true })] }));
      }
      children.push(new Paragraph({ children: [new TextRun({ text: date, size: 16, color: '888888' })] }));
      children.push(new Paragraph({ text: '---' }));
      children.push(new Paragraph({ text: '' }));
    });

    const doc = new Document({ sections: [{ properties: {}, children }] });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `notes-${Date.now()}.docx`;
    anchor.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const handleExportPdf = async () => {
    if (notes.length === 0) return;
    setShowExportMenu(false);

    if (isElectron()) {
      const result = await (window as any).electron.invoke('notes:export-pdf', {
        title: notesCopy.exportTitle,
        notes: notes.map((note) => ({
          text: note.text,
          note: note.note,
          color: note.color,
          createdAt: note.createdAt,
        })),
      });

      if (result?.ok) {
        alert(`${notesCopy.exportSuccess}\uFF1A${result.filePath}`);
        return;
      }

      if (!result?.cancelled) {
        alert(`${notesCopy.exportFailed}\uFF1A${result?.error || notesCopy.unknownError}`);
      }
      return;
    }

    const html = buildBrowserNotesHtml(notes);

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="absolute top-24 left-8 w-[22rem] h-[calc(100vh-12rem)] p-6 rounded-2xl shadow-2xl backdrop-blur-xl z-50 flex flex-col border"
      style={{
        backgroundColor: `${uiColor}E6`,
        color: textColor,
        borderColor: `${textColor}15`,
      }}
    >
      <div className="flex justify-between items-center mb-6 relative">
        <h3 className="text-xs tracking-widest opacity-50 font-sans">{notesCopy.title}</h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowExportMenu((previous) => !previous)} className="opacity-50 hover:opacity-100 transition-opacity" title={notesCopy.export}>
              <Download size={16} strokeWidth={1.5} />
            </button>

            <AnimatePresence>
              {showExportMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -10 }}
                  className="absolute right-0 top-6 w-36 rounded-xl shadow-xl backdrop-blur-xl border overflow-hidden z-50"
                  style={{ backgroundColor: `${uiColor}EE`, borderColor: `${textColor}20` }}
                >
                  <button onClick={handleExportMarkdown} className="w-full text-left px-4 py-2 text-xs hover:bg-current/10 flex items-center gap-2">
                    <FileText size={12} /> Markdown
                  </button>
                  <button onClick={handleExportDocx} className="w-full text-left px-4 py-2 text-xs hover:bg-current/10 flex items-center gap-2">
                    <FileText size={12} /> DOCX
                  </button>
                  <button onClick={handleExportPdf} className="w-full text-left px-4 py-2 text-xs hover:bg-current/10 flex items-center gap-2">
                    <FileDown size={12} /> PDF
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button onClick={onClose} className="opacity-50 hover:opacity-100 transition-opacity" title={notesCopy.close}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="relative mb-6">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={notesCopy.search}
          className="w-full bg-current/5 border border-current/10 rounded-full py-2 pl-9 pr-4 text-xs focus:outline-none focus:border-current/30 transition-colors"
          style={{ color: textColor }}
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar">
        {filteredNotes.length === 0 ? (
          <div className="text-xs opacity-40 text-center mt-10">{notesCopy.empty}</div>
        ) : (
          filteredNotes.map((note) => (
            <div key={note.id} className="group relative">
              <div className="text-xs opacity-40 mb-1 font-mono">{new Date(note.createdAt).toLocaleDateString('zh-CN')}</div>
              <div className="text-sm border-l-2 pl-3 py-1 mb-2 opacity-80 font-serif whitespace-pre-wrap" style={{ borderColor: note.color }}>
                {note.text}
              </div>
              {note.note && <div className="text-sm pl-3 opacity-60 whitespace-pre-wrap">{note.note}</div>}
              <button
                onClick={() => note.id && onDeleteNote(note.id)}
                className="absolute top-0 right-0 p-1 opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity"
                title={notesCopy.delete}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}
