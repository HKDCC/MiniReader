import React, { useState, useEffect, useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Theme } from '../App';
import { Note } from '../db/db';
import type { ReaderLocationChange, ReaderPageInfo, TextSelectionInfo } from './readerTypes';
import { extractSentence } from '../shared/spanText';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// A new options object causes react-pdf to destroy and reload the document.
const PDF_OPTIONS = { isEvalSupported: false, enableScripting: false };

const TEXT = {
  parsing: '\u6B63\u5728\u89E3\u6790 PDF...',
  rendering: '\u6B63\u5728\u6E32\u67D3\u9875\u9762...',
};

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const safeNoteColor = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#3b82f6');

interface PdfViewerRef {
  next: () => void;
  prev: () => void;
  goTo: (href: string) => void;
  seekToProgress: (progress: number) => void;
  search: (query: string, direction?: number) => boolean | Promise<boolean>;
  clearSelection: () => void;
}

type PdfTocItem = {
  label: string;
  href: string | null;
  subitems: PdfTocItem[];
};

interface PdfViewerProps {
  data: ArrayBuffer;
  theme: Theme;
  currentTheme: any;
  fontSize: number;
  lineHeight: number;
  isTwoPage?: boolean;
  initialCfi?: string;
  notes: Note[];
  intensiveMode?: boolean;
  onLocationChange: ReaderLocationChange;
  onTextSelected: (selection: TextSelectionInfo | null) => void;
  onKeyPress?: (key: string) => void;
  onReady: () => void;
  onError?: (error: unknown) => void;
  onTocLoaded?: (toc: any[]) => void;
}

