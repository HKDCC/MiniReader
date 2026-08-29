# Mini Reader 📖

> 一款极简、专注的本地优先桌面阅读器，专为 TXT、EPUB 与 PDF 沉浸式阅读体验打造。

[![React 19](https://img.shields.io/badge/React-19.0-blue.svg)](https://react.dev/)
[![Electron](https://img.shields.io/badge/Electron-41.1-47848F.svg)](https://www.electronjs.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC.svg)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## ✨ 核心特性

- 📚 **多格式支持**：原生支持 TXT、EPUB、PDF 本地文件拖拽解析与流畅排版。
- 🔒 **本地优先（Local-First）**：基于 IndexedDB（Dexie.js）存储书库、阅读进度与划线高亮，数据完全归属本地，零隐私泄露风险。
- 🎨 **多套护眼主题**：提供温暖羊皮纸、柔和护眼绿、经典米白、深灰暗黑及纯黑夜间等 5 套专属阅读配色。
- 📝 **深度笔记与目录**：支持章节目录跳转、金句划线、随手批注，并支持一键导出为 Markdown / DOCX / PDF / HTML 格式。
- ⚡ **极致轻量**：基于 Vite 6 + TailwindCSS v4 构建，极速秒开，内存占用低。

---

## 🛠️ 技术栈

- **Core Framework**: React 19 + TypeScript
- **Runtime**: Electron 41
- **Bundler & Tooling**: Vite 6 + @tailwindcss/vite
- **Storage**: IndexedDB (Dexie 4)
- **Document Engines**: epubjs, pdfjs-dist, react-pdf, docx
- **Animations & Icons**: Motion, Lucide React

---

## 🚀 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 启动网页开发预览
npm run dev

# 3. 启动 Electron 桌面端调试
npm run electron:dev
```

---

## 📦 打包构建

```bash
# 构建 Windows 桌面安装包
npm run electron:dist
```

打包产物将自动生成于 `release/` 目录。

---

## 📄 开源许可

本项目基于 [MIT License](LICENSE) 开放源代码。
