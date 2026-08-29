export const appCopy = {
  appName: 'Mini Reader',
  version: '1.0.0',
  minimize: '\u6700\u5C0F\u5316',
  maximize: '\u6700\u5927\u5316',
  restore: '\u8FD8\u539F',
  close: '\u5173\u95ED',
} as const;

export const shelfCopy = {
  title: '\u4E66\u67B6',
  subtitle: '\u62D6\u52A8\u4E66\u7C4D\u5373\u53EF\u8C03\u6574\u987A\u5E8F',
  search: '\u641C\u7D22',
  importBooks: '\u5BFC\u5165\u4E66\u7C4D',
  exportBackup: '\u5BFC\u51FA\u5907\u4EFD',
  importBackup: '\u5BFC\u5165\u5907\u4EFD',
  emptyTitle: '\u4E66\u67B6\u8FD8\u662F\u7A7A\u7684',
  emptyDescription: '\u70B9\u51FB\u53F3\u4E0A\u89D2\u6216\u62D6\u5165\u6587\u4EF6\u5BFC\u5165\u4E66\u7C4D',
  importOverlayTitle: '\u677E\u5F00\u9F20\u6807\uFF0C\u5BFC\u5165\u4E66\u7C4D',
  importOverlayDescription: '\u652F\u6301 TXT / EPUB / PDF \u683C\u5F0F',
  importing: '\u6B63\u5728\u89E3\u6790\u4E66\u7C4D...',
  importSuccess: '\u5BFC\u5165\u6210\u529F',
  importSummary: (imported: number, skipped: number) => `成功导入 ${imported} 本，跳过 ${skipped} 本重复版本`,
  importAllDuplicates: '所选书籍版本均已存在，未导入',
  duplicateLocated: '\u4E66\u7C4D\u5DF2\u5B58\u5728\uFF0C\u5DF2\u5B9A\u4F4D\u5230\u4E66\u67B6\u4E2D\u7684\u539F\u4E66',
  importFailure: '\u5BFC\u5165\u5931\u8D25',
  backupExportSuccess: '\u5907\u4EFD\u5DF2\u5BFC\u51FA',
  backupImportSuccess: '\u5907\u4EFD\u5DF2\u5BFC\u5165',
  backupImportConfirm: '\u5BFC\u5165\u5907\u4EFD\u4F1A\u66FF\u6362\u5F53\u524D\u4E66\u67B6\u3001\u5185\u5BB9\u548C\u7B14\u8BB0\u3002\u8981\u7EE7\u7EED\u5417\uFF1F',
  deleteBook: '\u5220\u9664\u4E66\u7C4D',
} as const;

export const readerCopy = {
  back: '\u8FD4\u56DE\u4E66\u67B6',
  toc: '\u76EE\u5F55',
  notes: '\u7B14\u8BB0',
  settings: '\u8BBE\u7F6E',
  fullscreen: '\u5168\u5C4F',
  loading: '\u6B63\u5728\u52A0\u8F7D\u5185\u5BB9...',
  moveHint: '\u79FB\u52A8\u5230\u5DE6\u4FA7\u53EF\u5C55\u5F00\u529F\u80FD',
  keyboardHint: 'M \u8BBE\u7F6E / F \u5168\u5C4F / \u5DE6\u53F3\u65B9\u5411\u952E\u7FFB\u9875',
  notePlaceholder: '\u5199\u4E0B\u4F60\u7684\u60F3\u6CD5...',
  cancel: '\u53D6\u6D88',
  save: '\u4FDD\u5B58',
  yellow: '\u67E0\u6AAC\u9EC4',
  green: '\u8584\u8377\u7EFF',
  red: '\u73CA\u745A\u7C89',
  addNote: '+ \u6DFB\u52A0\u7B14\u8BB0',
} as const;

