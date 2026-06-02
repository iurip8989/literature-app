# 开发笔记 · 文献库（literature-app）

> 给未来的我 / 未来的 Claude：下次继续开发前先读这个文件，能快速进入状态。
> 记录的是**为什么这么做**和**踩过的坑**，代码结构本身看源码即可。

## 1. 项目架构概览

**定位**：纯前端单页应用，无后端服务器。GitHub 仓库当数据库，浏览器 IndexedDB 当本地缓存，Anthropic Claude API 做 AI 摘要。

**技术栈**
- React 19 + TypeScript
- Vite 8（构建 / dev server）
- pdfjs-dist 5.7.284（PDF 渲染）
- mammoth（DOCX 预览）
- Dexie（IndexedDB 封装）
- @octokit/rest（GitHub REST API）
- @anthropic-ai/sdk（Claude API）

**两个仓库要分清**
- `literature-app`：**代码仓库**（本仓库），部署到 GitHub Pages。
- `literature-db`：**数据仓库**（用户自己建的另一个私有仓库），存文献元数据和 PDF 文件。App 通过用户填的 GitHub 用户名 / 仓库名 / PAT 连接它。

**状态管理**
- `src/store/AppContext.tsx`：全局状态（papers、tags、filters、sort、同步状态），用 `useReducer` + Context。
- 同步引擎也在这里：编辑后 debounce 3s 推送 `metadata.json`（`scheduleSync`）；add/delete 立即推送（`flushSync`，否则快速刷新会丢操作）。

**部署**：GitHub Pages，`base: '/literature-app/'`，gh-pages 分支。详见第 4 节。

## 2. 数据仓库 literature-db 结构

由 `src/utils/github.ts` 的 `initializeRepo()` 幂等初始化：

```
literature-db/
├── metadata.json        # 所有文献元数据 + 标签
├── papers/              # 原文文件（PDF/DOCX/...）
│   └── {paperId}-{fileId}.{ext}
├── translations/        # 中文译本文件
│   └── {paperId}-{fileId}.{ext}
└── README.md
```

**文件路径**由 `githubFilePath(type, paperId, fileId, ext)` 生成：`translation` → `translations/`，其它 → `papers/`。

**metadata.json 格式**（`github.ts` 里有 v1→v2 迁移）：
- **v1（旧）**：裸 `Paper[]` 数组。
- **v2（当前）**：`{ version: 2, papers: Paper[], tags: Tag[] }`。
- `fetchMetadata` 两种都能读（读时迁移）；`pushMetadata` 永远写 v2。
- `Paper` / `Tag` / `PaperFile` 类型定义见 `src/types/index.ts`。

## 3. 关键技术决策 & 踩过的坑

### 3.1 PDF.js 必须配置 cMap/wasm/standardFont 资源（否则白屏）
**症状**：英文原生 PDF 正常，日文扫描版 / CJK PDF 全白屏。
**根因**：渲染 CJK 字体要 cMap 文件；解码 JBig2 压缩扫描图要 wasm；都没配置时 `getDocument()` 报错（cMapUrl / wasmUrl / JBig2Error）。
**解法**：
- `vite.config.ts` 里一个内联插件 `copyPdfjsAssets()`，在 `buildStart`（dev + build 都触发）把 `node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm,iccs}` 复制到 `public/pdfjs/`。`public/pdfjs` 已 gitignore，由 node_modules 自动再生。
- `src/utils/pdfExtract.ts` 导出 `pdfDocOptions`，所有 `getDocument()` 调用都 spread 它：
  ```ts
  const PDFJS_ASSET_BASE = import.meta.env.BASE_URL + 'pdfjs/'  // dev=/，线上=/literature-app/
  { cMapUrl, cMapPacked: true, standardFontDataUrl, wasmUrl, iccUrl }
  ```
- ⚠️ 试过 `vite-plugin-static-copy`，它 v4 会强制保留 `node_modules/...` 全路径结构，产物路径错乱，**已弃用**，改成上面的内联插件。

### 3.2 大文件（>1MB）必须用 Git Blobs API 下载
**症状**：>1MB 的 PDF 报 "The PDF file is empty, 0 bytes"，小文件正常。
**根因**：GitHub **Contents API**（`GET /repos/.../contents/{path}`）只对 ≤1MB 文件内联 `content`，更大返回空 body + `encoding: "none"`。
**解法**（`src/utils/github.ts` `fetchFileContent`）：拿到 `getContent` 结果后，若 `content` 为空或 `encoding === 'none'`，改用 **Git Blobs API**（`octokit.git.getBlob({ file_sha })`，上限 100MB）。sha 复用 getContent 返回的。
**注意**：**上传不受此限**——写入端点 `createOrUpdateFileContents` 上限大得多，>18MB 还有 Git Data API 兜底（`uploadPaperFile`）。1MB 限制只针对**读取**。

