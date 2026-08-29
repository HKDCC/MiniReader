import ePub from 'epubjs';
import { pdfjs } from 'react-pdf';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { BookMeta, db } from '../db/db';
import { parserCopy } from '../shared/copy';
import { hashContent } from './contentHash';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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

async function detectFileFormat(file: File) {
  const fileName = file.name.trim().toLowerCase();
  let isTxt = fileName.endsWith('.txt') || file.type === 'text/plain';
  let isEpub =
    fileName.endsWith('.epub') ||
    file.type === 'application/epub+zip' ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed';
  let isPdf = fileName.endsWith('.pdf') || file.type === 'application/pdf';

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

async function extractEpubCover(book: any) {
  try {
    const coverUrl = await book.coverUrl();
    if (!coverUrl) return undefined;

    const response = await fetch(coverUrl);
    const blob = await response.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn('Failed to extract cover from EPUB', error);
    return undefined;
  }
}

async function extractPdfCover(arrayBuffer: ArrayBuffer) {
  try {
    const pdf = await pdfjs.getDocument({ data: arrayBuffer.slice(0) }).promise;
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
  }
}

export const importFile = async (file: File): Promise<ImportFileResult> => {
  const format = await detectFileFormat(file);

  if (format === 'txt') {
    const text = await file.text();
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
      const cover = await extractEpubCover(book);

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
