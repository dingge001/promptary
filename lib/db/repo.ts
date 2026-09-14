import { categoryLabel } from '../i18n';
import { db, newId, now } from './index';
import type { Category, ItemSource, PromptFields, PromptItem, Tag } from './types';

/** 归一化标签名:去首尾空白 + 折叠中间空白 + 转小写。让 "Silver Hair" 与 "silver  hair" 归为同一个标签 */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 把提示词拍平成一段可搜索文本,供内存关键词检索使用 */
export function promptToSearchText(p?: PromptFields): string {
  if (!p) return '';
  return [p.prompt, p.negative, ...p.tags].filter(Boolean).join(' ');
}

// ============================ 收藏项 ============================

export interface UpsertItemInput {
  title: string;
  source: ItemSource;
  prompt?: PromptFields;
  /** 这条提示词是为哪个目标模型生成的 */
  targetModel?: string;
  imageBlob?: Blob;
  thumbnailBlob?: Blob;
  imageUrl?: string;
  width?: number;
  height?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceSite?: string;
  author?: string;
  categoryId?: string;
  /** 传标签名即可,内部负责复用已有标签或新建 */
  tagNames?: string[];
  note?: string;
  starred?: boolean;
}

export async function createItem(input: UpsertItemInput): Promise<PromptItem> {
  const ts = now();
  const tagIds = input.tagNames?.length ? await ensureTags(input.tagNames) : [];

  const item: PromptItem = {
    id: newId(),
    createdAt: ts,
    updatedAt: ts,
    syncState: 'local',
    source: input.source,
    title: input.title.trim() || '未命名',
    imageBlob: input.imageBlob,
    thumbnailBlob: input.thumbnailBlob,
    imageUrl: input.imageUrl,
    width: input.width,
    height: input.height,
    prompt: input.prompt,
    targetModel: input.targetModel,
    sourceUrl: input.sourceUrl,
    sourceTitle: input.sourceTitle,
    sourceSite: input.sourceSite,
    author: input.author,
    categoryId: input.categoryId,
    tagIds,
    starred: input.starred ?? false,
    note: input.note,
  };

  await db.items.add(item);
  await bumpTagCounts(tagIds, 1);
  return item;
}

export async function updateItem(id: string, patch: Partial<UpsertItemInput>): Promise<void> {
  const existing = await db.items.get(id);
  if (!existing) return;

  let tagIds = existing.tagIds;
  let tagsChanged = false;

  if (patch.tagNames) {
    tagIds = await ensureTags(patch.tagNames);
    tagsChanged = true;
  }

  if (tagsChanged) {
    await bumpTagCounts(existing.tagIds, -1);
    await bumpTagCounts(tagIds, 1);
  }

  // tagNames 是入参形态,不能直接写回记录
  const { tagNames: _ignored, ...rest } = patch;

  // categoryId 被显式置空 = 用户想把它移回「未分类」。
  // 这一步必须单独走 modify,否则会被 Dexie 的 undefined 忽略规则吃掉。
  const shouldClearCategory = 'categoryId' in patch && !patch.categoryId;

  await db.items.update(id, {
    ...rest,
    tagIds,
    updatedAt: now(),
    syncState: 'local',
  });

  if (shouldClearCategory) {
    await db.items
      .where('id')
      .equals(id)
      .modify((obj) => {
        delete obj.categoryId;
      });
  }
}

/**
 * 往已有收藏项上追加标签,保留它原有的标签。
 *
 * 和 updateItem 传 tagNames 的区别:那个是整体替换,这个是合并 ——
 * 重新反推一张老图时,用户之前手打的标签不该被模型抽的标签冲掉。
 */
export async function appendTags(id: string, names: string[]): Promise<void> {
  if (!names.length) return;

  const item = await db.items.get(id);
  if (!item) return;

  const newIds = (await ensureTags(names)).filter((tid) => !item.tagIds.includes(tid));
  if (!newIds.length) return;

  await bumpTagCounts(newIds, 1);
  await db.items.update(id, {
    tagIds: [...item.tagIds, ...newIds],
    updatedAt: now(),
    syncState: 'local',
  });
}

/**
 * 软删除。不物理移除记录,而是打上 deletedAt 墓碑。
 * 这样二阶段云同步时,其他设备才知道「这条不是没同步到,而是被删了」。
 */
