// ─── Paper (文献条目) ────────────────────────────────────────────────────────

export type Language = 'en' | 'jp' | 'zh' | 'other';

export type ReadingStatus = 'unread' | 'reading' | 'done' | 'deep';

export type FileFormat = 'pdf' | 'docx' | 'txt' | 'md';

export type FileType = 'original' | 'translation' | 'notes' | 'other';

export type RelationType = 'cites' | 'related' | 'follows' | 'critiques' | 'custom';

export interface PaperFile {
  id: string;
  type: FileType;
  filename: string;
  githubPath?: string;   // repo 内相对路径，e.g. "papers/uuid.pdf"
  githubSha?: string;    // 用于 API 更新/删除
  format: FileFormat;
  language?: Language;
  size?: number;         // bytes
  addedAt: string;
}

export interface ManualRelation {
  targetId: string;
  type: RelationType;
  customLabel?: string; // only when type === 'custom'
  note?: string;
}

export interface Paper {
  id: string;                    // UUID
  title: string;
  titleCn?: string;              // 中文译名（如果有翻译版本）
  authors: string[];
  year: number;
  venue?: string;                // 发表会议/期刊
  language: Language;
  tags: string[];
  status: ReadingStatus;
  notes: string;                 // Markdown 格式

  files: PaperFile[];

  cites: string[];               // 此文引用的论文 ID（库内）
  citedBy: string[];             // 引用此文的论文 ID（库内，自动维护）
  manualRelations: ManualRelation[];

  abstract?: string;
  aiSummary?: string;
  aiSummaryGeneratedAt?: string; // ISO timestamp

  arxivId?: string;
  doi?: string;

  isPrivate: boolean;            // true = PDF 仅本地，不上传到 GitHub

  addedAt: string;               // ISO timestamp
  updatedAt: string;             // ISO timestamp
}

// ─── Tag（标签库） ────────────────────────────────────────────────────────────

export interface Tag {
  name: string;
  description?: string;
  color?: string;
  aliases?: string[];            // 合并时记录历史名
  createdAt: string;
}

// ─── Settings（用户设置） ─────────────────────────────────────────────────────

export type ThemeType = 'editorial' | 'minimal' | 'dark';

export type ViewType = 'cards' | 'list' | 'graph';

export interface Settings {
  claudeApiKey?: string;
  rememberApiKey: boolean;

  githubPat?: string;            // Personal Access Token（明文存储于本地 IndexedDB，未加密 — 见需求文档 §9 备忘）
  aiSummaryModel?: string;       // Claude model id, e.g. "claude-sonnet-4-6"
  aiTagModel?: string;           // Claude model id for tag suggestion (V1.5+)
  githubUsername?: string;
  githubRepo?: string;           // 数据仓库名，如 "literature-db"

  defaultView: ViewType;
  theme: ThemeType;
  autoSyncEnabled: boolean;      // false = 单设备本地模式

  detailSplitRatio?: number;     // 详情页分栏比例（左侧 PDF 宽度占比，0.25–0.80）
}

// ─── SyncState（同步状态，每篇文献内部维护） ───────────────────────────────────

export interface SyncState {
  paperId: string;
  lastSyncedSha?: string;        // 上次同步时的 git commit SHA
  pendingChanges: boolean;
  conflictsWith?: string;        // 检测到冲突时，远端的 SHA
}

// ─── App-level sync status indicator ────────────────────────────────────────

export type SyncStatus = 'synced' | 'syncing' | 'pending' | 'offline' | 'error';

// ─── Filter state（筛选器状态） ───────────────────────────────────────────────

export interface FilterState {
  language: Language | 'all';
  status: ReadingStatus | null;
  tag: string | null;
  year: number | null;
  addedWithin: 'month' | '3months' | '6months' | 'year' | null;
  hasTranslation: boolean;
  searchQuery: string;
}
