import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback } from 'react';
import { Theme } from '../App';
import { Note } from '../db/db';

interface TxtViewerRef {
  next: () => void;
  prev: () => void;
  goTo: (href: string) => void;
  clearSelection: () => void;
}

interface TxtViewerProps {
  text: string;
  theme: Theme;
  currentTheme: any;
  fontSize: number;
  lineHeight: number;
  fontFamily?: string;
  isTwoPage?: boolean;
  initialCfi?: string;
  notes: Note[];
  onLocationChange: (percentage: number, cfi: string) => void;
  onTextSelected: (selection: { cfiRange: string, text: string, x: number, y: number } | null) => void;
  onKeyPress?: (key: string) => void;
  onReady: () => void;
  onTocLoaded?: (toc: any[]) => void;
}

const CHUNK_SIZE = 15000;

function splitWhitespaceEdges(value: string) {
  const leading = value.match(/^\s*/)?.[0].length ?? 0;
  const trailing = value.match(/\s*$/)?.[0].length ?? 0;
  return { leading, trailing };
}

function renderHighlightedText(text: string, color: string) {
  return text.split(/(\s+)/).map((part, index) => {
    if (!part) return null;
    if (/^\s+$/.test(part)) {
      return <React.Fragment key={index}>{part}</React.Fragment>;
    }
    return (
      <mark
        key={index}
        style={{ backgroundColor: color, opacity: 0.8, color: 'inherit' }}
      >
        {part}
      </mark>
    );
  });
}

