import { db, newId } from './db';
import { t } from './i18n';
import type { Category, PromptItem, Tag } from './db/types';
import { blobToDataUrl } from './vision/image';

/**
 * 备份与迁移。
 *
 * 背景:IndexedDB 的物理位置由浏览器分配,扩展无权更改。
 * 所以「把数据放到我想放的地方」只能靠导出 —— 这里提供两种导出:
 *   - 导出为单个 JSON 文件(图片内联为 base64),一定能用
 *   - 导出到指定文件夹(图片落成独立文件,人类可读),依赖 File System Access API
 */

const FORMAT = 'promptary-backup';
const VERSION = 1;

/** 导出时的收藏项:Blob 字段转成 base64,否则 JSON.stringify 会把它变成空对象 */
export interface BackupItem extends Omit<PromptItem, 'imageBlob' | 'thumbnailBlob'> {
  imageBase64?: string;
  thumbnailBase64?: string;
  /** 导出到文件夹时,图片在该目录下的相对文件名 */
  imageFile?: string;
}

export interface BackupFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: number;
  categories: Category[];
  tags: Tag[];
  items: BackupItem[];
}

export interface ImportResult {
  categories: number;
  tags: number;
  items: number;
  /** 因为本地已存在同 id 而跳过的条数 */
  skipped: number;
}

function stripBlobs(item: PromptItem): Omit<PromptItem, 'imageBlob' | 'thumbnailBlob'> {
  const { imageBlob: _i, thumbnailBlob: _t, ...rest } = item;
  return rest;
}

export async function buildBackup(includeImages: boolean): Promise<BackupFile> {
  const [categories, tags, items] = await Promise.all([
    db.categories.toArray(),
    db.tags.toArray(),
    db.items.toArray(),
  ]);

  const backupItems: BackupItem[] = [];
  for (const item of items) {
    const hasImage = includeImages && item.imageBlob;
    backupItems.push({
      ...stripBlobs(item),
      imageBase64: hasImage ? await blobToDataUrl(item.imageBlob as Blob) : undefined,
      thumbnailBase64:
        includeImages && item.thumbnailBlob
          ? await blobToDataUrl(item.thumbnailBlob)
          : undefined,
    });
  }

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    categories,
    tags,
    items: backupItems,
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // 立刻 revoke 会让下载中断,给它一点时间
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 导出为单个 JSON 文件并触发下载 */
export async function exportAsFile(includeImages: boolean): Promise<void> {
  const backup = await buildBackup(includeImages);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `promptary-${stamp}${includeImages ? '' : '-无图'}.json`);
}

// ---------------------- 导出到文件夹 ----------------------

/** File System Access API 的最小类型定义(TS 内置 lib 覆盖不全,自己声明更省事) */
interface WritableLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface FileHandleLike {
  createWritable(): Promise<WritableLike>;
}
interface DirHandleLike {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
}

export function supportsDirectoryPicker(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

function extOf(mime: string): string {
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  return '.jpg';
}

async function writeFile(dir: DirHandleLike, name: string, blob: Blob): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/**
 * 导出到用户选定的文件夹,图片落成独立文件。
 *
 * 目录结构:
 *   <所选目录>/Promptary/images/<id>.jpg
 *   <所选目录>/Promptary/promptary-data.json
 *
 * 选这个结构是为了让用户能用任何工具直接查看、备份、同步这些图片 ——
 * 而不是只能靠 Promptary 自己读。
 */
export async function exportToDirectory(): Promise<{ images: number }> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (o?: { mode?: string }) => Promise<DirHandleLike>;
    }
  ).showDirectoryPicker;

  if (!picker) {
    throw new Error(t('error.noDirectoryPicker'));
  }

  const picked = await picker({ mode: 'readwrite' });
  const root = await picked.getDirectoryHandle('Promptary', { create: true });
  const imagesDir = await root.getDirectoryHandle('images', { create: true });

  const [categories, tags, items] = await Promise.all([
    db.categories.toArray(),
    db.tags.toArray(),
    db.items.toArray(),
  ]);

  let imageCount = 0;
  const exported: BackupItem[] = [];

  for (const item of items) {
    let imageFile: string | undefined;

    if (item.imageBlob) {
      imageFile = `${item.id}${extOf(item.imageBlob.type)}`;
      await writeFile(imagesDir, imageFile, item.imageBlob);
      imageCount++;
    }

    exported.push({ ...stripBlobs(item), imageFile });
  }

  const meta: BackupFile = {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    categories,
    tags,
    items: exported,
  };

  await writeFile(
    root,
    'promptary-data.json',
    new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }),
  );

  return { images: imageCount };
}

// ---------------------- 导入 ----------------------

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  // 扩展页面里 fetch data: URL 是允许的,比自己手写 base64 解码稳妥
  return (await fetch(dataUrl)).blob();
}

/**
 * 从备份文件导入。
 *
 * 全程按 id 去重:本地已有的 id 一律跳过,不覆盖用户当前的改动。
 * 导入是「补充」而不是「替换」——误点一次不该毁掉现有收藏。
 */
export async function importBackup(file: File): Promise<ImportResult> {
  const text = await file.text();

  let backup: BackupFile;
  try {
    backup = JSON.parse(text) as BackupFile;
  } catch {
    throw new Error(t('error.invalidJson'));
  }

  if (backup?.format !== FORMAT) {
    throw new Error(t('error.notBackupFile'));
  }

  const result: ImportResult = { categories: 0, tags: 0, items: 0, skipped: 0 };

  // ---- 分类 ----
  const existingCategoryIds = new Set((await db.categories.toArray()).map((c) => c.id));
  const newCategories = (backup.categories ?? []).filter((c) => !existingCategoryIds.has(c.id));
  if (newCategories.length) {
    await db.categories.bulkAdd(newCategories);
    result.categories = newCategories.length;
  }

  // ---- 标签 ----
  const existingTags = await db.tags.toArray();
  const existingTagIds = new Set(existingTags.map((t) => t.id));
  const existingNormalized = new Set(existingTags.map((t) => t.normalized));
  const newTags = (backup.tags ?? []).filter(
    (t) => !existingTagIds.has(t.id) && !existingNormalized.has(t.normalized),
  );
  if (newTags.length) {
    await db.tags.bulkAdd(newTags);
    result.tags = newTags.length;
  }

  // ---- 收藏项 ----
  const existingItemIds = new Set((await db.items.toArray()).map((i) => i.id));

  for (const raw of backup.items ?? []) {
    if (existingItemIds.has(raw.id)) {
      result.skipped++;
      continue;
    }

    const { imageBase64, thumbnailBase64, imageFile: _f, ...rest } = raw;

    await db.items.add({
      ...rest,
      id: raw.id || newId(),
      imageBlob: imageBase64 ? await dataUrlToBlob(imageBase64) : undefined,
      thumbnailBlob: thumbnailBase64 ? await dataUrlToBlob(thumbnailBase64) : undefined,
    });
    result.items++;
  }

  return result;
}
