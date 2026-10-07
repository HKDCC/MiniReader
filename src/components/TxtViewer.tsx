import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback } from 'react';
import { Theme } from '../App';
import { Note } from '../db/db';
import type { ReaderLocationChange, ReaderPageInfo } from './readerTypes';
import { getReaderFontStack } from '../shared/fonts';

interface TxtViewerRef {
  next: () => void;
  prev: () => void;
  goTo: (href: string) => void;
  seekToProgress: (progress: number) => void;
  search: (query: string, direction?: number) => boolean;
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
  onLocationChange: ReaderLocationChange;
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

function measureColumnCount(element: HTMLElement, containerWidth: number, actualTwoPage: boolean) {
  if (!actualTwoPage) {
    return Math.max(1, Math.round(element.scrollWidth / Math.max(1, containerWidth)));
  }

  const gap = 48;
  const columnWidth = Math.max(1, containerWidth / 2 - 24);
  return Math.max(1, Math.round((element.scrollWidth + gap) / (columnWidth + gap)));
}

function lastPageStart(columnCount: number, step: number) {
  return Math.floor(Math.max(0, columnCount - 1) / step) * step;
}

function createTextMeasureElement({
  containerWidth,
  containerHeight,
  actualTwoPage,
  fontSize,
  lineHeight,
  fontFamily,
}: {
  containerWidth: number;
  containerHeight: number;
  actualTwoPage: boolean;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
}) {
  const element = document.createElement('div');
  Object.assign(element.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    width: `${containerWidth}px`,
    height: `${containerHeight}px`,
    overflow: 'visible',
    columnWidth: actualTwoPage ? `${Math.max(1, containerWidth / 2 - 24)}px` : `${containerWidth}px`,
    columnGap: actualTwoPage ? '48px' : '0px',
    fontSize: `${fontSize}px`,
    lineHeight: String(lineHeight),
    fontFamily: getReaderFontStack(fontFamily),
    whiteSpace: 'pre-wrap',
    textAlign: 'justify',
    paddingBottom: '2rem',
  });
  return element;
}