### 3.3 IndexedDB 缓存自愈（0 字节坏缓存）
**症状**：3.2 修好后大文件仍打不开，Network 里**没有**任何 GitHub 请求。
**根因**：PDF 内容缓存在 IndexedDB（`fileBlobs` 表）。旧代码下载的 0 字节坏数据被缓存了；而 0 字节 `Blob` 是 truthy 对象，命中缓存就直接用、不再请求 GitHub。
**解法**（`src/store/db.ts`，在源头一次覆盖所有调用方）：
- `getFileBlob`：取出后若 `blob.size === 0` → 删除该条 + 返回 `undefined`（当未命中），触发重新下载（走 3.2 的 Blobs API）。**坏缓存自动自愈**。
- `saveFileBlob`：`blob.size === 0` 时跳过写入，从根上不再缓存坏数据。
- 两处保留 `console.warn` 方便诊断。

### 3.4 私密文献机制（isPrivate）
- `Paper.isPrivate === true` → PDF **只存 IndexedDB，不上传 GitHub**（`githubPath`/`githubSha` 为空）。元数据仍正常同步到 metadata.json。
- 切换私密开关：`PaperDetail.tsx` 的 `handlePrivacyToggle`——勾选时从 GitHub 删除已传文件；取消勾选时把本地 blob 补传上去。

### 3.5 排序偏好存 localStorage（不是 IndexedDB，不同步）
- `src/utils/sorting.ts`：`SortState { field: 'addedAt'|'year'|'title', direction: 'asc'|'desc' }`。
- localStorage key：**`literature-app.sort`**。纯本地查看偏好，**不进 IndexedDB、不同步 GitHub**。
- 默认：`addedAt` + `desc`（最新在前）。空/缺失的 `year` 始终排末尾（升降序都钉底）。
- 排序在 `AppContext` 的 `filteredPapers` memo 里「先筛选后排序」应用。

### 3.6 详情页三栏 + 中文译本对照布局
- `PaperDetail.tsx` 宽屏（≥1024px）：原文 tab 和译本 tab 都是三栏 `[InfoPanel | PDF | NotesPanel]`。
- **笔记是整篇文献共享的单一字段 `paper.notes`**——原文 tab 和译本 tab 的笔记栏编辑同一份，不要做成两份。
- `PdfMidPanel` 是通用单文件渲染器（接 `file` prop），原文 / 译本 / 对照两栏都复用它；缩放工具栏在 `PdfViewer` 内部，每个实例独立缩放/滚动。
- 「⇄ 对照原文」：中栏分为原文 + 译本两个独立 `PdfMidPanel`。无原文时按钮禁用。
- 窄屏（<1024px）降级：走 `FileTab`，译本 / 笔记分 tab，无对照模式。
- 详情框宽屏宽度 `.detail-modal--wide { max-width: 95vw }`（之前是 `min(1440px,96vw)`，大屏留白太多已放宽）。高度 `calc(100vh - 40px)` + `body overflow:hidden`，**别动坏**。

## 4. 部署流程

> 需要手动插 PAT（token 不存任何文件，用完即清）。

```bash
# 1. 推源码到 GitHub
git remote set-url origin https://iurip8989:<PAT>@github.com/iurip8989/literature-app.git
git push

# 2. 构建并发布到 gh-pages 分支
npm run deploy            # = predeploy(npm run build) + gh-pages -d dist

# 3. 立即清掉 remote URL 里的 PAT
git remote set-url origin https://github.com/iurip8989/literature-app.git
```

- 配置：`vite.config.ts` `base: '/literature-app/'`；`package.json` 有 `homepage` + `predeploy`/`deploy` 脚本。
- 线上地址：**https://iurip8989.github.io/literature-app/**
- GitHub Pages 设置：Settings → Pages → Branch `gh-pages` / root。
- 构建时 `node:fs` 等 externalized 警告来自 `@anthropic-ai/sdk`，**无害**（浏览器端不会用到那些 Node 模块）。

## 5. 已知待办 / 未来可做

- [ ] **关系图谱**（阶段 6）：文献引用 + 主题关联的射状图。`Paper` 已有 `cites`/`citedBy`/`manualRelations` 字段铺垫，UI 里相关 tab 目前是 placeholder。
- [ ] **标签别名 / 合并**：`Tag` 类型已有 `aliases` 字段，但合并 UI 还没做。
- [ ] **Google Scholar 快速添加**：粘贴链接/DOI 自动抓元数据（现在靠 PDF 解析 + 手填）。
- [ ] **左下角偶发黑块**：待复现排查（疑似某个渲染层 / 缩放相关，未定位）。
- [ ] **AI 推荐主题标签**（SummarySection 里按钮已占位 disabled）。
- [ ] 构建产物单 chunk >500KB，可考虑 code-splitting（目前不影响使用）。

## 6. 常用命令

```bash
npm run dev      # 本地开发（http://localhost:517x/literature-app/）
npm run build    # tsc -b && vite build
npx tsc -b       # 只做类型检查
npm run deploy   # 构建 + 发布到 gh-pages（需先插 PAT，见第 4 节）
```
