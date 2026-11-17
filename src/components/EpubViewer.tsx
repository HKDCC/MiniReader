import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import ePub, { Book, Rendition } from 'epubjs';
import { Theme } from '../App';
import { Note } from '../db/db';
import type { ReaderLocationChange, ReaderPageInfo, TextSelectionInfo } from './readerTypes';
import { getReaderFontStack, lxgwFontFaceCss } from '../shared/fonts';
import { extractSentence } from '../shared/spanText';
import { vocabService } from '../services/vocabService';
import {
  InkRun,
  noteKeyFromColor,
  rectsOfRange,
  renderInk,
  runInBox,
  styleInkLayer,
} from '../shared/ink';

/**
 * 熟练度与笔记都改用 SVG 手绘层：
 * CSS Highlight API 只能画直线或纯色块，画不出马克笔的毛边与浓淡。
 * 两条通道分开出笔——熟练度是宽底色，笔记是字脚下的窄带。
 */
function buildEpubReaderStyle(fontSize: number, lineHeight: number, fontFamily: string, currentTheme: any) {
  return `
    ${lxgwFontFaceCss(window.location.href)}
    html, body, body * {
      font-size: ${fontSize}px !important;
      line-height: ${lineHeight} !important;
      font-family: ${getReaderFontStack(fontFamily)} !important;
      color: ${currentTheme.text} !important;
    }
    body {
      background-color: ${currentTheme.bg} !important;
      padding: 28px 20px 28px 20px !important;
      margin: 0 !important;
      position: relative !important;
    }
    img, video, svg:not(#mr-ink) {
      max-width: 100% !important;
      height: auto !important;
    }
    ::selection {
      background: ${currentTheme.text}22 !important;
    }
  `;
}

