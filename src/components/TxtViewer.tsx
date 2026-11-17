import React, { useState, useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback } from 'react';
import { Theme } from '../App';
import { Note } from '../db/db';
import { InkRun, noteKeyFromColor, rectsOfRange, renderInk, runInBox, styleInkLayer } from '../shared/ink';
import type { ReaderLocationChange, ReaderPageInfo, TextSelectionInfo } from './readerTypes';
import { getReaderFontStack } from '../shared/fonts';
import { extractSentence } from '../shared/spanText';
import { vocabService } from '../services/vocabService';

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
  intensiveMode?: boolean;
  vocabMap?: Map<string, number>;
  defaultLevels?: Record<string, number>;
  onLocationChange: ReaderLocationChange;
  onTextSelected: (selection: TextSelectionInfo | null) => void;
  onWordClick?: (word: string, rect: DOMRect, context?: string) => void;
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
  text, theme, currentTheme, fontSize, lineHeight, fontFamily = 'Source Han Serif SC', isTwoPage = false, initialCfi, notes,
  intensiveMode = false, vocabMap, defaultLevels,
  onLocationChange, onTextSelected, onWordClick, onKeyPress, onReady, onTocLoaded
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
  const [computedLevels, setComputedLevels] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!intensiveMode || !text) return;
    const rawWords = text.match(/[a-zA-Z]+(?:['\u2019][a-zA-Z]+)?/g) || [];
    const uniqueWords = Array.from(new Set(rawWords.map((w: string) => w.toLowerCase()))) as string[];
    vocabService.getDefaultLevels(uniqueWords).then(setComputedLevels);
  }, [intensiveMode, text]);

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

    const chunkStart = chunkStartOffsets[chunkIndex] || 0;
    const context = extractSentence(text, chunkStart + trimmedStart, chunkStart + trimmedEnd);

    const rawRect = range.getBoundingClientRect();
    const rect = (rawRect.width === 0 && rawRect.height === 0 && range.getClientRects().length > 0)
      ? range.getClientRects()[0]
      : rawRect;

    const top = rect.top;
    const bottom = rect.bottom;
    const left = rect.left;
    const right = rect.right;
    const x = left + rect.width / 2;
    const y = top;
    
    onTextSelected({
      cfiRange: `txt-${chunkIndex}-${trimmedStart}-${trimmedEnd}`,
      text: currentText.slice(trimmedStart, trimmedEnd),
      context,
      x,
      y,
      top,
      bottom,
      left,
      right,
      width: rect.width,
      height: rect.height,
    });
  };

  /**
   * 用 Range 前缀测出节点在正文中的字符偏移，再换算到整书偏移取句。
   * 多列布局只影响绘制位置，不影响 Range.toString() 的节点树顺序，所以这里可靠。
   */
  const buildContextBefore = (node: Node | null): string | undefined => {
    const content = contentRef.current;
    if (!content || !node) return undefined;
    try {
      const range = document.createRange();
      range.selectNodeContents(content);
      range.setEnd(node, 0);
      const absolute = (chunkStartOffsets[chunkIndex] || 0) + range.toString().length;
      return extractSentence(text, absolute, absolute + 1);
    } catch {
      return undefined;
    }
  };

  /**
   * 词组型的生词（up-and-comers、break down）在正文里是多个 token，
   * 逐词匹配永远命中不了它们的等级，所以单独做一遍短语扫描。
   * 长短语优先，避免短词抢先命中。
   */
  const phraseEntries = useMemo(() => {
    const list: { phrase: string; level: number }[] = [];
    vocabMap?.forEach((level, word) => {
      if (level < 5 && word.length > 2 && /[\s-]/.test(word)) {
        list.push({ phrase: word, level });
      }
    });
    return list.sort((a, b) => b.phrase.length - a.phrase.length);
  }, [vocabMap]);

  const findPhraseRanges = (segment: string) => {
    if (!phraseEntries.length) return [] as { start: number; end: number; level: number }[];
    const lower = segment.toLowerCase();
    const ranges: { start: number; end: number; level: number }[] = [];

    for (const { phrase, level } of phraseEntries) {
      let from = 0;
      while (from <= lower.length - phrase.length) {
        const at = lower.indexOf(phrase, from);
        if (at < 0) break;
        const end = at + phrase.length;
        const before = at === 0 ? '' : lower[at - 1];
        const after = end >= lower.length ? '' : lower[end];
        // 前后必须是非词字符，避免 "and" 命中 "hand"
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
          if (!ranges.some((r) => at < r.end && end > r.start)) {
            ranges.push({ start: at, end, level });
          }
        }
        from = at + 1;
      }
    }
    return ranges;
  };

  const renderSegmentTokens = (textSegment: string) => {
    if (!intensiveMode) {
      return textSegment;
    }

    const phraseRanges = findPhraseRanges(textSegment);
    const parts = textSegment.split(/([a-zA-Z]+(?:['\u2019][a-zA-Z]+)?)/g);
    let cursor = 0;

    return parts.map((part, idx) => {
      const partStart = cursor;
      cursor += part.length;
      const phrase = phraseRanges.find(
        (r) => partStart < r.end && partStart + part.length > r.start
      );

      if (!part || !/^[a-zA-Z]/.test(part)) {
        if (phrase) {
          return (
            <span key={idx} data-vocab-level={phrase.level}>
              {part}
            </span>
          );
        }
        return part;
      }

      const clean = part.toLowerCase();
      const level =
        phrase?.level ??
        vocabMap?.get(clean) ??
        computedLevels[clean] ??
        defaultLevels?.[clean] ??
        5;
      const isLevelActive = level < 5;

      // 熟练度 = 宽底色，笔记 = 字脚窄带。两条通道都交给 SVG 手绘层，这里只留语义。
      return (
        <span
          key={idx}
          data-vocab-word={clean}
          data-vocab-level={isLevelActive ? level : undefined}
          className={`vocab-token transition-colors select-text ${
            isLevelActive
              ? 'px-[1px] cursor-pointer hover:opacity-90'
              : 'cursor-pointer hover:underline decoration-dotted decoration-current/30'
          }`}
          onClick={(e) => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onWordClick?.(part, rect, buildContextBefore(e.currentTarget.firstChild));
            }
          }}
        >
          {part}
        </span>
      );
    });
  };

  const inkRef = useRef<SVGSVGElement>(null);

  const drawInk = useCallback(() => {
    const content = contentRef.current;
    const svg = inkRef.current;
    if (!content || !svg) return;

    const height = content.clientHeight;
    const width = Math.max(content.scrollWidth, content.clientWidth);
    const dark = theme === 'dark' || theme === 'night';
    styleInkLayer(svg, width, height, dark ? 'screen' : 'multiply');

    const cr = content.getBoundingClientRect();
    const pageStep = actualTwoPage ? containerWidth / 2 + 24 : containerWidth;
    const pageLeft = Math.max(0, columnIndex) * pageStep;
    const box = {
      left: pageLeft - pageStep * 0.6,
      right: pageLeft + pageStep * 1.6,
      top: -120,
      bottom: height + 120,
    };

    const runs: InkRun[] = [];
    let cursor = 0;

    const pushRun = (el: HTMLElement, kind: 'vocab' | 'note') => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = rectsOfRange(range, cr.left, cr.top);
      if (!rects.length) return;
      const cs = window.getComputedStyle(el);
      const level = Number(el.dataset.vocabLevel || 0);
      if (kind === 'vocab' && (!level || level > 4)) return;
      runs.push({
        kind,
        rects,
        fontSize: parseFloat(cs.fontSize) || fontSize,
        fontFamily: cs.fontFamily,
        level: kind === 'vocab' ? level : undefined,
        note: kind === 'note' ? noteKeyFromColor(el.dataset.note || '') : undefined,
        seed: kind === 'vocab'
          ? `v${level}|${el.dataset.vocabWord || ''}|${cursor++}`
          : `n|${el.dataset.note || ''}|${el.textContent?.slice(0, 12) || ''}`,
      });
    };

    content.querySelectorAll<HTMLElement>('[data-vocab-level]').forEach((el) => pushRun(el, 'vocab'));
    content.querySelectorAll<HTMLElement>('.note-mark').forEach((el) => pushRun(el, 'note'));

    renderInk(svg, runs.filter((run) => runInBox(run, box)), document);
  }, [actualTwoPage, containerWidth, columnIndex, fontSize, theme]);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(drawInk);
    return () => cancelAnimationFrame(raf);
  }, [drawInk, chunkIndex, columnIndex, notes, intensiveMode, vocabMap, defaultLevels, lineHeight, fontFamily, theme, fontMetricsReady, containerHeight, columnsInChunk]);

  const renderContent = () => {
    const currentText = chunks[chunkIndex] || '';
    const chunkNotes = notes.filter(n => n.cfi.startsWith(`txt-${chunkIndex}-`));
    
    if (chunkNotes.length === 0) {
      return renderSegmentTokens(currentText);
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

    return segments.map((seg, i) =>
      seg.color ? (
        <span key={i} className="note-mark" data-note={seg.color}>
          {renderSegmentTokens(seg.text)}
        </span>
      ) : (
        <React.Fragment key={i}>{renderSegmentTokens(seg.text)}</React.Fragment>
      )
    );
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
          position: 'relative',
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
        <svg ref={inkRef} className="txt-ink" aria-hidden="true" />
        {renderContent()}
      </div>
    </div>
  );
});

export default TxtViewer;
