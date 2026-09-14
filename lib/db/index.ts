import Dexie, { type Table } from 'dexie';
import type { Category, PromptItem, Tag } from './types';

/**
 * 本地数据库。所有业务数据只存在用户机器上,不上传任何服务器。
 *
 * 用 IndexedDB 而非 chrome.storage 的原因:后者总配额仅 10MB(除非申请
 * unlimitedStorage),几张原图就撑爆。IndexedDB 原生支持 Blob,容量按磁盘配额走。
 */
export class PromptaryDB extends Dexie {
  items!: Table<PromptItem, string>;
  categories!: Table<Category, string>;
  tags!: Table<Tag, string>;

  constructor() {
    super('promptary');

    // 带 * 前缀的是 multiEntry 索引,让「按标签筛选」不必全表扫描
    this.version(1).stores({
      items:
        'id, createdAt, updatedAt, deletedAt, categoryId, source, starred, sourceSite, *tagIds',
      categories: 'id, parentId, order, updatedAt, deletedAt',
      tags: 'id, normalized, count, updatedAt, deletedAt',
    });

    // v2:提示词从「十个散字段」改为「一条成品 + 标签」,并记录目标模型。
    // 旧数据就地合并,用户不必把收藏重新反推一遍。
    this.version(2)
      .stores({
        items:
          'id, createdAt, updatedAt, deletedAt, categoryId, source, starred, sourceSite, targetModel, *tagIds',
        categories: 'id, parentId, order, updatedAt, deletedAt',
        tags: 'id, normalized, count, updatedAt, deletedAt',
      })
      .upgrade((tx) =>
        tx
          .table('items')
          .toCollection()
          .modify((item: Record<string, unknown>) => {
            const p = item.prompt as Record<string, unknown> | undefined;
            // 已经是新结构则跳过
            if (!p || typeof p.prompt === 'string') return;

            const parts = [p.subject, p.style, p.composition, p.lighting, p.color].filter(
              (s): s is string => typeof s === 'string' && s.trim().length > 0,
            );
            const quality = Array.isArray(p.qualityTags) ? (p.qualityTags as string[]) : [];

            item.prompt = {
              prompt:
                (p.promptEn as string) ||
                (p.promptZh as string) ||
                [...parts, ...quality].join(', '),
              negative: Array.isArray(p.negative) ? (p.negative as string[]).join(', ') : '',
              tags: Array.isArray(p.tags) ? p.tags : [],
            };

            // 旧格式产出的本来就是逗号标签串,归到 SD 名下最贴切
            item.targetModel ??= 'stable-diffusion';
          }),
      );
  }
}

export const db = new PromptaryDB();

/** 生成主键。客户端生成 UUID 而不是用自增,是云同步的前提 */
export const newId = (): string => crypto.randomUUID();

export const now = (): number => Date.now();

/**
 * 内置分类:AI 生图参考图的几个主要维度,开箱即用。
 *
 * 存 i18n key 而不是中文 —— 分类名一旦以文字形式落库就固化了,
 * 用户切到英文也变不了。显示时由 categoryLabel() 翻译。
 */
const BUILTIN_CATEGORIES = ['builtin.people', 'builtin.scene', 'builtin.style', 'builtin.composition'];

/**
 * 首次运行时写入内置分类。已存在则跳过,可重复调用。
 */
export async function initDefaultData(): Promise<void> {
  const count = await db.categories.count();
  if (count > 0) return;

  const ts = now();
  await db.categories.bulkAdd(
    BUILTIN_CATEGORIES.map((name, i) => ({
      id: newId(),
      name,
      order: i,
      builtin: true,
      createdAt: ts,
      updatedAt: ts,
      syncState: 'local' as const,
    })),
  );
}
