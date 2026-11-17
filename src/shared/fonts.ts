const BUILT_IN_FONT_STACKS: Record<string, string> = {
  'LXGW WenKai': '"LXGW WenKai", "KaiTi", "STKaiti", serif',
  'Source Han Serif SC': '"Source Han Serif SC", "Noto Serif SC", "SimSun", "Songti SC", serif',
  'Microsoft YaHei': '"Microsoft YaHei", "Microsoft Yahei UI", sans-serif',
  'Segoe UI': '"Segoe UI", Arial, sans-serif',
};

export function getReaderFontStack(fontFamily: string) {
  return BUILT_IN_FONT_STACKS[fontFamily] ?? `${JSON.stringify(fontFamily)}, serif`;
}

export const lxgwFontFaceCss = (baseUrl: string) => {
  const fontUrl = new URL('fonts/LXGWWenKai-Regular.ttf', baseUrl).href;
  return `@font-face { font-family: "LXGW WenKai"; src: url(${JSON.stringify(fontUrl)}) format("truetype"); font-style: normal; font-weight: 400; font-display: swap; }`;
};
