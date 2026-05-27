# 文献库

个人学术文献管理工具，基于 React + TypeScript + Vite 构建，数据存储在 GitHub 仓库，本地缓存使用 IndexedDB。

## 功能

- 文献卡片管理（标题、作者、年份、期刊、语言、标签、阅读状态）
- 原文 PDF / DOCX 上传与预览（支持 Retina 高清渲染 + 文字图层选取）
- 三栏阅读视图：左侧信息 & AI 摘要 / 中间 PDF / 右侧个人笔记
- PDF 缩放工具栏（−/100%/+/适配宽度）
- Claude AI 一键生成中文摘要（需配置 API Key）
- 数据通过 GitHub API 同步，支持多设备
- 全文搜索、多维筛选（语言、状态、标签、年份）
- 支持"仅本地"私密模式（不上传 PDF 到 GitHub）

## 技术栈

- React 19 + TypeScript
- Vite
- pdfjs-dist（PDF 渲染）
- IndexedDB（本地文件缓存）
- GitHub REST API（数据同步）
- Anthropic Claude API（AI 摘要）

## 使用方式

1. 准备一个空的 GitHub 仓库（用于存储文献数据）
2. 生成 GitHub Personal Access Token（需要 `repo` 权限）
3. 克隆本项目，安装依赖：
   ```bash
   npm install
   npm run dev
   ```
4. 打开浏览器，填入 GitHub 用户名、仓库名和 Token 完成初始化
5. 可选：在"AI 设置"里填入 Claude API Key 以启用摘要功能

## 数据存储结构

文献元数据以 JSON 格式存储在配置仓库的 `papers.json`，PDF 文件存储在 `files/` 目录下。