const TxtViewer = forwardRef<TxtViewerRef, TxtViewerProps>(({
  text, theme, currentTheme, fontSize, lineHeight, fontFamily = 'Noto Serif SC', isTwoPage = false, initialCfi, notes, onLocationChange, onTextSelected, onKeyPress, onReady, onTocLoaded
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  
  const [chunkIndex, setChunkIndex] = useState(() => {
    if (initialCfi && initialCfi.startsWith('txt-')) {
      return parseInt(initialCfi.split('-')[1]) || 0;
    }
    return 0;
  });
  
  const [columnIndex, setColumnIndex] = useState(() => {
    if (initialCfi && initialCfi.startsWith('txt-')) {
      return parseInt(initialCfi.split('-')[2]) || 0;
    }
    return 0;
  });
  
  const [columnsInChunk, setColumnsInChunk] = useState(1);
  const [isReady, setIsReady] = useState(false);

  const chunks = useMemo(() => {
    const result = [];
    let i = 0;
    // Chapter marker patterns
    const chapterPatterns = [
      /第\s*\d+\s*章/m,
      /Chapter\s+\d+/im,
      /={3,}/,
      /^#\s+/m,
    ];
    while (i < text.length) {
      let end = i + CHUNK_SIZE;
      // Search for chapter markers in the last 5000 chars of the potential chunk
      const searchStart = Math.max(i, end - 5000);
      const searchSlice = text.slice(searchStart, end);
      let chapterSplit = -1;
      for (const pattern of chapterPatterns) {
        const match = searchSlice.search(pattern);
        if (match !== -1) {
          const absPos = searchStart + match;
          // Only split if it's not at the very start of the chunk
          if (absPos > i) {
            chapterSplit = absPos;
            break;
          }
        }
      }
      if (chapterSplit !== -1) {
        end = chapterSplit;
      } else if (end < text.length) {
        const nextNewline = text.indexOf('\n', end);
        if (nextNewline !== -1 && nextNewline - end < 5000) {
          end = nextNewline + 1;
        }
      }
      result.push(text.slice(i, end));
      i = end;
    }
    return result;
  }, [text]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const actualTwoPage = isTwoPage && containerWidth > 600;

  useEffect(() => {
    if (!contentRef.current || containerWidth === 0) return;
    
    const timeoutId = setTimeout(() => {
      if (!contentRef.current) return;
      const scrollWidth = contentRef.current.scrollWidth;
      const cols = Math.max(1, Math.round(scrollWidth / containerWidth));
      setColumnsInChunk(cols);
      
      let newColIndex = columnIndex;
      if (columnIndex === -1 || columnIndex >= cols) {
        newColIndex = cols - 1;
        setColumnIndex(newColIndex);
      }
      
      if (!isReady) {
        setIsReady(true);
        onReady();
      }

      // Character position based percentage: chunkIndex*CHUNK_SIZE + newColIndex*(CHUNK_SIZE/cols)
      const chunkStart = chunks.slice(0, chunkIndex).reduce((total, chunk) => total + chunk.length, 0);
      const currentChunkLength = chunks[chunkIndex]?.length || 0;
      const colChars = currentChunkLength / Math.max(1, cols);
      const isLastColumn = chunkIndex === chunks.length - 1 && newColIndex >= cols - (actualTwoPage ? 2 : 1);
      const currentCharPos = isLastColumn ? text.length : chunkStart + newColIndex * colChars;
      const progress = Math.min(100, Math.round((currentCharPos / Math.max(1, text.length)) * 100));
      onLocationChange(progress, `txt-${chunkIndex}-${newColIndex}`);
    }, 50);
    
    return () => clearTimeout(timeoutId);
  }, [chunkIndex, columnIndex, containerWidth, fontSize, lineHeight, chunks, isReady, onReady, onLocationChange, text.length]);

  useImperativeHandle(ref, () => ({
    next: () => {
      setColumnIndex(c => {
        const step = actualTwoPage ? 2 : 1;
        if (c < columnsInChunk - step) return c + step;
        if (chunkIndex < chunks.length - 1) {
          setChunkIndex(chunkIndex + 1);
          return 0;
        }
        return c;
      });
    },
    prev: () => {
      setColumnIndex(c => {
        const step = actualTwoPage ? 2 : 1;
        if (c >= step) return c - step;
        if (chunkIndex > 0) {
          setChunkIndex(chunkIndex - 1);
          return -1;
        }
        return c;
      });
    },
    goTo: (href: string) => {
      // TxtViewer doesn't have TOC
    },
    clearSelection: () => {
      window.getSelection()?.removeAllRanges();
      onTextSelected(null);
    }
  }));

  // Remove duplicate keyup listener as Reader.tsx handles global keydown
  const wheelTimeout = useRef<any>(null);
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (wheelTimeout.current) return;
    
    const step = actualTwoPage ? 2 : 1;
    if (e.deltaY > 0) {
      setColumnIndex(c => {
        if (c < columnsInChunk - step) return c + step;
        if (chunkIndex < chunks.length - 1) {
          setChunkIndex(chunkIndex + 1);
          return 0;
        }
        return c;
      });
    } else if (e.deltaY < 0) {
      setColumnIndex(c => {
        if (c >= step) return c - step;
        if (chunkIndex > 0) {
          setChunkIndex(chunkIndex - 1);
          return -1;
        }
        return c;
      });
    }
    
    wheelTimeout.current = setTimeout(() => {
      wheelTimeout.current = null;
    }, 200);
  }, [columnsInChunk, chunkIndex, chunks.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  const handleMouseUp = () => {
    if (!contentRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      onTextSelected(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(contentRef.current);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    const start = preCaretRange.toString().length;
    
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    const end = preCaretRange.toString().length;
    const currentText = chunks[chunkIndex] || '';
    const rawSelectedText = sel.toString();
    const { leading, trailing } = splitWhitespaceEdges(rawSelectedText);
    const trimmedStart = Math.max(0, start + leading);
    const trimmedEnd = Math.min(currentText.length, end - trailing);

    if (trimmedEnd <= trimmedStart) {
      onTextSelected(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    
    onTextSelected({
      cfiRange: `txt-${chunkIndex}-${trimmedStart}-${trimmedEnd}`,
      text: currentText.slice(trimmedStart, trimmedEnd),
      x: rect.left + rect.width / 2,
      y: rect.top - 10
    });
  };

  const renderContent = () => {
    const currentText = chunks[chunkIndex] || '';
    const chunkNotes = notes.filter(n => n.cfi.startsWith(`txt-${chunkIndex}-`));
    
    if (chunkNotes.length === 0) {
      return currentText;
    }

    const segments: { text: string, color?: string }[] = [];
    let lastIndex = 0;
    
    const sortedNotes = chunkNotes.map(n => {
      const parts = n.cfi.split('-');
      return {
        start: parseInt(parts[2]),
        end: parseInt(parts[3]),
        color: n.color
      };
    }).sort((a, b) => a.start - b.start);

    sortedNotes.forEach(note => {
      if (note.start > lastIndex) {
        segments.push({ text: currentText.slice(lastIndex, note.start) });
      }
      if (note.start >= lastIndex) {
        segments.push({ 
          text: currentText.slice(note.start, note.end),
          color: note.color
        });
        lastIndex = Math.max(lastIndex, note.end);
      }
    });

    if (lastIndex < currentText.length) {
      segments.push({ text: currentText.slice(lastIndex) });
    }

    return segments.map((seg, i) => (
      seg.color
        ? <React.Fragment key={i}>{renderHighlightedText(seg.text, seg.color)}</React.Fragment>
        : <React.Fragment key={i}>{seg.text}</React.Fragment>
    ));
  };

  return (
    <div 
      ref={containerRef}
      className="w-full h-full overflow-hidden relative"
      onMouseUp={handleMouseUp}
    >
      <div
        ref={contentRef}
        style={{
          columnWidth: containerWidth > 0 ? (actualTwoPage ? `calc(50% - 1.5rem)` : `${containerWidth}px`) : '100%',
          columnGap: actualTwoPage ? '3rem' : '0px',
          height: '100%',
          transform: `translateX(-${Math.max(0, columnIndex) * (actualTwoPage ? containerWidth / 2 + 24 : containerWidth)}px)`,
          transition: 'transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)',
          fontSize: `${fontSize}px`,
          lineHeight: lineHeight,
          fontFamily: `"${fontFamily}", serif`,
          color: currentTheme.text,
          whiteSpace: 'pre-wrap',
          textAlign: 'justify',
          paddingBottom: '2rem'
        }}
      >
        {renderContent()}
      </div>
    </div>
  );
});

export default TxtViewer;