const TxtViewer = forwardRef<TxtViewerRef, TxtViewerProps>(({
  text, theme, currentTheme, fontSize, lineHeight, fontFamily = 'Source Han Serif SC', isTwoPage = false, initialCfi, notes, onLocationChange, onTextSelected, onKeyPress, onReady, onTocLoaded
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  
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
  const [chunkColumnCounts, setChunkColumnCounts] = useState<number[] | null>(null);
  const pendingSeekProgressRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const fontMetricKey = fontFamily === 'LXGW WenKai' ? `${fontFamily}:${fontSize}` : 'system';
  const [settledFontKey, setSettledFontKey] = useState(() => fontFamily === 'LXGW WenKai' ? '' : 'system');
  const fontMetricsReady = fontFamily !== 'LXGW WenKai' || settledFontKey === fontMetricKey;

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

  const chunkStartOffsets = useMemo(() => {
    const offsets: number[] = [];
    let total = 0;
    chunks.forEach((chunk) => {
      offsets.push(total);
      total += chunk.length;
    });
    return offsets;
  }, [chunks]);

  const pageOffsets = useMemo(() => {
    if (!chunkColumnCounts) return null;
    const offsets: number[] = [];
    let total = 0;
    chunkColumnCounts.forEach((count) => {
      offsets.push(total);
      total += count;
    });
    return { offsets, total };
  }, [chunkColumnCounts]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const actualTwoPage = isTwoPage && containerWidth > 600;

  useEffect(() => {
    if (fontFamily !== 'LXGW WenKai') return;
    let cancelled = false;
    const key = `${fontFamily}:${fontSize}`;
    void document.fonts.load(`${fontSize}px "LXGW WenKai"`)
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSettledFontKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [fontFamily, fontSize]);

  const applyProgressSeek = useCallback((normalized: number, measuredCounts: number[] | null) => {
    if (chunks.length === 0) return;
    const targetOffset = Math.round(normalized * Math.max(0, text.length - 1));
    let targetChunk = chunks.length - 1;
    for (let index = 0; index < chunks.length; index += 1) {
      if (targetOffset < (chunkStartOffsets[index] || 0) + chunks[index].length || index === chunks.length - 1) {
        targetChunk = index;
        break;
      }
    }

    let columnCount = measuredCounts?.[targetChunk];
    if (!columnCount) {
      const element = createTextMeasureElement({
        containerWidth,
        containerHeight: containerHeight || containerRef.current?.clientHeight || 1,
        actualTwoPage,
        fontSize,
        lineHeight,
        fontFamily,
      });
      element.textContent = chunks[targetChunk];
      document.body.appendChild(element);
      columnCount = measureColumnCount(element, containerWidth, actualTwoPage);
      element.remove();
    }

    const localOffset = Math.max(0, targetOffset - (chunkStartOffsets[targetChunk] || 0));
    const step = actualTwoPage ? 2 : 1;
    const maxStart = lastPageStart(columnCount, step);
    const rawColumn = Math.floor((localOffset / Math.max(1, chunks[targetChunk].length)) * columnCount);
    const targetColumn = Math.min(maxStart, Math.floor(rawColumn / step) * step);

    setChunkIndex(targetChunk);
    setColumnIndex(targetColumn);
  }, [actualTwoPage, chunkStartOffsets, chunks, containerHeight, containerWidth, fontFamily, fontSize, lineHeight, text.length]);

  useEffect(() => {
    const pendingProgress = pendingSeekProgressRef.current;
    if (pendingProgress === null || !chunkColumnCounts || !fontMetricsReady) return;
    pendingSeekProgressRef.current = null;
    applyProgressSeek(pendingProgress, chunkColumnCounts);
  }, [applyProgressSeek, chunkColumnCounts, fontMetricsReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || containerWidth <= 0 || chunks.length === 0) return;

    setChunkColumnCounts(null);
    const measureElement = createTextMeasureElement({
      containerWidth,
      containerHeight: containerHeight || container.clientHeight,
      actualTwoPage,
      fontSize,
      lineHeight,
      fontFamily,
    });
    document.body.appendChild(measureElement);

    const counts = new Array<number>(chunks.length).fill(1);
    let nextIndex = 0;
    let cancelled = false;
    let timeoutId: number | null = null;
    let idleCallbackId: number | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: (deadline: { timeRemaining: () => number }) => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const measureBatch = (deadline?: { timeRemaining: () => number }) => {
      if (cancelled) return;
      const batchStart = performance.now();
      do {
        measureElement.textContent = chunks[nextIndex];
        counts[nextIndex] = measureColumnCount(measureElement, containerWidth, actualTwoPage);
        nextIndex += 1;
      } while (
        nextIndex < chunks.length &&
        (deadline ? deadline.timeRemaining() > 3 : performance.now() - batchStart < 4)
      );

      if (nextIndex >= chunks.length) {
        setChunkColumnCounts(counts);
        return;
      }

      if (idleWindow.requestIdleCallback) {
        idleCallbackId = idleWindow.requestIdleCallback(measureBatch, { timeout: 120 });
      } else {
        timeoutId = window.setTimeout(() => measureBatch(), 0);
      }
    };

    const scheduleInitialBatch = async () => {
      if (fontFamily === 'LXGW WenKai') {
        try {
          await document.fonts.load(`${fontSize}px "LXGW WenKai"`);
        } catch {
          // Keep measuring with the system fallback if the bundled font cannot load.
        }
      }
      if (cancelled) return;
      if (idleWindow.requestIdleCallback) {
        idleCallbackId = idleWindow.requestIdleCallback(measureBatch, { timeout: 120 });
      } else {
        timeoutId = window.setTimeout(() => measureBatch(), 0);
      }
    };
    void scheduleInitialBatch();

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (idleCallbackId !== null) idleWindow.cancelIdleCallback?.(idleCallbackId);
      measureElement.remove();
    };
  }, [actualTwoPage, chunks, containerHeight, containerWidth, fontFamily, fontSize, lineHeight]);

  useEffect(() => {
    if (!contentRef.current || containerWidth === 0) return;
    
    const timeoutId = setTimeout(() => {
      if (!contentRef.current) return;
      const cols = measureColumnCount(contentRef.current, containerWidth, actualTwoPage);
      setColumnsInChunk(cols);
      
      let newColIndex = columnIndex;
      if (columnIndex === -1 || columnIndex >= cols) {
        newColIndex = lastPageStart(cols, actualTwoPage ? 2 : 1);
        setColumnIndex(newColIndex);
      }
      
      if (!isReady) {
        setIsReady(true);
        onReady();
      }

      // Character position based percentage: chunkIndex*CHUNK_SIZE + newColIndex*(CHUNK_SIZE/cols)
      const chunkStart = chunkStartOffsets[chunkIndex] || 0;
      const currentChunkLength = chunks[chunkIndex]?.length || 0;
      const colChars = currentChunkLength / Math.max(1, cols);
      const isLastColumn = chunkIndex === chunks.length - 1 && newColIndex >= cols - (actualTwoPage ? 2 : 1);
      const currentCharPos = isLastColumn ? text.length : chunkStart + newColIndex * colChars;
      const progress = Math.min(100, Math.round((currentCharPos / Math.max(1, text.length)) * 100));
      const pageInfo: ReaderPageInfo | undefined = pageOffsets && chunkColumnCounts && pageOffsets.offsets[chunkIndex] !== undefined
        ? {
            current: Math.min(pageOffsets.total, pageOffsets.offsets[chunkIndex] + newColIndex + 1),
            total: pageOffsets.total,
          }
        : undefined;
      onLocationChange(progress, `txt-${chunkIndex}-${newColIndex}`, pageInfo);
    }, 50);
    
    return () => clearTimeout(timeoutId);
  }, [chunkIndex, columnIndex, containerHeight, containerWidth, fontSize, lineHeight, chunks, isReady, onReady, onLocationChange, text.length, actualTwoPage, chunkStartOffsets, chunkColumnCounts, pageOffsets]);

  useImperativeHandle(ref, () => ({
    next: () => {
      setColumnIndex(c => {
        const step = actualTwoPage ? 2 : 1;
        const nextColumn = c + step;
        if (nextColumn < columnsInChunk) return nextColumn;
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
    seekToProgress: (progress: number) => {
      if (chunks.length === 0) return;
      const normalized = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
      if (containerWidth <= 0 || !fontMetricsReady) {
        pendingSeekProgressRef.current = normalized;
        return;
      }
      pendingSeekProgressRef.current = null;
      applyProgressSeek(normalized, chunkColumnCounts);
    },
    search: (query: string, direction = 1) => {
      const needle = query.trim().toLocaleLowerCase();
      if (!needle) return false;
      const source = text.toLocaleLowerCase();
      const chunkStart = chunkStartOffsets[chunkIndex] || 0;
      const currentOffset = chunkStart + Math.max(0, columnIndex) * ((chunks[chunkIndex]?.length || 0) / Math.max(1, columnsInChunk));
      let match = direction >= 0 ? source.indexOf(needle, currentOffset + 1) : source.lastIndexOf(needle, Math.max(0, currentOffset - 1));
      if (match < 0) match = direction >= 0 ? source.indexOf(needle) : source.lastIndexOf(needle);
      if (match < 0) return false;

      let targetChunk = 0;
      let targetOffset = match;
      for (let index = 0; index < chunks.length; index += 1) {
        if (targetOffset <= chunks[index].length) {
          targetChunk = index;
          break;
        }
        targetOffset -= chunks[index].length;
      }
      setChunkIndex(targetChunk);
      setColumnIndex(0);
      return true;
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
        const nextColumn = c + step;
        if (nextColumn < columnsInChunk) return nextColumn;
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
  }, [actualTwoPage, columnsInChunk, chunkIndex, chunks.length]);

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
          columnWidth: containerWidth > 0
            ? (actualTwoPage ? `${Math.max(1, containerWidth / 2 - 24)}px` : `${containerWidth}px`)
            : '100%',
          columnGap: actualTwoPage ? '3rem' : '0px',
          height: '100%',
          transform: `translateX(-${Math.max(0, columnIndex) * (actualTwoPage ? containerWidth / 2 + 24 : containerWidth)}px)`,
          transition: 'transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)',
          fontSize: `${fontSize}px`,
          lineHeight: lineHeight,
          fontFamily: getReaderFontStack(fontFamily),
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
