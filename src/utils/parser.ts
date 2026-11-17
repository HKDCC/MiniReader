import ePub from 'epubjs';
import JSZip from 'jszip';
import { BookMeta, db } from '../db/db';
import { parserCopy } from '../shared/copy';
import { hashContent } from './contentHash';

const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

async function getNextSortOrder() {
  const books = await db.books.orderBy('sortOrder').toArray();
  return books.length === 0 ? 0 : (books[books.length - 1].sortOrder ?? books.length - 1) + 1;
}

export type ImportFileResult =
  | { status: 'imported'; id: string }
  | { status: 'duplicate'; existingBook: BookMeta };

class DuplicateBookError extends Error {
  constructor(public readonly existingBook: BookMeta) {
    super('A book with the same content already exists');
    this.name = 'DuplicateBookError';
  }
}

async function findDuplicateBook(contentHash: string) {
  const indexedBook = await db.books.where('contentHash').equals(contentHash).first();
  if (indexedBook) return indexedBook;

  const legacyBooks = await db.books.filter((book) => !book.contentHash).toArray();
  const hashesToBackfill: Array<{ id: string; contentHash: string }> = [];
  let duplicateBook: BookMeta | undefined;

  for (const book of legacyBooks) {
    const content = await db.contents.get(book.id);
    if (!content) continue;

    const legacyHash = await hashContent(content.data);
    hashesToBackfill.push({ id: book.id, contentHash: legacyHash });
    if (legacyHash === contentHash) {
      duplicateBook = { ...book, contentHash: legacyHash };
    }
  }

  if (hashesToBackfill.length > 0) {
    await db.transaction('rw', db.books, async () => {
      await Promise.all(hashesToBackfill.map(({ id, contentHash: hash }) => db.books.update(id, { contentHash: hash })));
    });
  }

  return duplicateBook;
}

type ImportedBookDetails = Pick<BookMeta, 'title' | 'author' | 'format'> & Pick<BookMeta, 'cover'>;

async function saveImportedBook(
  data: string | ArrayBuffer,
  details: ImportedBookDetails,
  contentHash: string
): Promise<ImportFileResult> {
  const existingBook = await findDuplicateBook(contentHash);
  if (existingBook) {
    return { status: 'duplicate', existingBook };
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  try {
    await db.transaction('rw', db.books, db.contents, async () => {
      const concurrentDuplicate = await db.books.where('contentHash').equals(contentHash).first();
      if (concurrentDuplicate) {
        throw new DuplicateBookError(concurrentDuplicate);
      }

      await db.contents.add({ id, data });
      await db.books.add({
        id,
        ...details,
        contentHash,
        progress: 0,
        addedAt: now,
        lastReadAt: now,
        sortOrder: await getNextSortOrder(),
      });
    });
  } catch (error) {
    if (error instanceof DuplicateBookError) {
      return { status: 'duplicate', existingBook: error.existingBook };
    }
    throw error;
  }

  return { status: 'imported', id };
}

function getTitle(file: File, extension: string) {
  return file.name.replace(new RegExp(`\\.${extension}$`, 'i'), '');
}

async function decodeTextFile(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes).replace(/^\uFEFF/, '');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes).replace(/^\uFEFF/, '');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    // Legacy Windows text files are commonly encoded as GB18030.
    return new TextDecoder('gb18030').decode(bytes).replace(/^\uFEFF/, '');
  }
}

async function detectFileFormat(file: File) {
  const fileName = file.name.trim().toLowerCase();
  const hasKnownExtension = /\.(txt|epub|pdf)$/.test(fileName);
  let isTxt = fileName.endsWith('.txt') || (!hasKnownExtension && file.type === 'text/plain');
  let isEpub =
    fileName.endsWith('.epub') ||
    (!hasKnownExtension && ['application/epub+zip', 'application/zip', 'application/x-zip-compressed'].includes(file.type));
  let isPdf = fileName.endsWith('.pdf') || (!hasKnownExtension && file.type === 'application/pdf');

  if (!isTxt && !isEpub && !isPdf) {
    const buffer = await file.slice(0, 4).arrayBuffer();
    const view = new Uint8Array(buffer);
    if (view[0] === 0x25 && view[1] === 0x50 && view[2] === 0x44 && view[3] === 0x46) {
      isPdf = true;
    } else if (view[0] === 0x50 && view[1] === 0x4b) {
      isEpub = true;
    }
  }

  if (isTxt) return 'txt';
  if (isEpub) return 'epub';
  if (isPdf) return 'pdf';
  return null;
}

function getMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'image/jpeg';
  }
}

function resolveZipPath(baseDir: string, href: string): string | null {
  if (!href) return null;
  href = href.trim().split('#')[0];
  if (href.startsWith('/')) href = href.slice(1);
  const full = (baseDir || '') + href;
  const parts = full.split('/');
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === '.' || !p) continue;
    if (p === '..') resolved.pop();
    else resolved.push(p);
  }
  return resolved.join('/');
}

