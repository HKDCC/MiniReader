import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import ePub, { Book, Rendition } from 'epubjs';
import { Theme } from '../App';
import { Note } from '../db/db';

export interface EpubViewerRef {
  next: () => void;
  prev: () => void;
  goTo: (href: string) => void;
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
  onLocationChange: (percentage: number, cfi: string) => void;
  onTextSelected: (selection: { cfiRange: string, text: string, x: number, y: number } | null) => void;
  onKeyPress?: (key: string) => void;
  onReady: () => void;
  onTocLoaded?: (toc: any[]) => void;
}

const EpubViewer = forwardRef<EpubViewerRef, EpubViewerProps>(({
  data, theme, currentTheme, fontSize, lineHeight, fontFamily = 'Noto Serif SC', isTwoPage = false, initialCfi, notes, onLocationChange, onTextSelected, onKeyPress, onReady, onTocLoaded
}, ref) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const isMounted = useRef(true);
  const appliedNotes = useRef<Set<string>>(new Set());
  const onKeyPressRef = useRef(onKeyPress);
  const [opacity, setOpacity] = useState(1);
  // Store current style settings in ref so content hook always gets fresh values
  const styleRef = useRef({ fontSize, lineHeight, fontFamily, theme, currentTheme });
  styleRef.current = { fontSize, lineHeight, fontFamily, theme, currentTheme };

  useEffect(() => {
    onKeyPressRef.current = onKeyPress;
  }, [onKeyPress]);

  useImperativeHandle(ref, () => ({
    next: () => {
      setOpacity(0.4);
      renditionRef.current?.next();
    },
    prev: () => {
      setOpacity(0.4);
      renditionRef.current?.prev();
    },
    goTo: (href: string) => {
      setOpacity(0.4);
      try {
        renditionRef.current?.display(href);
      } catch (e) {
        renditionRef.current?.display(href);
      }
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
      flow: 'paginated'
    });
    renditionRef.current = rendition;

    // Register base theme (content hook handles the strong CSS injection)
    rendition.themes.register('custom', {
      body: {
        'font-family': `"${fontFamily}", serif`,
        'font-size': `${fontSize}px`,
      },
    });
    rendition.themes.select('custom');

    // Display the book
    rendition.display(initialCfi || undefined).then(() => {
      if (isMounted.current) onReady();
    });

    // Load TOC
    book.loaded.navigation.then((nav: any) => {
      if (isMounted.current && onTocLoaded) {
        onTocLoaded(nav.toc);
      }
    });

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
          styleEl.textContent = `
            html, body, body * {
              font-size: ${fs}px !important;
              line-height: ${lh} !important;
              font-family: "${ff}", serif !important;
              color: ${ct.text} !important;
            }
            body {
              background-color: ${ct.bg} !important;
              padding: 60px 20px 60px 20px !important;
              margin: 0 !important;
            }
            img, svg, video {
              max-width: 100% !important;
              height: auto !important;
            }
            ::selection {
              background: ${ct.text}22 !important;
            }
          `;
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
        }
      } catch (e) {}
    });
    observer.observe(viewerRef.current);

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

    // Generate locations for accurate progress percentage
    book.ready.then(() => {
      return book.locations.generate(1600);
    }).then((locations) => {
      // Locations generated, future relocated events will have accurate percentages
    });

    // Re-apply styles after page turns because EPUB content can inject CSS late.
    rendition.on('relocated', (location: any) => {
      if (!isMounted.current) return;
      setOpacity(1);
      
      // Re-apply styles to current content after page turn
      try {
        const contents = rendition.getContents();
        const targets = Array.isArray(contents) ? contents : contents ? [contents] : [];
        const { fontSize: fs, lineHeight: lh, fontFamily: ff, theme: t, currentTheme: ct } = styleRef.current;
        targets.forEach((c: any) => {
          if (c.document) {
            let styleEl = c.document.getElementById('global-reader-style');
            if (!styleEl) {
              styleEl = c.document.createElement('style');
              styleEl.id = 'global-reader-style';
              c.document.head.appendChild(styleEl);
            }
            styleEl.textContent = `
              html, body, body * {
                font-size: ${fs}px !important;
                line-height: ${lh} !important;
                font-family: "${ff}", serif !important;
                color: ${ct.text} !important;
              }
              body {
                background-color: ${ct.bg} !important;
                padding: 60px 20px 60px 20px !important;
                margin: 0 !important;
              }
              img, svg, video {
                max-width: 100% !important;
                height: auto !important;
              }
            `;
          }
        });
      } catch (e) {}
      
      const percentage = book.locations.percentageFromCfi(location.start.cfi);
      onLocationChange(percentage, location.start.cfi);
    });

    return () => {
      isMounted.current = false;
      observer.disconnect();
      book.destroy();
    };
  }, [data]); // Only re-init when the actual book data changes

  // Handle dynamic style updates by re-injecting CSS into current content.
  useEffect(() => {
    if (!renditionRef.current) return;
    
    renditionRef.current.themes.fontSize(`${fontSize}px`);
    renditionRef.current.themes.font(fontFamily);

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
          style.textContent = `
            html, body, body * {
              font-size: ${fontSize}px !important;
              line-height: ${lineHeight} !important;
              font-family: "${fontFamily}", serif !important;
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
          `;
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
          rendition.annotations.highlight(note.cfi, {}, () => {}, undefined, { fill: note.color, "fill-opacity": "0.3" });
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
      style={{ 
        backgroundColor: 'transparent',
        opacity,
        transition: 'opacity 0.2s ease-in-out',
      }} 
    />
  );
});

export default EpubViewer;
