import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import ePub, { Book, Rendition } from 'epubjs';
import { Theme } from '../App';
import { Note } from '../db/db';
import type { ReaderLocationChange, ReaderPageInfo } from './readerTypes';
import { getReaderFontStack, lxgwFontFaceCss } from '../shared/fonts';

const safeNoteColor = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#fcd34d');

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
      padding: 60px 20px 60px 20px !important;
      margin: 0 !important;
    }
    img, svg, video {
      max-width: 100% !important;
      height: auto !important;
    }
    ::selection {
      background: ${currentTheme.text}22 !important;
    }
  `;
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
  onLocationChange: ReaderLocationChange;
  onTextSelected: (selection: { cfiRange: string, text: string, x: number, y: number } | null) => void;
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
  data, theme, currentTheme, fontSize, lineHeight, fontFamily = 'Source Han Serif SC', isTwoPage = false, initialCfi, notes, onLocationChange, onTextSelected, onKeyPress, onReady, onError, onTocLoaded
}, ref) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const isMounted = useRef(true);
  const appliedNotes = useRef<Set<string>>(new Set());
  const onKeyPressRef = useRef(onKeyPress);
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

      // Also re-apply after a short delay (EPUB may inject its own CSS after our hook)
      setTimeout(applyStyles, 100);
      setTimeout(applyStyles, 500);

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
    const observer = new ResizeObserver(() => {
      try {
        if (viewerRef.current) {
          rendition.resize(viewerRef.current.clientWidth, viewerRef.current.clientHeight);
          const width = viewerRef.current.clientWidth;
          const height = viewerRef.current.clientHeight;
          setViewerSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
        }
      } catch (e) {}
    });
    observer.observe(viewerRef.current);
    setViewerSize({ width: viewerRef.current.clientWidth, height: viewerRef.current.clientHeight });

    // Handle text selection for annotations
    rendition.on('selected', (cfiRange: string, contents: any) => {
      const selection = contents.window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const iframe = contents.document.defaultView.frameElement;
      const iframeRect = iframe.getBoundingClientRect();

      onTextSelected({
        cfiRange,
        text: selection.toString(),
        x: iframeRect.left + rect.left + rect.width / 2,
        y: iframeRect.top + rect.top
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
  }, [theme, currentTheme, fontSize, lineHeight, fontFamily, isTwoPage]);

  // Handle annotations sync
  useEffect(() => {
    if (!renditionRef.current) return;
    const rendition = renditionRef.current;
    const currentCfis = new Set(notes.map(n => n.cfi));

    // Remove notes that are no longer in the list
    appliedNotes.current.forEach(cfi => {
      if (!currentCfis.has(cfi)) {
        try { rendition.annotations.remove(cfi, "highlight"); } catch (e) {}
      }
    });

    // Add new notes
    notes.forEach(note => {
      if (!appliedNotes.current.has(note.cfi)) {
        try {
          rendition.annotations.highlight(note.cfi, {}, () => {}, undefined, { fill: safeNoteColor(note.color), "fill-opacity": "0.3" });
        } catch (e) {
          console.warn("Failed to apply highlight", e);
        }
      }
    });

    appliedNotes.current = currentCfis;
  }, [notes]);

  return (
    <div 
      ref={viewerRef} 
      className="w-full h-full epub-container" 
      style={{ backgroundColor: 'transparent' }}
    />
  );
});

export default EpubViewer;