function findEntryInZip(zip: JSZip, pathStr: string): JSZip.JSZipObject | null {
  if (!pathStr) return null;
  const clean = pathStr.replace(/^\/+/, '');
  const decoded = decodeURIComponent(clean);
  return zip.file(clean) || zip.file(decoded) || zip.file(pathStr);
}

async function extractCoverFromZip(zip: JSZip): Promise<JSZip.JSZipObject | null> {
  const container = zip.file('META-INF/container.xml');
  if (!container) return null;
  const containerXml = await container.async('text');
  const opfMatch = containerXml.match(/full-path="([^"]+)"/i);
  if (!opfMatch) return null;

  const opfPath = opfMatch[1];
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfFile = findEntryInZip(zip, opfPath);
  if (!opfFile) return null;
  const opfText = await opfFile.async('text');

  // Strategy 1: <item ... properties="...cover-image..." ...>
  const propMatch = opfText.match(/<item[^>]*properties=["'][^"']*cover-image[^"']*["'][^>]*>/i);
  if (propMatch) {
    const hrefMatch = propMatch[0].match(/href=["']([^"']+)["']/i);
    if (hrefMatch) {
      const p = resolveZipPath(opfDir, hrefMatch[1]);
      if (p) {
        const entry = findEntryInZip(zip, p);
        if (entry) return entry;
      }
    }
  }

  // Strategy 2: <meta name="cover" content="coverId" /> -> find item by id
  const metaMatch =
    opfText.match(/<meta[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i) ||
    opfText.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']cover["']/i);
  if (metaMatch) {
    const coverId = metaMatch[1];
    const itemMatch =
      opfText.match(new RegExp('<item[^>]*id=["\']' + coverId + '["\'][^>]*>', 'i')) ||
      opfText.match(new RegExp('<item[^>]*href=["\'][^"\']+["\'][^>]*id=["\']' + coverId + '["\']', 'i'));
    if (itemMatch) {
      const hrefMatch = itemMatch[0].match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        const p = resolveZipPath(opfDir, hrefMatch[1]);
        if (p) {
          const entry = findEntryInZip(zip, p);
          if (entry) return entry;
        }
      }
    }
  }

  // Strategy 3: <item ... id="...cover..." ... media-type="image/..."> or href="...cover..."
  const itemTags = opfText.match(/<item[^>]+>/gi) || [];
  for (const tag of itemTags) {
    const isImage = /media-type=["']image\//i.test(tag);
    const hasCoverIdOrHref = /id=["'][^"']*cover[^"']*["']/i.test(tag) || /href=["'][^"']*cover[^"']*["']/i.test(tag);
    if (isImage && hasCoverIdOrHref) {
      const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        const p = resolveZipPath(opfDir, hrefMatch[1]);
        if (p) {
          const entry = findEntryInZip(zip, p);
          if (entry) return entry;
        }
      }
    }
  }

  // Strategy 4: guide <reference type="cover" href="...">
  const guideMatch = opfText.match(/<reference[^>]*type=["']cover["'][^>]*href=["']([^"']+)["']/i);
  if (guideMatch) {
    const refHref = resolveZipPath(opfDir, guideMatch[1]);
    if (refHref) {
      if (/\.(jpe?g|png|webp|gif|svg)$/i.test(refHref)) {
        const entry = findEntryInZip(zip, refHref);
        if (entry) return entry;
      }
      const htmlFile = findEntryInZip(zip, refHref);
      if (htmlFile) {
        const htmlText = await htmlFile.async('text');
        const imgMatch = htmlText.match(/<img[^>]*src=["']([^"']+)["']/i) || htmlText.match(/<image[^>]*href=["']([^"']+)["']/i);
        if (imgMatch) {
          const htmlDir = refHref.includes('/') ? refHref.slice(0, refHref.lastIndexOf('/') + 1) : '';
          const p = resolveZipPath(htmlDir, imgMatch[1]);
          if (p) {
            const entry = findEntryInZip(zip, p);
            if (entry) return entry;
          }
        }
      }
    }
  }

  // Strategy 5: first spine item page if it contains an image
  const firstSpine = opfText.match(/<itemref[^>]+idref=["']([^"']+)["']/i);
  if (firstSpine) {
    const idref = firstSpine[1];
    const itemMatch = opfText.match(new RegExp('<item[^>]*id=["\']' + idref + '["\'][^>]*>', 'i'));
    if (itemMatch) {
      const hrefMatch = itemMatch[0].match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        const pageHref = resolveZipPath(opfDir, hrefMatch[1]);
        if (pageHref) {
          const pageFile = findEntryInZip(zip, pageHref);
          if (pageFile) {
            const pageText = await pageFile.async('text');
            const imgMatch = pageText.match(/<img[^>]*src=["']([^"']+)["']/i) || pageText.match(/<image[^>]*href=["']([^"']+)["']/i);
            if (imgMatch) {
              const pageDir = pageHref.includes('/') ? pageHref.slice(0, pageHref.lastIndexOf('/') + 1) : '';
              const p = resolveZipPath(pageDir, imgMatch[1]);
              if (p) {
                const entry = findEntryInZip(zip, p);
                if (entry) return entry;
              }
            }
          }
        }
      }
    }
  }

  // Strategy 6: any image in zip matching cover
  for (const f of Object.keys(zip.files)) {
    if (/\.(jpe?g|png|webp|gif|svg)$/i.test(f) && /cover/i.test(f)) {
      const entry = zip.file(f);
      if (entry) return entry;
    }
  }

  return null;
}

export async function extractEpubCoverFromBuffer(arrayBuffer: ArrayBuffer): Promise<string | undefined> {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const entry = await extractCoverFromZip(zip);
    if (!entry) return undefined;

    const base64 = await entry.async('base64');
    const mime = getMimeType(entry.name);
    return `data:${mime};base64,${base64}`;
  } catch (error) {
    console.warn('Failed to extract cover from EPUB buffer', error);
    return undefined;
  }
}

async function extractEpubCover(book: any, arrayBuffer?: ArrayBuffer): Promise<string | undefined> {
  if (arrayBuffer) {
    const fromBuffer = await extractEpubCoverFromBuffer(arrayBuffer);
    if (fromBuffer) return fromBuffer;
  }

  try {
    const coverPath = await book.loaded.cover;
    if (coverPath && book.archive?.zip) {
      const entry = findEntryInZip(book.archive.zip, coverPath);
      if (entry) {
        const base64 = await entry.async('base64');
        const mime = getMimeType(entry.name);
        return `data:${mime};base64,${base64}`;
      }
    }
  } catch (error) {
    console.warn('Failed to extract cover from epubjs book instance', error);
  }

  return undefined;
}

const attemptedCoverRepairs = new Set<string>();
let coverRepairQueue = Promise.resolve();

export function repairMissingBookCovers(books: BookMeta[]) {
  for (const book of books) {
    if (book.format === 'txt' || (book.cover && !book.cover.startsWith('blob:')) || attemptedCoverRepairs.has(book.id)) {
      continue;
    }
    attemptedCoverRepairs.add(book.id);
    coverRepairQueue = coverRepairQueue.then(async () => {
      try {
        const content = await db.contents.get(book.id);
        if (!(content?.data instanceof ArrayBuffer)) return;

        let cover: string | undefined;
        if (book.format === 'epub') {
          cover = await extractEpubCoverFromBuffer(content.data);
        } else if (book.format === 'pdf') {
          cover = await extractPdfCover(content.data);
        }
        if (!cover) return;

        await db.transaction('rw', db.books, async () => {
          const current = await db.books.get(book.id);
          if (current && (!current.cover || current.cover.startsWith('blob:'))) {
            await db.books.update(book.id, { cover });
          }
        });
      } catch (error) {
        console.warn(`Failed to repair cover for book ${book.id} (${book.title})`, error);
      }
    });
  }
  return coverRepairQueue;
}

async function extractPdfCover(arrayBuffer: ArrayBuffer) {
  let pdf: any;
  try {
    const [{ pdfjs }, { default: pdfWorkerUrl }] = await Promise.all([
      import('react-pdf'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    pdf = await pdfjs.getDocument({ data: arrayBuffer.slice(0), isEvalSupported: false, enableScripting: false } as any).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context, viewport } as any).promise;
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (error) {
    console.warn('Failed to extract cover from PDF', error);
    return undefined;
  } finally {
    await pdf?.destroy().catch(() => undefined);
  }
}

export const importFile = async (file: File): Promise<ImportFileResult> => {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`文件超过 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB 限制`);
  }
  const format = await detectFileFormat(file);

  if (format === 'txt') {
    const text = await decodeTextFile(file);
    const contentHash = await hashContent(text);
    return saveImportedBook(text, {
      title: getTitle(file, 'txt'),
      author: parserCopy.unknownAuthor,
      format: 'txt',
    }, contentHash);
  }

  if (format === 'epub') {
    const arrayBuffer = await file.arrayBuffer();
    const contentHash = await hashContent(arrayBuffer);
    const existingBook = await findDuplicateBook(contentHash);
    if (existingBook) {
      return { status: 'duplicate', existingBook };
    }

    const book = ePub(arrayBuffer.slice(0));
    try {
      const metadata = await book.loaded.metadata;
      const cover = await extractEpubCover(book, arrayBuffer);

      return saveImportedBook(arrayBuffer, {
        title: metadata.title || getTitle(file, 'epub'),
        author: metadata.creator || parserCopy.unknownAuthor,
        cover,
        format: 'epub',
      }, contentHash);
    } finally {
      book.destroy();
    }
  }

  if (format === 'pdf') {
    const arrayBuffer = await file.arrayBuffer();
    const contentHash = await hashContent(arrayBuffer);
    const existingBook = await findDuplicateBook(contentHash);
    if (existingBook) {
      return { status: 'duplicate', existingBook };
    }
    const cover = await extractPdfCover(arrayBuffer);

    return saveImportedBook(arrayBuffer, {
      title: getTitle(file, 'pdf'),
      author: parserCopy.unknownAuthor,
      cover,
      format: 'pdf',
    }, contentHash);
  }

  throw new Error(`${parserCopy.unsupportedFormat} ${file.name} (${file.type || 'unknown'})`);
};
