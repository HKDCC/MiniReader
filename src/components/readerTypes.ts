export interface ReaderPageInfo {
  current: number;
  total: number;
}

export type ReaderLocationChange = (percentage: number, cfi: string, pageInfo?: ReaderPageInfo) => void;