function getWordAtPoint(
  doc: Document,
  x: number,
  y: number
): { word: string; rect: DOMRect; context?: string } | null {
  try {
    const range = (doc as any).caretRangeFromPoint ? (doc as any).caretRangeFromPoint(x, y) : null;
    if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) return null;

    const text = range.startContainer.textContent || '';
    let offset = range.startOffset;

    if (offset >= text.length || !/[a-zA-Z]/.test(text[offset])) {
      if (offset > 0 && /[a-zA-Z]/.test(text[offset - 1])) {
        offset = offset - 1;
      } else {
        return null;
      }
    }

    let start = offset;
    while (start > 0 && /[a-zA-Z'\u2019]/.test(text[start - 1])) {
      start--;
    }

    let end = offset;
    while (end < text.length && /[a-zA-Z'\u2019]/.test(text[end])) {
      end++;
    }

    const word = text.slice(start, end).replace(/^['\u2019]|['\u2019]$/g, '');
    if (!word || (word.length < 2 && !['a', 'i', 'A', 'I'].includes(word))) return null;

    const wordRange = doc.createRange();
    wordRange.setStart(range.startContainer, start);
    wordRange.setEnd(range.startContainer, end);
    const rect = wordRange.getBoundingClientRect();

    // 取词所在块级元素（EPUB 的段落即使视觉跨页，DOM 里仍是完整段落）
    const node = range.startContainer as Text;
    const block = (node.parentElement?.closest(
      'p,li,blockquote,div,td,h1,h2,h3,h4,h5,h6'
    ) ?? node.parentElement) as HTMLElement | null;

    let context: string | undefined;
    if (block) {
      try {
        const prefix = doc.createRange();
        prefix.selectNodeContents(block);
        prefix.setEnd(node, start);
        const blockOffset = prefix.toString().length;
        context = extractSentence(
          block.textContent || '',
          blockOffset,
          blockOffset + (end - start)
        );
      } catch {
        context = undefined;
      }
    }

    return { word, rect, context };
  } catch {
    return null;
  }
}

function collectVocabRuns(
  doc: Document,
  win: Window,
  vocabMap: Map<string, number> | undefined,
  defaultLevels: Record<string, number> | undefined,
  originLeft: number,
  originTop: number
): InkRun[] {
  const runs: InkRun[] = [];

  // 词组型生词（up-and-comers / break down）抓不到单词等级，单独扫一遍
  const phrases: { phrase: string; level: number }[] = [];
  vocabMap?.forEach((level, word) => {
    if (level >= 1 && level <= 4 && word.length > 2 && /[\s-]/.test(word)) {
      phrases.push({ phrase: word, level });
    }
  });
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  let cursor = 0;

  while ((node = walker.nextNode() as Text | null)) {
    const parent = node.parentElement;
    if (!parent || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue;

    const text = node.textContent || '';
    if (!/[a-zA-Z]{2,}/.test(text)) continue;

    const cs = win.getComputedStyle(parent);
    const fontSize = parseFloat(cs.fontSize) || 18;
    const fontFamily = cs.fontFamily;
    const pushRun = (range: Range, level: number) => {
      if (level < 1 || level > 4) return;
      const rects = rectsOfRange(range, originLeft, originTop);
      if (!rects.length) return;
      runs.push({
        kind: 'vocab',
        rects,
        fontSize,
        fontFamily,
        level,
        seed: `v${level}|${cursor++}|${text.slice(0, 12)}`,
      });
    };

    const lowerText = text.toLowerCase();
    const phraseRanges: { start: number; end: number; level: number }[] = [];

    for (const { phrase, level } of phrases) {
      let from = 0;
      while (from <= lowerText.length - phrase.length) {
        const at = lowerText.indexOf(phrase, from);
        if (at < 0) break;
        const end = at + phrase.length;
        const before = at === 0 ? '' : lowerText[at - 1];
        const after = end >= lowerText.length ? '' : lowerText[end];
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
          if (!phraseRanges.some((r) => at < r.end && end > r.start)) {
            phraseRanges.push({ start: at, end, level });
          }
        }
        from = at + 1;
      }
    }

    for (const range of phraseRanges) {
      try {
        const r = doc.createRange();
        r.setStart(node, range.start);
        r.setEnd(node, range.end);
        pushRun(r, range.level);
      } catch {}
    }

    const regex = /[a-zA-Z]+(?:['\u2019][a-zA-Z]+)?/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      // 落在词组范围内的单词跳过，避免和整段词组区间叠加
      if (
        phraseRanges.some(
          (r) => match!.index < r.end && match!.index + match![0].length > r.start
        )
      ) {
        continue;
      }

      const clean = match[0].toLowerCase();
      const level = vocabMap?.get(clean) ?? defaultLevels?.[clean] ?? 5;
      if (level < 1 || level > 4) continue;

      try {
        const r = doc.createRange();
        r.setStart(node, match.index);
        r.setEnd(node, match.index + match[0].length);
        pushRun(r, level);
      } catch {}
    }
  }

  return runs;
}

export interface EpubViewerRef {
  next: () => void;
  prev: () => void;
  goTo: (href: string) => void;
  seekToProgress: (progress: number) => void;
  search: (query: string, direction?: number) => boolean | Promise<boolean>;
  clearSelection: () => void;
}

interface EpubViewerProps {
  data: ArrayBuffer;
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
  onError?: (error: unknown) => void;
  onTocLoaded?: (toc: any[]) => void;
}

interface EpubSectionPageCount {
  offset: number;
  pages: number;
  total: number;
}

const EpubViewer = forwardRef<EpubViewerRef, EpubViewerProps>(({
  data, theme, currentTheme, fontSize, lineHeight, fontFamily = 'Source Han Serif SC', isTwoPage = false, initialCfi, notes,
  intensiveMode = false, vocabMap, defaultLevels,
  onLocationChange, onTextSelected, onWordClick, onKeyPress, onReady, onError, onTocLoaded
}, ref) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const isMounted = useRef(true);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const onKeyPressRef = useRef(onKeyPress);
  const onWordClickRef = useRef(onWordClick);
  onWordClickRef.current = onWordClick;
  const intensiveModeRef = useRef(intensiveMode);
  intensiveModeRef.current = intensiveMode;
  const vocabMapRef = useRef(vocabMap);
  vocabMapRef.current = vocabMap;
  const defaultLevelsRef = useRef(defaultLevels);
  defaultLevelsRef.current = defaultLevels;
  const pendingSeekProgressRef = useRef<number | null>(null);
  const locationsReadyRef = useRef(false);
  const pageCountsRef = useRef<Map<number, EpubSectionPageCount> | null>(null);
  const measuringRenditionRef = useRef<Rendition | null>(null);
  const measurementRunRef = useRef(0);
  const reportLocationRef = useRef<((location: any) => void) | null>(null);
  const [viewerSize, setViewerSize] = useState({ width: 0, height: 0 });
  const lastSearchRef = useRef<{ query: string; index: number } | null>(null);
  // Store current style settings in ref so content hook always gets fresh values
  const styleRef = useRef({ fontSize, lineHeight, fontFamily, theme, currentTheme });
  styleRef.current = { fontSize, lineHeight, fontFamily, theme, currentTheme };

  useEffect(() => {
    onKeyPressRef.current = onKeyPress;
  }, [onKeyPress]);

  const inkRunsRef = useRef<Map<Document, InkRun[]>>(new Map());
  const inkLayerRef = useRef<Map<Document, SVGSVGElement>>(new Map());

  const ensureInkLayer = useCallback((doc: Document) => {
    let svg = inkLayerRef.current.get(doc);
    if (svg && svg.ownerDocument === doc && svg.isConnected) return svg;
    svg = doc.getElementById('mr-ink') as unknown as SVGSVGElement | null;
    if (!svg) {
      svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('id', 'mr-ink');
      doc.body.appendChild(svg);
    }
    inkLayerRef.current.set(doc, svg);
    return svg;
  }, []);

  const paintContentInk = useCallback((c: any) => {
    const doc: Document | undefined = c?.document;
    const win: Window | undefined = c?.window;
    const body = doc?.body;
    if (!doc || !win || !body) return;

    const runs = inkRunsRef.current.get(doc);
    if (!runs) return;

    const svg = ensureInkLayer(doc);
    const docEl = doc.documentElement;
    const dark = styleRef.current.theme === 'dark' || styleRef.current.theme === 'night';
    styleInkLayer(
      svg,
      Math.max(body.scrollWidth, docEl?.scrollWidth || 0),
      Math.max(body.scrollHeight, docEl?.scrollHeight || 0),
      dark ? 'screen' : 'multiply'
    );

    // iframe 往往比窗口宽得多（整章按栏铺开），要按 iframe 在窗口里的可见段裁剪
    const br = body.getBoundingClientRect();
    const frameEl = win.frameElement as HTMLElement | null;
    const parentWin = win.parent && win.parent !== win ? win.parent : null;
    const pw = parentWin?.innerWidth || win.innerWidth;
    const ph = parentWin?.innerHeight || win.innerHeight;
    const fr = frameEl?.getBoundingClientRect();
    const visLeft = fr ? Math.max(0, -fr.left) : 0;
    const visTop = fr ? Math.max(0, -fr.top) : 0;
    const visRight = fr ? Math.min(win.innerWidth, pw - fr.left) : win.innerWidth;
    const visBottom = fr ? Math.min(win.innerHeight, ph - fr.top) : win.innerHeight;
    const margin = 400;
    const box = {
      left: visLeft - br.left - margin,
      right: visRight - br.left + margin,
      top: visTop - br.top - margin,
      bottom: visBottom - br.top + margin,
    };
    renderInk(svg, runs.filter((run) => runInBox(run, box)), doc);
  }, [ensureInkLayer]);

  const refreshContentsHighlights = useCallback(async (c: any) => {
    const doc: Document | undefined = c?.document;
    const win: Window | undefined = c?.window;
    const body = doc?.body;
    if (!doc || !win || !body) return;

    const br = body.getBoundingClientRect();
    const runs: InkRun[] = [];

    // 笔记：字脚下的手绘窄带
    for (const note of notesRef.current) {
      try {
        const range = renditionRef.current?.getRange(note.cfi);
        if (!range || !range.startContainer) continue;
        if (!doc.contains(range.startContainer)) continue;
        const host = range.startContainer.parentElement;
        const cs = host ? win.getComputedStyle(host) : null;
        const rects = rectsOfRange(range, br.left, br.top);
        if (!rects.length) continue;
        runs.push({
          kind: 'note',
          rects,
          fontSize: parseFloat(cs?.fontSize || '') || 18,
          fontFamily: cs?.fontFamily || 'serif',
          note: noteKeyFromColor(note.color),
          seed: `${note.cfi}|${note.color}`,
        });
      } catch {
        // 章节还没渲染时 getRange 会抛，渲染后 refreshContentsHighlights 会再来一次
      }
    }

    // 熟练度：宽底色，5 级不出笔
    if (intensiveModeRef.current) {
      const text = body.textContent || '';
      const rawWords = text.match(/[a-zA-Z]+(?:['\u2019][a-zA-Z]+)?/g) || [];
      const uniqueWords = Array.from(new Set(rawWords.map((w: string) => w.toLowerCase()))) as string[];
      const levels = await vocabService.getDefaultLevels(uniqueWords);
      runs.push(...collectVocabRuns(doc, win, vocabMapRef.current, levels, br.left, br.top));
    }

    inkRunsRef.current.set(doc, runs);
    paintContentInk(c);
  }, [paintContentInk]);

  useEffect(() => {
    if (!renditionRef.current) return;
    const contentsList = renditionRef.current.getContents() as any;
    const targets = Array.isArray(contentsList) ? contentsList : contentsList ? [contentsList] : [];
    targets.forEach((c: any) => {
      refreshContentsHighlights(c);
    });
  }, [intensiveMode, vocabMap, refreshContentsHighlights]);

  useImperativeHandle(ref, () => ({
    next: () => {
      renditionRef.current?.next();
    },
    prev: () => {
      renditionRef.current?.prev();
    },
    goTo: (href: string) => {
      try {
        renditionRef.current?.display(href);
      } catch (e) {
        renditionRef.current?.display(href);
      }
    },
    seekToProgress: (progress: number) => {
      const normalized = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
      const book = bookRef.current;
      const rendition = renditionRef.current;
      if (!book || !rendition || !locationsReadyRef.current) {
        pendingSeekProgressRef.current = normalized;
        return;
      }

      const cfi = book.locations.cfiFromPercentage(normalized);
      void rendition.display(cfi);
    },
    search: async (query: string, direction = 1) => {
      const needle = query.trim();
      if (!needle) return false;
      const book = bookRef.current as any;
      const rendition = renditionRef.current as any;
      const sections = book?.spine?.spineItems || [];
      if (!book || !rendition || sections.length === 0) return false;

      const normalizedQuery = needle.toLocaleLowerCase();
      const currentIndex = Number(rendition.currentLocation?.()?.start?.index ?? 0);
      const repeated = lastSearchRef.current?.query === normalizedQuery;
      const startIndex = repeated ? currentIndex + direction : currentIndex;
      for (let offset = 0; offset < sections.length; offset += 1) {
        const index = ((startIndex + offset * direction) % sections.length + sections.length) % sections.length;
        const section = sections[index];
        const wasLoaded = Boolean(section.document);
        try {
          await section.load(book.load.bind(book));
          const matches = section.search(needle);
          if (!wasLoaded) section.unload();
          if (matches.length > 0) {
            const match = direction < 0 ? matches[matches.length - 1] : matches[0];
            await rendition.display(match.cfi);
            lastSearchRef.current = { query: normalizedQuery, index };
            return true;
          }
        } catch (error) {
          console.warn('Failed to search EPUB section', error);
          if (!wasLoaded) section.unload?.();
        }
      }
      return false;
    },
    clearSelection: () => {
      const contents = renditionRef.current?.getContents() as any;
      if (Array.isArray(contents)) {
        contents.forEach(c => c.window.getSelection()?.removeAllRanges());
      } else if (contents) {
        contents.window?.getSelection()?.removeAllRanges();
      }
    }
  }));

  useEffect(() => {
    isMounted.current = true;
    locationsReadyRef.current = false;
    pageCountsRef.current = null;
    reportLocationRef.current = null;
    pendingSeekProgressRef.current = null;
    lastSearchRef.current = null;
    if (!viewerRef.current) return;

    // Clear previous content if any
    viewerRef.current.innerHTML = '';

    const book = ePub(data);
    bookRef.current = book;

    const rendition = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      spread: isTwoPage ? 'auto' : 'none',
      manager: 'continuous',
      flow: 'paginated',
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;

    // Register base theme (content hook handles the strong CSS injection)
    rendition.themes.register('custom', {
      body: {
        'font-family': getReaderFontStack(fontFamily),
        'font-size': `${fontSize}px`,
      },
    });
    rendition.themes.select('custom');

    // Display the book
    rendition.display(initialCfi || undefined).then(() => {
      if (isMounted.current) onReady();
    }).catch((error) => {
      console.error('Failed to display EPUB', error);
      if (isMounted.current) onError?.(error);
    });

    // Load TOC
    book.loaded.navigation.then((nav: any) => {
      if (isMounted.current && onTocLoaded) {
        onTocLoaded(nav.toc);
      }
    }).catch((error) => console.warn('Failed to load EPUB navigation', error));

    // Inject event listeners and styles into each content iframe
    rendition.hooks.content.register((contents: any) => {
      const doc = contents.document;
      
      // Inject CSS using CURRENT style values from ref (not stale closure values)
      const applyStyles = () => {
        const { fontSize: fs, lineHeight: lh, fontFamily: ff, theme: t, currentTheme: ct } = styleRef.current;
        try {
          let styleEl = doc.getElementById('global-reader-style');
          if (!styleEl) {
            styleEl = doc.createElement('style');
            styleEl.id = 'global-reader-style';
            doc.head.appendChild(styleEl);
          }
          styleEl.textContent = buildEpubReaderStyle(fs, lh, ff, ct);
        } catch (e) {}
      };
      applyStyles();

      const runHighlights = () => {
        refreshContentsHighlights(contents);
      };
      runHighlights();

      // Also re-apply after a short delay (EPUB may inject its own CSS after our hook)
      setTimeout(() => {
        applyStyles();
        runHighlights();
      }, 100);
      setTimeout(() => {
        applyStyles();
        runHighlights();
      }, 500);

      // Single click on word to trigger dictionary lookup in intensive mode
      doc.addEventListener('click', (e: MouseEvent) => {
        if (!intensiveModeRef.current) return;
        const sel = contents.window?.getSelection?.();
        if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

        const res = getWordAtPoint(doc, e.clientX, e.clientY);
        if (!res) return;

        const iframe = contents.document?.defaultView?.frameElement;
        const iframeRect = iframe ? iframe.getBoundingClientRect() : { left: 0, top: 0 };
        const screenRect = new DOMRect(
          iframeRect.left + res.rect.left,
          iframeRect.top + res.rect.top,
          res.rect.width,
          res.rect.height
        );
        onWordClickRef.current?.(res.word, screenRect, res.context);
      });

      doc.addEventListener('keyup', (e: KeyboardEvent) => {
        if (onKeyPressRef.current) onKeyPressRef.current(e.key);
      });

      let wheelTimeout: any;
      doc.addEventListener('wheel', (e: WheelEvent) => {
        e.preventDefault();
        if (wheelTimeout) return;
        
        if (e.deltaY > 0) {
          rendition.next();
        } else if (e.deltaY < 0) {
          rendition.prev();
        }
        
        wheelTimeout = setTimeout(() => {
          wheelTimeout = null;
        }, 100);
      }, { passive: false });
    });

    // Fix margin/double-page issue on resize
    let resizeInkTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      try {
        if (viewerRef.current) {
          rendition.resize(viewerRef.current.clientWidth, viewerRef.current.clientHeight);
          const width = viewerRef.current.clientWidth;
          const height = viewerRef.current.clientHeight;
          setViewerSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
        }
      } catch (e) {}
      window.clearTimeout(resizeInkTimer);
      resizeInkTimer = window.setTimeout(() => {
        try {
          const contents = rendition.getContents();
          const list: any[] = Array.isArray(contents) ? contents : contents ? [contents] : [];
          list.forEach((c) => paintContentInk(c));
        } catch {}
      }, 260);
    });
    observer.observe(viewerRef.current);
    setViewerSize({ width: viewerRef.current.clientWidth, height: viewerRef.current.clientHeight });

    // Handle text selection for annotations
    rendition.on('selected', (cfiRange: string, contents: any) => {
      const selection = contents.window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const rawRect = range.getBoundingClientRect();
      const rect = (rawRect.width === 0 && rawRect.height === 0 && range.getClientRects().length > 0)
        ? range.getClientRects()[0]
        : rawRect;
      const iframe = contents.document?.defaultView?.frameElement;
      const iframeRect = iframe ? iframe.getBoundingClientRect() : { left: 0, top: 0 };

      const top = iframeRect.top + rect.top;
      const bottom = iframeRect.top + rect.bottom;
      const left = iframeRect.left + rect.left;
      const right = iframeRect.left + rect.right;
      const x = left + rect.width / 2;
      const y = top;

      // 取选区所在块级元素扩成整句。selection.toString() 会折叠空白，
      // 不能用它的长度反推偏移，必须用 Range 前缀测。
      let context: string | undefined;
      try {
        const startNode = range.startContainer;
        if (startNode.nodeType === Node.TEXT_NODE) {
          const startEl = (startNode as Text).parentElement;
          const block = (startEl?.closest(
            'p,li,blockquote,div,td,h1,h2,h3,h4,h5,h6'
          ) ?? startEl) as HTMLElement | null;

          if (block) {
            const doc = contents.document as Document;
            const prefix = doc.createRange();
            prefix.selectNodeContents(block);
            prefix.setEnd(startNode, range.startOffset);
            const blockStart = prefix.toString().length;

            let blockEnd = blockStart + 1;
            if (block.contains(range.endContainer)) {
              const endPrefix = doc.createRange();
              endPrefix.selectNodeContents(block);
              endPrefix.setEnd(range.endContainer, range.endOffset);
              blockEnd = endPrefix.toString().length;
            }

            context = extractSentence(block.textContent || '', blockStart, blockEnd);
          }
        }
      } catch {
        context = undefined;
      }

      onTextSelected({
        cfiRange,
        text: selection.toString(),
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
    });

    // Clear selection on an actual click, but keep the selection created by
    // the selected event. epub.js emits click immediately after mouseup.
    rendition.on('click', () => {
      window.setTimeout(() => {
        const contents = rendition.getContents() as any;
        const targets = Array.isArray(contents) ? contents : contents ? [contents] : [];
        const hasTextSelection = targets.some((content: any) => {
          const selection = content.window?.getSelection?.();
          return selection && !selection.isCollapsed && selection.rangeCount > 0 && selection.toString().trim().length > 0;
        });

        if (!hasTextSelection) {
          onTextSelected(null);
        }
      }, 0);
    });

    const reportLocation = (location: any) => {
      const cfi = location?.start?.cfi;
      if (!cfi || !locationsReadyRef.current) return;
      const percentage = book.locations.percentageFromCfi(cfi);
      const displayed = location?.start?.displayed;
      const current = Number(displayed?.page);
      const sectionIndex = Number(location?.start?.index);
      const sectionPageCount = pageCountsRef.current?.get(sectionIndex);
      const localCurrent = Number.isFinite(current) ? Math.max(1, Math.round(current)) : 1;
      const pageInfo: ReaderPageInfo | undefined = sectionPageCount
        ? {
            current: sectionPageCount.offset + Math.min(sectionPageCount.pages, localCurrent),
            total: sectionPageCount.total,
          }
        : undefined;
      onLocationChange(percentage, cfi, pageInfo);
    };
    reportLocationRef.current = reportLocation;

    // Generate locations before persisting progress; otherwise the first
    // relocated event can incorrectly overwrite a saved position with 0%.
    void book.ready
      .then(() => book.locations.generate(1600))
      .then(() => {
        if (!isMounted.current) return;
        locationsReadyRef.current = true;
        const pendingProgress = pendingSeekProgressRef.current;
        pendingSeekProgressRef.current = null;
        if (pendingProgress !== null) {
          const targetCfi = book.locations.cfiFromPercentage(pendingProgress);
          void rendition.display(targetCfi);
        } else {
          reportLocation(rendition.currentLocation());
        }
      })
      .catch((error) => console.warn('Failed to generate EPUB locations', error));

    // Re-apply styles after page turns because EPUB content can inject CSS late.
    rendition.on('relocated', (location: any) => {
      if (!isMounted.current) return;
      
      // Re-apply styles to current content after page turn
      try {
        const contents = rendition.getContents();
        const targets = Array.isArray(contents) ? contents : contents ? [contents] : [];
        const { fontSize: fs, lineHeight: lh, fontFamily: ff, currentTheme: ct } = styleRef.current;
        targets.forEach((c: any) => {
          if (c.document) {
            let styleEl = c.document.getElementById('global-reader-style');
            if (!styleEl) {
              styleEl = c.document.createElement('style');
              styleEl.id = 'global-reader-style';
              c.document.head.appendChild(styleEl);
            }
            styleEl.textContent = buildEpubReaderStyle(fs, lh, ff, ct);
          }
          paintContentInk(c);
        });
      } catch (e) {}
      
      reportLocation(location);
    });

    return () => {
      isMounted.current = false;
      measurementRunRef.current += 1;
      if (measuringRenditionRef.current) {
        measuringRenditionRef.current.destroy();
        measuringRenditionRef.current = null;
      }
      reportLocationRef.current = null;
      observer.disconnect();
      window.clearTimeout(resizeInkTimer);
      book.destroy();
    };
  }, [data]); // Only re-init when the actual book data changes

  // Measure every spine section off-screen so chapter page counts can be
  // combined into a single book-wide page number.
  useEffect(() => {
    const book = bookRef.current as any;
    const mainRendition = renditionRef.current;
    if (!book || !mainRendition || viewerSize.width <= 0 || viewerSize.height <= 0) return;

    const runId = ++measurementRunRef.current;
    let cancelled = false;
    let measurementContainer: HTMLDivElement | null = null;
    let measurementRendition: Rendition | null = null;
    const restoreMainRendition = () => {
      if (book.rendition === measurementRendition) book.rendition = mainRendition;
    };
    const disposeMeasurement = () => {
      restoreMainRendition();
      if (measurementRendition) {
        if (measuringRenditionRef.current === measurementRendition) {
          measurementRendition.destroy();
          measuringRenditionRef.current = null;
        }
        measurementRendition = null;
      }
      measurementContainer?.remove();
      measurementContainer = null;
    };

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await book.ready;
          if (cancelled || runId !== measurementRunRef.current) return;

          if (fontFamily === 'LXGW WenKai') {
            try {
              await document.fonts.load(`${fontSize}px "LXGW WenKai"`);
            } catch {
              // Keep measuring with the system fallback if the bundled font is unavailable.
            }
          }

          measurementContainer = document.createElement('div');
          Object.assign(measurementContainer.style, {
            position: 'fixed',
            left: '-10000px',
            top: '0',
            width: `${viewerSize.width}px`,
            height: `${viewerSize.height}px`,
            visibility: 'hidden',
            pointerEvents: 'none',
            zIndex: '-1',
          });
          document.body.appendChild(measurementContainer);

          measurementRendition = book.renderTo(measurementContainer, {
            width: viewerSize.width,
            height: viewerSize.height,
            spread: isTwoPage ? 'auto' : 'none',
            manager: 'continuous',
            flow: 'paginated',
            allowScriptedContent: false,
          });
          measuringRenditionRef.current = measurementRendition;
          restoreMainRendition();
          measurementRendition.themes.register('measurement', {
            body: {
              'font-family': getReaderFontStack(fontFamily),
              'font-size': `${fontSize}px`,
            },
          });
          measurementRendition.themes.select('measurement');
          measurementRendition.hooks.content.register((contents: any) => {
            try {
              let style = contents.document.getElementById('global-reader-style');
              if (!style) {
                style = contents.document.createElement('style');
                style.id = 'global-reader-style';
                contents.document.head.appendChild(style);
              }
              style.textContent = buildEpubReaderStyle(fontSize, lineHeight, fontFamily, currentTheme);
            } catch {}
          });

          const sections = book.spine?.spineItems || [];
          const counts = new Map<number, number>();
          for (const section of sections) {
            if (cancelled || runId !== measurementRunRef.current) return;
            await new Promise<void>((resolve) => {
              const idleWindow = window as Window & {
                requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
              };
              if (idleWindow.requestIdleCallback) {
                idleWindow.requestIdleCallback(() => resolve(), { timeout: 900 });
              } else {
                window.setTimeout(resolve, 24);
              }
            });
            if (cancelled || runId !== measurementRunRef.current) return;
            try {
              await measurementRendition.display(section.href);
              const location = await Promise.resolve(measurementRendition.currentLocation() as any);
              const sectionIndex = Number(section.index ?? location?.start?.index);
              const sectionTotal = Number(location?.start?.displayed?.total);
              if (Number.isFinite(sectionIndex) && Number.isFinite(sectionTotal) && sectionTotal > 0) {
                counts.set(sectionIndex, Math.max(1, Math.round(sectionTotal)));
              }
            } catch (error) {
              if (!cancelled) console.warn('Failed to measure EPUB section pages', error);
            }
          }

          if (cancelled || runId !== measurementRunRef.current || counts.size !== sections.length) return;
          let totalPages = 0;
          const pageMap = new Map<number, EpubSectionPageCount>();
          for (const [sectionIndex, pages] of [...counts.entries()].sort(([a], [b]) => a - b)) {
            pageMap.set(sectionIndex, { offset: totalPages, pages, total: 0 });
            totalPages += pages;
          }
          for (const pageCount of pageMap.values()) pageCount.total = totalPages;
          pageCountsRef.current = pageMap;
          if (locationsReadyRef.current) reportLocationRef.current?.(mainRendition.currentLocation());
        } catch (error) {
          if (!cancelled) console.warn('Failed to measure EPUB book pages', error);
        } finally {
          disposeMeasurement();
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      disposeMeasurement();
    };
  }, [data, fontSize, lineHeight, fontFamily, isTwoPage, viewerSize.width, viewerSize.height]);

  // Handle dynamic style updates by re-injecting CSS into current content.
  useEffect(() => {
    if (!renditionRef.current) return;
    
    renditionRef.current.themes.fontSize(`${fontSize}px`);
    renditionRef.current.themes.font(getReaderFontStack(fontFamily));

    // Re-inject strong CSS into current content iframe(s)
    try {
      const contents = renditionRef.current.getContents();
      const targets = Array.isArray(contents) ? contents : contents ? [contents] : [];
      targets.forEach((c: any) => {
        if (c.document) {
          let style = c.document.getElementById('global-reader-style');
          if (!style) {
            style = c.document.createElement('style');
            style.id = 'global-reader-style';
            c.document.head.appendChild(style);
          }
          style.textContent = buildEpubReaderStyle(fontSize, lineHeight, fontFamily, currentTheme);
        }
      });
    } catch (e) {}

    try {
      renditionRef.current.spread(isTwoPage ? 'auto' : 'none');
    } catch (e) {}

    // 字号/行距/字体变化会重排正文，等布局落定后重算矩形再落笔
    const timer = window.setTimeout(() => {
      try {
        const contents = renditionRef.current?.getContents();
        const list: any[] = Array.isArray(contents) ? contents : contents ? [contents] : [];
        list.forEach((c) => { void refreshContentsHighlights(c); });
      } catch {}
    }, 180);
    return () => window.clearTimeout(timer);
  }, [theme, currentTheme, fontSize, lineHeight, fontFamily, isTwoPage, refreshContentsHighlights]);

  // 笔记变化时重新应用下划线（不再走 annotations，避免 marks-pane 的黑框黑线）
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    try {
      const contents = rendition.getContents();
      const list: any[] = Array.isArray(contents) ? contents : contents ? [contents] : [];
      list.forEach((c) => { void refreshContentsHighlights(c); });
    } catch {
      // 忽略
    }
  }, [notes, refreshContentsHighlights]);

  return (
    <div 
      ref={viewerRef} 
      className="w-full h-full epub-container" 
      style={{ backgroundColor: 'transparent' }}
    />
  );
});

export default EpubViewer;