export async function softDeleteItem(id: string): Promise<void> {
  const item = await db.items.get(id);
  if (!item || item.deletedAt) return;

  const ts = now();
  await db.items.update(id, { deletedAt: ts, updatedAt: ts, syncState: 'local' });
  await bumpTagCounts(item.tagIds, -1);
}

/** 从回收状态恢复 */
export async function restoreItem(id: string): Promise<void> {
  const item = await db.items.get(id);
  if (!item || !item.deletedAt) return;

  const ts = now();
  // 注意:Dexie 的 update() 会忽略值为 undefined 的字段,想真正把 deletedAt
  // 从记录上摘掉,只能走 modify 手动 delete,否则「恢复」是个空操作。
  await db.items
    .where('id')
    .equals(id)
    .modify((obj) => {
      delete obj.deletedAt;
      obj.updatedAt = ts;
      obj.syncState = 'local';
    });

  await bumpTagCounts(item.tagIds, 1);
}

/**
 * 彻底删除,不可恢复。
 *
 * 这是唯一真正抹掉记录的入口。云同步时其他设备无从得知这条消失过 ——
 * 但用户点的既然是「彻底删除」,这个语义就是对的。
 */
export async function hardDeleteItem(id: string): Promise<void> {
  await db.items.delete(id);
}

/** 清空回收站,返回清掉的条数 */
export async function emptyTrash(): Promise<number> {
  const deleted = await listDeletedItems();
  if (deleted.length) await db.items.bulkDelete(deleted.map((i) => i.id));
  return deleted.length;
}

export async function toggleStar(id: string): Promise<void> {
  const item = await db.items.get(id);
  if (!item) return;
  await db.items.update(id, {
    starred: !item.starred,
    updatedAt: now(),
    syncState: 'local',
  });
}

export async function getItem(id: string): Promise<PromptItem | undefined> {
  return db.items.get(id);
}

export interface ItemQuery {
  /** 指定分类。与 uncategorized 互斥 */
  categoryId?: string;
  /** 只看未分类 */
  uncategorized?: boolean;
  /** 需同时命中的标签 */
  tagIds?: string[];
  source?: ItemSource;
  starred?: boolean;
  /** 关键词,匹配标题/提示词正文/备注/作者/站点 */
  keyword?: string;
  sort?: 'createdAt' | 'updatedAt';
  desc?: boolean;
}

/**
 * 查询收藏项。
 *
 * V1 走「全量取出 + 内存过滤」:本地收藏量级通常在几千条以内,这样写最直观。
 * 若日后单库超过约 2 万条,再把 keyword 分支换成 MiniSearch 倒排索引即可,
 * 调用方接口不用变。
 */
