import Dexie, { type Table } from 'dexie'
import type { Paper, Tag, SyncState } from '../types'

interface SettingRecord {
  key: string
  value: unknown
}

interface FileBlobRecord {
  paperId: string
  fileId: string
  blob: Blob
}

export class LiteratureDB extends Dexie {
  papers!: Table<Paper>
  tags!: Table<Tag>
  settings!: Table<SettingRecord>
  syncStates!: Table<SyncState>
  fileBlobs!: Table<FileBlobRecord>

  constructor() {
    super('literature-app')
    this.version(1).stores({
      papers: 'id, language, status, year, addedAt, isPrivate',
      tags: 'name, createdAt',
      settings: 'key',
      syncStates: 'paperId',
      fileBlobs: '[paperId+fileId]',
    })
  }
}

export const db = new LiteratureDB()

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const record = await db.settings.get(key)
  return record?.value as T | undefined
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key)
}

export async function saveFileBlob(paperId: string, fileId: string, blob: Blob): Promise<void> {
  // Never persist an empty blob — a 0-byte download is corrupt (e.g. the old
  // Contents-API path that returned nothing for >1 MB files). Caching it would
  // poison every future read. Skip the write and let the caller surface/retry.
  if (blob.size === 0) {
    console.warn('[saveFileBlob] 跳过写入 0 字节 blob，避免缓存坏数据', paperId, fileId)
    return
  }
  await db.fileBlobs.put({ paperId, fileId, blob })
}

export async function getFileBlob(paperId: string, fileId: string): Promise<Blob | undefined> {
  const record = await db.fileBlobs.get([paperId, fileId])
  // Self-heal stale corruption: a cached 0-byte blob (left by the old download
  // path) is invalid. Drop it and report a miss so the caller re-fetches from
  // GitHub — which now goes through the Git Blobs API for files >1 MB.
  if (record && record.blob.size === 0) {
    console.warn('[getFileBlob] 检测到 0 字节坏缓存，删除以触发重新下载', paperId, fileId)
    await db.fileBlobs.delete([paperId, fileId])
    return undefined
  }
  return record?.blob
}

export async function deleteFileBlob(paperId: string, fileId: string): Promise<void> {
  await db.fileBlobs.delete([paperId, fileId])
}

export async function deleteAllFileBlobs(paperId: string): Promise<void> {
  await db.fileBlobs.filter(r => r.paperId === paperId).delete()
}

// ── Tag CRUD ──────────────────────────────────────────────────────────────────
//
// Tags are independent first-class records. `name` is the primary key — same
// string identity used in paper.tags[], so storing a Tag record is essentially
// declaring "this name exists in the library, even if no paper uses it yet."

export async function getAllTagRecords(): Promise<Tag[]> {
  return db.tags.toArray()
}

export async function createTagRecord(tag: Tag): Promise<void> {
  await db.tags.put(tag)
}

export async function deleteTagRecord(name: string): Promise<void> {
  await db.tags.delete(name)
}

export async function bulkPutTagRecords(tags: Tag[]): Promise<void> {
  if (tags.length > 0) await db.tags.bulkPut(tags)
}

export async function clearAllTagRecords(): Promise<void> {
  await db.tags.clear()
}