export const notesCopy = {
  title: '\u7B14\u8BB0',
  export: '\u5BFC\u51FA\u7B14\u8BB0',
  close: '\u5173\u95ED\u7B14\u8BB0',
  search: '\u641C\u7D22\u6807\u6CE8\u4E0E\u7B14\u8BB0...',
  empty: '\u6682\u65E0\u7B14\u8BB0\u4E0E\u6807\u6CE8',
  noteLabel: '\u7B14\u8BB0',
  delete: '\u5220\u9664\u6807\u6CE8',
  exportTitle: '\u9605\u8BFB\u7B14\u8BB0',
  exportSuccess: '\u5BFC\u51FA\u6210\u529F',
  exportFailed: '\u5BFC\u51FA\u5931\u8D25',
  unknownError: '\u672A\u77E5\u9519\u8BEF',
} as const;

export const globalNotesCopy = {
  title: '\u641C\u7D22',
  search: '\u641C\u7D22\u4E66\u7C4D\u3001\u7B14\u8BB0\u7B49',
  empty: '\u6682\u65E0\u4E66\u7C4D\u6216\u7B14\u8BB0',
  noResult: '\u6CA1\u6709\u627E\u5230\u5339\u914D\u7684\u4E66\u7C4D\u6216\u7B14\u8BB0',
  books: '\u4E66\u7C4D',
  notes: '\u7B14\u8BB0',
  bookCount: (count: number) => `${count} \u672C`,
  noteCount: (count: number) => `${count} \u6761`,
  openBook: '\u6253\u5F00\u4E66\u7C4D',
  unknownBook: '\u672A\u77E5\u4E66\u7C4D',
  addNote: '\u6DFB\u52A0\u7B14\u8BB0',
  save: '\u4FDD\u5B58',
  cancel: '\u53D6\u6D88',
  edit: '\u7F16\u8F91',
  delete: '\u5220\u9664',
  noteLabel: '\u7B14\u8BB0',
} as const;

export const settingsCopy = {
  title: '\u9605\u8BFB\u8BBE\u7F6E',
  theme: '\u4E3B\u9898',
  font: '\u5B57\u4F53',
  add: '+ \u6DFB\u52A0',
  cancel: '\u53D6\u6D88',
  addFont: '\u6DFB\u52A0\u5B57\u4F53',
  fontNamePlaceholder: '\u5B57\u4F53\u540D\u79F0\uFF08\u4F8B\u5982 Source Han Serif SC\uFF09',
  fontUrlPlaceholder: '@font-face URL\uFF08\u53EF\u9009\uFF09',
  deleteFont: '\u5220\u9664\u5B57\u4F53',
  layout: '\u6392\u7248\u6A21\u5F0F',
  singlePage: '\u5355\u9875',
  doublePage: '\u53CC\u9875',
  fontSize: '\u5B57\u53F7',
  lineHeight: '\u884C\u95F4\u8DDD',
  pageWidth: '\u9605\u8BFB\u5BBD\u5EA6',
  ocrRemoved: '\u5DF2\u79FB\u9664 OCR \u4E0E\u89C6\u89C9\u5927\u6A21\u578B\u4E0B\u8F7D\u529F\u80FD',
} as const;

export const tocCopy = {
  title: '\u76EE\u5F55',
  close: '\u5173\u95ED\u76EE\u5F55',
  empty: '\u6682\u65E0\u76EE\u5F55\u6570\u636E',
} as const;

export const parserCopy = {
  unknownAuthor: '\u672A\u77E5\u4F5C\u8005',
  unsupportedFormat: '\u4E0D\u652F\u6301\u7684\u6587\u4EF6\u683C\u5F0F\uFF0C\u8BF7\u5BFC\u5165 TXT\u3001EPUB \u6216 PDF \u6587\u4EF6\u3002',
} as const;

export const electronCopy = {
  exportPdfDialogTitle: '\u5BFC\u51FA\u7B14\u8BB0 PDF',
  exportTitle: '\u9605\u8BFB\u7B14\u8BB0',
  exportMetaPrefix: '\u5171 ',
  exportMetaSuffix: ' \u6761\u7B14\u8BB0',
} as const;
