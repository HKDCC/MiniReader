import Dexie, { Table } from 'dexie';

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  cover?: string;
  format: 'txt' | 'epub' | 'pdf';
  contentHash?: string;
  progress: number;
  cfi?: string;
  addedAt: number;
  lastReadAt: number;
  sortOrder: number;
}

export interface BookContent {
  id: string;
  data: string | ArrayBuffer;
}

export interface Note {
  id?: number;
  bookId: string;
  text: string;
  note: string;
  color: string;
  cfi: string;
  createdAt: number;
}

class MiniReaderDB extends Dexie {
  books!: Table<BookMeta, string>;
  contents!: Table<BookContent, string>;
  notes!: Table<Note, number>;

  constructor() {
    super('MiniReaderDB');

    this.version(1).stores({
      books: 'id, title, author, addedAt, lastReadAt',
      contents: 'id',
      notes: '++id, bookId, createdAt',
    });

    this.version(2)
      .stores({
        books: 'id, title, author, addedAt, lastReadAt, sortOrder',
        contents: 'id',
        notes: '++id, bookId, createdAt',
      })
      .upgrade(async (tx) => {
        let index = 0;
        await tx
          .table('books')
          .toCollection()
          .modify((book: any) => {
            if (typeof book.sortOrder !== 'number') {
              book.sortOrder = index++;
            }
          });
      });

    this.version(3).stores({
      books: 'id, title, author, addedAt, lastReadAt, sortOrder, contentHash',
      contents: 'id',
      notes: '++id, bookId, createdAt',
    });
  }
}

export const db = new MiniReaderDB();

db.on('populate', async () => {
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.books.add({
    id,
    title: '\u6B22\u8FCE\u4F7F\u7528 Mini Reader',
    author: 'Mini Reader Team',
    format: 'txt',
    progress: 0,
    addedAt: now,
    lastReadAt: now,
    sortOrder: 0,
  });

  await db.contents.add({
    id,
    data:
      '\u6B22\u8FCE\u6765\u5230 Mini Reader\u3002\n\n\u8FD9\u662F\u4E00\u4E2A\u4E13\u6CE8\u4E8E\u672C\u5730\u6C89\u6D78\u5F0F\u9605\u8BFB\u4F53\u9A8C\u7684\u9605\u8BFB\u5668\u3002\n\n\u4F60\u53EF\u4EE5\u70B9\u51FB\u53F3\u4E0A\u89D2\u7684\u201C\u5BFC\u5165\u4E66\u7C4D\u201D\u6309\u94AE\uFF0C\u6216\u8005\u76F4\u63A5\u628A TXT\u3001EPUB\u3001PDF \u6587\u4EF6\u62D6\u8FDB\u7A97\u53E3\u91CC\u3002\n\n\u795D\u4F60\u9605\u8BFB\u6109\u5FEB\u3002',
  });
});