export async function listItems(query: ItemQuery = {}): Promise<PromptItem[]> {
  const all = await db.items.toArray();
  const kw = query.keyword?.trim().toLowerCase();

  const result = all.filter((it) => {
    if (it.deletedAt) return false;
    if (query.uncategorized ? Boolean(it.categoryId) : query.categoryId && it.categoryId !== query.categoryId) {
      return false;
    }
    if (query.source && it.source !== query.source) return false;
    if (query.starred && !it.starred) return false;
    if (query.tagIds?.length && !query.tagIds.every((t) => it.tagIds.includes(t))) return false;

    if (kw) {
      const haystack = [
        it.title,
        it.note,
        it.author,
        it.sourceSite,
        promptToSearchText(it.prompt),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });

  const key = query.sort ?? 'createdAt';
  const dir = query.desc === false ? 1 : -1;
  return result.sort((a, b) => (a[key] - b[key]) * dir);
}

/** 已删除的收藏项,供日后做「回收站」用 */
export async function listDeletedItems(): Promise<PromptItem[]> {
  const all = await db.items.toArray();
  return all.filter((it) => it.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

// ============================ 标签 ============================

/** 按名字批量取用标签:已存在则复用,已软删除则复活,都没有才新建 */
export async function ensureTags(names: string[]): Promise<string[]> {
  const unique = new Map<string, string>();
  for (const n of names) {
    const key = normalizeTagName(n);
    if (key && !unique.has(key)) unique.set(key, n.trim());
  }
  if (unique.size === 0) return [];

  const ids: string[] = [];
  const ts = now();

  for (const [norm, display] of unique) {
    const existing = await db.tags.where('normalized').equals(norm).first();
    if (existing) {
      // 同名标签曾被删除过,复活它而不是造一个重复的。
      // 同样要走 modify —— update() 摘不掉 undefined 的字段。
      if (existing.deletedAt) {
        await db.tags
          .where('id')
          .equals(existing.id)
          .modify((obj) => {
            delete obj.deletedAt;
            obj.updatedAt = ts;
          });
      }
      ids.push(existing.id);
    } else {
      const tag: Tag = {
        id: newId(),
        name: display,
        normalized: norm,
        count: 0,
        createdAt: ts,
        updatedAt: ts,
        syncState: 'local',
      };
      await db.tags.add(tag);
      ids.push(tag.id);
    }
  }
  return ids;
}

/**
 * 增减标签引用计数。
 * 刻意不更新 updatedAt —— count 是派生数据,同步时各端自行重算,
 * 若把它算作「修改」会导致同步风暴。
 */
async function bumpTagCounts(tagIds: string[], delta: number): Promise<void> {
  if (!tagIds.length) return;
  const ts = now();

  await db.transaction('rw', db.tags, async () => {
    for (const id of tagIds) {
      const tag = await db.tags.get(id);
      if (!tag) continue;

      const next = Math.max(0, tag.count + delta);

      // 引用数掉到 0,说明已经没有任何收藏在用它了,顺手软删除。
      // 空标签留在标签栏里没有任何意义,只会越积越多 ——
      // 用户删光收藏之后还看到一堆历史标签,是很莫名的体验。
      if (next === 0 && delta < 0 && !tag.deletedAt) {
        await db.tags.update(id, { count: 0, deletedAt: ts, updatedAt: ts, syncState: 'local' });
      } else {
        await db.tags.update(id, { count: next });
      }
    }
  });
}

/**
 * 清理没有任何收藏引用的标签。
 *
 * 平时靠 bumpTagCounts 在计数归零时顺手清掉,但历史遗留的空标签
 * (比如这个逻辑上线前就已经存在的)没人触发,得主动扫一次。
 * count 有索引,查询很便宜,启动时跑一次就好。
 */
export async function pruneOrphanTags(): Promise<number> {
  const orphans = (await db.tags.where('count').equals(0).toArray()).filter((t) => !t.deletedAt);
  if (!orphans.length) return 0;

  const ts = now();
  await db.transaction('rw', db.tags, async () => {
    for (const tag of orphans) {
      await db.tags.update(tag.id, { deletedAt: ts, updatedAt: ts, syncState: 'local' });
    }
  });
  return orphans.length;
}

export async function listTags(): Promise<Tag[]> {
  const all = await db.tags.toArray();
  return all.filter((t) => !t.deletedAt).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export async function renameTag(id: string, name: string): Promise<void> {
  const normalized = normalizeTagName(name);
  if (!normalized) return;
  await db.tags.update(id, { name: name.trim(), normalized, updatedAt: now(), syncState: 'local' });
}

/** 删除标签:只解除与收藏项的关联,不动收藏项本身 */
export async function deleteTag(id: string): Promise<void> {
  const ts = now();
  await db.transaction('rw', db.tags, db.items, async () => {
    await db.tags.update(id, { deletedAt: ts, updatedAt: ts, syncState: 'local' });

    const affected = await db.items.where('tagIds').equals(id).toArray();
    for (const it of affected) {
      await db.items.update(it.id, {
        tagIds: it.tagIds.filter((t) => t !== id),
        updatedAt: ts,
        syncState: 'local',
      });
    }
  });
}

/** 全量重算标签计数。数据被外部导入或同步后,用它兜底修正 */
export async function recalcTagCounts(): Promise<void> {
  const items = (await db.items.toArray()).filter((i) => !i.deletedAt);
  const counts = new Map<string, number>();
  for (const it of items) {
    for (const t of it.tagIds) counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  const ts = now();

  await db.transaction('rw', db.tags, async () => {
    for (const tag of await db.tags.toArray()) {
      const c = counts.get(tag.id) ?? 0;
      if (c === 0 && !tag.deletedAt) {
        // 全量重算后发现没人引用,同样清掉
        await db.tags.update(tag.id, { count: 0, deletedAt: ts, updatedAt: ts });
      } else if (tag.count !== c) {
        await db.tags.update(tag.id, { count: c });
      }
    }
  });
}

// ============================ 分类 ============================

export async function listCategories(): Promise<Category[]> {
  const all = await db.categories.toArray();
  return all.filter((c) => !c.deletedAt).sort((a, b) => a.order - b.order);
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
  /** 该分类及其子分类下的收藏项总数 */
  total: number;
}

/** 把扁平分类列表组装成树 */
export function buildCategoryTree(list: Category[], counts?: Map<string, number>): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  for (const c of list) {
    map.set(c.id, { ...c, children: [], total: counts?.get(c.id) ?? 0 });
  }

  const roots: CategoryNode[] = [];
  for (const node of map.values()) {
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // 自底向上累加子分类计数
  const rollup = (node: CategoryNode): number => {
    node.total = (counts?.get(node.id) ?? 0) + node.children.reduce((s, c) => s + rollup(c), 0);
    return node.total;
  };
  roots.forEach(rollup);

  return roots;
}

/**
 * 按名字找分类 id。
 *
 * 模型的归类结果不可靠,名字对不上就当作「没归类」——
 * 硬塞进一个错的分类,比不归类更麻烦。
 */
export async function findCategoryByName(name?: string): Promise<string | undefined> {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  const list = await listCategories();
  // 模型看到的是翻译后的显示名,所以拿它跟显示名比 ——
  // 直接比 c.name 的话,内置分类存的是 'builtin.people' 这种 key,永远对不上
  return list.find((c) => categoryLabel(c.name) === trimmed)?.id;
}

export async function createCategory(name: string, parentId?: string): Promise<Category> {
  const siblings = (await listCategories()).filter((c) => c.parentId === parentId);
  const ts = now();

  const cat: Category = {
    id: newId(),
    name: name.trim() || '新分类',
    parentId,
    order: siblings.length,
    createdAt: ts,
    updatedAt: ts,
    syncState: 'local',
  };
  await db.categories.add(cat);
  return cat;
}

export async function renameCategory(id: string, name: string): Promise<void> {
  await db.categories.update(id, {
    name: name.trim(),
    updatedAt: now(),
    syncState: 'local',
  });
}

/** 收集某个分类及其全部后代 id */
function collectDescendants(list: Category[], rootId: string): string[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i++) {
    for (const c of list) {
      if (c.parentId === out[i] && !out.includes(c.id)) out.push(c.id);
    }
  }
  return out;
}

/**
 * 删除分类:级联软删除其所有子分类。
 * 分类下的收藏项不会被删,而是退回「未分类」—— 误删分类不该毁掉用户收藏的内容。
 */
export async function deleteCategory(id: string): Promise<void> {
  const all = await listCategories();
  const doomed = collectDescendants(all, id);
  const ts = now();

  await db.transaction('rw', db.categories, db.items, async () => {
    for (const cid of doomed) {
      await db.categories.update(cid, { deletedAt: ts, updatedAt: ts, syncState: 'local' });
    }

    const affected = await db.items.where('categoryId').anyOf(doomed).toArray();
    for (const it of affected) {
      await db.items
        .where('id')
        .equals(it.id)
        .modify((obj) => {
          delete obj.categoryId;
          obj.updatedAt = ts;
          obj.syncState = 'local';
        });
    }
  });
}

/** 统计各分类直接归属的收藏项数量(不含子分类) */
export async function countItemsByCategory(): Promise<Map<string, number>> {
  const items = (await db.items.toArray()).filter((i) => !i.deletedAt);
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.categoryId) counts.set(it.categoryId, (counts.get(it.categoryId) ?? 0) + 1);
  }
  return counts;
}

// ============================ 统计 ============================

export interface LibraryStats {
  itemCount: number;
  imageCount: number;
  textCount: number;
  starredCount: number;
  uncategorizedCount: number;
  tagCount: number;
  categoryCount: number;
}

export async function getStats(): Promise<LibraryStats> {
  const items = (await db.items.toArray()).filter((i) => !i.deletedAt);
  const [tags, categories] = await Promise.all([listTags(), listCategories()]);

  return {
    itemCount: items.length,
    imageCount: items.filter((i) => i.source === 'image').length,
    textCount: items.filter((i) => i.source === 'text').length,
    starredCount: items.filter((i) => i.starred).length,
    uncategorizedCount: items.filter((i) => !i.categoryId).length,
    tagCount: tags.length,
    categoryCount: categories.length,
  };
}
