export interface ReaderPageInfo {
  current: number;
  total: number;
}

export type ReaderLocationChange = (percentage: number, cfi: string, pageInfo?: ReaderPageInfo) => void;

export interface TextSelectionInfo {
  cfiRange: string;
  text: string;
  /** 选区所在的整句，供 AI 做语境消歧；拿不到时为 undefined */
  context?: string;
  x: number;
  y: number;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  width?: number;
  height?: number;
}