const PdfViewer = forwardRef<PdfViewerRef, PdfViewerProps>(
  ({ data, theme, currentTheme, isTwoPage = false, initialCfi, notes, intensiveMode = false, onLocationChange, onTextSelected, onReady, onError, onTocLoaded }, ref) => {
    // PDF.js transfers the buffer to its worker. Keep the reader's source intact.
    const file = useMemo(() => data.slice(0), [data]);
    const [numPages, setNumPages] = useState(0);
    const [pageNumber, setPageNumber] = useState(() => {
      if (initialCfi && initialCfi.startsWith('pdf-page-')) {
        return parseInt(initialCfi.split('-')[2], 10) || 1;
      }
      return 1;
    });
    const [pageRatio, setPageRatio] = useState(0.7);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const pdfDocumentRef = useRef<any>(null);
    const lastSearchRef = useRef<{ query: string; page: number } | null>(null);

    const resizeTimer = useRef<any>(null);
    useEffect(() => {
      if (!containerRef.current) return;

      const observer = new ResizeObserver((entries) => {
        if (resizeTimer.current) clearTimeout(resizeTimer.current);
        resizeTimer.current = setTimeout(() => {
          for (const entry of entries) {
            const width = Math.round(entry.contentRect.width);
            const height = Math.round(entry.contentRect.height);
            setContainerSize((previous) => {
              if (previous.width === width && previous.height === height) {
                return previous;
              }
              return { width, height };
            });
          }
        }, 100);
      });

      observer.observe(containerRef.current);
      return () => {
        observer.disconnect();
        if (resizeTimer.current) clearTimeout(resizeTimer.current);
        pdfDocumentRef.current = null;
      };
    }, []);

    const actualTwoPage = isTwoPage && containerSize.width > 600;
    const step = actualTwoPage ? 2 : 1;

    const lastPageInView = actualTwoPage && numPages > 1 && numPages % 2 === 0 ? numPages - 1 : numPages;

    useEffect(() => {
      if (numPages > 0) {
        const progress = lastPageInView <= 1 ? 0 : Math.min(1, Math.max(0, (pageNumber - 1) / (lastPageInView - 1)));
        const pageInfo: ReaderPageInfo = { current: pageNumber, total: numPages };
        onLocationChange(progress, `pdf-page-${pageNumber}`, pageInfo);
      }
    }, [lastPageInView, numPages, onLocationChange, pageNumber]);

    useImperativeHandle(ref, () => ({
      next: () => setPageNumber((previous) => Math.min(previous + step, numPages)),
      prev: () => setPageNumber((previous) => Math.max(previous - step, 1)),
      goTo: (href: string) => {
        const page = parseInt(href.replace(/^pdf-page-/, ''), 10);
        if (!Number.isNaN(page)) {
          setPageNumber(Math.min(Math.max(page, 1), numPages));
        }
      },
      seekToProgress: (progress: number) => {
        if (numPages <= 0) return;
        const normalized = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
        const targetPage = Math.round(normalized * Math.max(0, lastPageInView - 1)) + 1;
        setPageNumber(Math.min(Math.max(targetPage, 1), numPages));
      },
      search: async (query: string, direction = 1) => {
        const needle = query.trim();
        if (!needle) return false;
        const pdf = pdfDocumentRef.current;
        if (!pdf) return Boolean((window as any).find?.(needle, false, direction < 0, true));

        const repeated = lastSearchRef.current?.query === needle.toLocaleLowerCase();
        const startPage = repeated ? pageNumber + direction : pageNumber;
        const pageOrder = Array.from({ length: pdf.numPages }, (_, index) => ((startPage - 1 + index * direction) % pdf.numPages + pdf.numPages) % pdf.numPages + 1);
        for (const candidate of pageOrder) {
          const page = await pdf.getPage(candidate);
          const content = await page.getTextContent();
          const text = content.items.map((item: any) => item.str || '').join(' ');
          if (text.toLocaleLowerCase().includes(needle.toLocaleLowerCase())) {
            setPageNumber(candidate);
            lastSearchRef.current = { query: needle.toLocaleLowerCase(), page: candidate };
            return true;
          }
          page.cleanup?.();
        }
        return false;
      },
      clearSelection: () => {
        window.getSelection()?.removeAllRanges();
        onTextSelected(null);
      },
    }));

    const onDocumentLoadSuccess = async (pdf: any) => {
      pdfDocumentRef.current = pdf;
      setNumPages(pdf.numPages);
      setPageNumber((previous) => Math.min(Math.max(1, previous), pdf.numPages));
      onReady();

      if (!onTocLoaded) return;

      try {
        const outline = await pdf.getOutline();
        if (!outline) return;

        const resolveDestPage = async (dest: any): Promise<string | null> => {
          const destination = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
          if (!Array.isArray(destination) || destination.length === 0) {
            return null;
          }

          const pageRef = destination[0];
          if (typeof pageRef === 'number') {
            return String(Math.min(Math.max(pageRef + 1, 1), pdf.numPages));
          }

          if (pageRef) {
            const pageIndex = await pdf.getPageIndex(pageRef);
            return String(pageIndex + 1);
          }

          return null;
        };

        const formatToc = async (items: any[]): Promise<PdfTocItem[]> =>
          Promise.all(
            items.map(async (item) => ({
              label: item.title,
              href: item.dest ? await resolveDestPage(item.dest) : null,
              subitems: item.items ? await formatToc(item.items) : [],
            }))
          );

        onTocLoaded(await formatToc(outline));
      } catch (error) {
        console.warn('Failed to load PDF outline', error);
      }
    };

    const onPageLoadSuccess = (page: any) => {
      if (page.originalWidth && page.originalHeight) {
        setPageRatio(page.originalWidth / page.originalHeight);
      }
    };

    const renderPageText = (page: number, str: string) => {
      const pageNotes = notes.filter((note) => note.cfi.startsWith(`pdf-page-${page}-`) && note.text.trim());
      if (pageNotes.length === 0) return escapeHtml(str);

      let rendered = escapeHtml(str);
      pageNotes.forEach((note) => {
        const text = escapeHtml(note.text.trim());
        if (!text) return;
        rendered = rendered.split(text).join(`<mark style="background:${safeNoteColor(note.color)}3D;color:inherit;border-radius:2px">${text}</mark>`);
      });
      return rendered;
    };

    const wheelTimeout = useRef<any>(null);
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handleWheel = (event: WheelEvent) => {
        event.preventDefault();
        if (wheelTimeout.current) return;

        if (event.deltaY > 0) {
          setPageNumber((previous) => Math.min(previous + step, numPages));
        } else if (event.deltaY < 0) {
          setPageNumber((previous) => Math.max(previous - step, 1));
        }

        wheelTimeout.current = setTimeout(() => {
          wheelTimeout.current = null;
        }, 200);
      };

      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }, [numPages, step]);

    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        onTextSelected(null);
        return;
      }

      const range = selection.getRangeAt(0);
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

      // PDF 文本层是逐 text item 的 span，没有段落概念。
      // 退而求其次：用整页文本层 + Range 前缀定位，再按句末标点扩句；
      // 若文本层没带空格（部分 PDF 会这样），宁可留空也不给模型噪声。
      let context: string | undefined;
      try {
        const startNode = range.startContainer;
        if (startNode.nodeType === Node.TEXT_NODE) {
          const startEl = (startNode as Text).parentElement;
          const layer = (startEl?.closest('.react-pdf__Page__textContent') ?? startEl) as HTMLElement | null;
          const layerText = layer?.textContent || '';
          if (layer && layerText.length > 20 && /\s/.test(layerText.slice(0, 200))) {
            const prefix = document.createRange();
            prefix.selectNodeContents(layer);
            prefix.setEnd(startNode, range.startOffset);
            const blockStart = prefix.toString().length;
            context = extractSentence(layerText, blockStart, blockStart + 1, 200);
          }
        }
      } catch {
        context = undefined;
      }

      onTextSelected({
        cfiRange: `pdf-page-${pageNumber}-${range.startOffset}-${range.endOffset}`,
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
    };

    const isDarkMode = theme === 'dark' || theme === 'night';
    const pdfBackgroundStyle = isDarkMode ? { backgroundColor: theme === 'night' ? '#000000' : currentTheme.bg } : {};

    const availableWidth = containerSize.width - (actualTwoPage ? 60 : 40);
    const availableHeight = containerSize.height - 40;
    const targetWidth = actualTwoPage ? availableWidth / 2 : availableWidth;
    const widthIfFitHeight = availableHeight * pageRatio;
    const fitByWidth = widthIfFitHeight > targetWidth;

    return (
      <div
        ref={containerRef}
        className="pdf-reader w-full h-full flex justify-center items-center overflow-hidden relative"
        onMouseUp={handleMouseUp}
        style={pdfBackgroundStyle}
      >
        <Document
          file={file}
          options={PDF_OPTIONS}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(error) => onError?.(error)}
          onSourceError={(error) => onError?.(error)}
          loading={<div className="opacity-50 font-serif animate-pulse">{TEXT.parsing}</div>}
          className="flex justify-center items-center w-full h-full"
        >
          {containerSize.height > 0 && (
            <div className="flex flex-row gap-4 justify-center items-center h-full w-full">
              <Page
                pageNumber={pageNumber}
                width={fitByWidth ? targetWidth : undefined}
                height={fitByWidth ? undefined : availableHeight}
                onLoadSuccess={onPageLoadSuccess}
                onLoadError={(error) => onError?.(error)}
                onRenderError={(error) => onError?.(error)}
                renderAnnotationLayer={false}
                renderTextLayer
                customTextRenderer={({ str }: { str: string }) => renderPageText(pageNumber, str)}
                loading={<div className="opacity-50 font-serif animate-pulse">{TEXT.rendering}</div>}
                className="shadow-md"
              />
              {actualTwoPage && pageNumber + 1 <= numPages && (
                <Page
                  pageNumber={pageNumber + 1}
                  onLoadError={(error) => onError?.(error)}
                  onRenderError={(error) => onError?.(error)}
                  width={fitByWidth ? targetWidth : undefined}
                  height={fitByWidth ? undefined : availableHeight}
                  renderAnnotationLayer={false}
                  renderTextLayer
                  customTextRenderer={({ str }: { str: string }) => renderPageText(pageNumber + 1, str)}
                  loading={<div className="opacity-50 font-serif animate-pulse">{TEXT.rendering}</div>}
                  className="shadow-md"
                />
              )}
            </div>
          )}
        </Document>
      </div>
    );
  }
);

export default PdfViewer;
