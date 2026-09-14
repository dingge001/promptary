import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { AppSettings, PromptFields } from '@/lib/db/types';
import {
  appendTags,
  buildCategoryTree,
  countItemsByCategory,
  createItem,
  findCategoryByName,
  listCategories,
  listItems,
  listTags,
  pruneOrphanTags,
  softDeleteItem,
  toggleStar,
  updateItem,
  type ItemQuery,
} from '@/lib/db/repo';
import {
  BATCH_JOB_KEY,
  PENDING_TASK_KEY,
  type BatchJob,
  type PageImage,
  type PendingTask,
} from '@/lib/messages';
import { categoryLabel, detectLocale, setLocale, t } from '@/lib/i18n';
import { getSettings, isProviderReady } from '@/lib/settings';
import { analyzeImage, ensureLocalImage, type AnalyzeResult } from '@/lib/vision/analyze';
import { siteOf } from '@/lib/vision/image';
import { deriveTitle, textOnlyFields } from '@/lib/vision/schema';
import AnalyzeOverlay, { type AnalysisView, type EditedFields } from './components/AnalyzeOverlay';
import BatchProgress from './components/BatchProgress';
import CategoryManager from './components/CategoryManager';
import {
  IconCheck,
  IconCheckSquare,
  IconGrid,
  IconLibrary,
  IconSearch,
  IconSettings,
  IconSliders,
  IconSparkle,
  IconTrash,
} from './components/icons';
import { Button } from './components/ui';
import ItemCard from './components/ItemCard';
import ItemDetail from './components/ItemDetail';
import SettingsPanel from './components/SettingsPanel';
import TrashPanel from './components/TrashPanel';

type View = 'library' | 'settings' | 'trash';

/**
 * 顶栏按钮。
 *
 * 写成函数而不是「基础类 + 追加类」:两套颜色类同时存在时,谁生效取决于
 * Tailwind 生成 CSS 的先后顺序,而不是 className 里的书写顺序 ——
 * 之前追加的 text-accent 就是被基础类里的 text-neutral-600 盖掉了。
 */
const headerBtn = (active = false) =>
  `flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
    active
      ? 'border-accent bg-accent-soft text-accent'
      : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 hover:text-ink dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
  }`;

interface AnalyzeContext {
  imageUrl?: string;
  /** 原图尺寸。仅用于展示,不参与提示词生成 */
  width?: number;
  height?: number;
  /** 本地已有的图片。详情页重新反推时走它,不依赖外部图床还在 */
  imageBlob?: Blob;
  pageUrl?: string;
  pageTitle?: string;
}

export default function App() {
  const [view, setView] = useState<View>('library');
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // 筛选条件
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<string>();
  const [uncategorized, setUncategorized] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const [detailId, setDetailId] = useState<string>();
  const [pageImages, setPageImages] = useState<PageImage[] | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  /** 批量选择模式:点击卡片变成勾选,底部出现批量操作栏 */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [toast, setToast] = useState<string>();

  // 四个顶栏按钮的激活条件必须互斥:选图面板是在库视图之上叠出来的,
  // view 此时仍是 library,直接用 view 判断会让「选图」和「库」同时亮起来
  const inPicker = view === 'library' && Boolean(pageImages);
  const inLibrary = view === 'library' && !pageImages;

  const [analysisView, setAnalysisView] = useState<AnalysisView>({ status: 'idle' });
  const [analysisCtx, setAnalysisCtx] = useState<AnalyzeContext>({});
  /** 本次反推用的目标模型档案 id,结果面板据此决定显示哪些字段 */
  const [analysisModelId, setAnalysisModelId] = useState('');
  /** 有值表示这次反推是给已有收藏补做或重做提示词,结果写回它而不是新建 */
  const [analysisTargetId, setAnalysisTargetId] = useState<string>();
  /** 本次反推的原图尺寸,供结果面板提示比例 */
  const [analysisDims, setAnalysisDims] = useState<{ w?: number; h?: number }>({});

  const analysisResultRef = useRef<AnalyzeResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 回调里要用到最新设置,但又不想让回调随设置变化而重建
  const settingsRef = useRef<AppSettings | null>(null);
  settingsRef.current = settings;

  const reloadSettings = useCallback(() => {
    getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    reloadSettings();
    // 启动时清一次历史遗留的空标签
    void pruneOrphanTags();
  }, [reloadSettings]);

  // 主题:跟随系统时监听系统变化,固定主题时直接套用
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = settings?.theme ?? 'system';
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      // 用 data-theme 属性切换,和主站保持一致(而不是 Tailwind 默认的 .dark class)
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings?.theme]);

  // 界面语言。setLocale 改的是模块级变量、不会自己触发重渲染,
  // 靠 settings 变化的这次渲染把新语言带到所有子组件
  useEffect(() => {
    setLocale(!settings || settings.locale === 'auto' ? detectLocale() : settings.locale);
  }, [settings]);

  // 侧边栏关掉再打开时,后台的批量任务可能还在跑 —— 把进度面板恢复出来,
  // 否则用户会以为任务丢了
  useEffect(() => {
    chrome.storage.session.get(BATCH_JOB_KEY).then((raw) => {
      const job = raw[BATCH_JOB_KEY] as BatchJob | undefined;
      if (job?.status === 'running') setShowBatch(true);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  // ---------------------------- 数据 ----------------------------

  const query: ItemQuery = useMemo(
    () => ({
      keyword: keyword.trim() || undefined,
      categoryId: uncategorized ? undefined : categoryId,
      uncategorized,
      tagIds: selectedTags.length ? selectedTags : undefined,
    }),
    [keyword, categoryId, uncategorized, selectedTags],
  );

  const items = useLiveQuery(() => listItems(query), [query]);
  const categories = useLiveQuery(() => listCategories(), []);
  const counts = useLiveQuery(() => countItemsByCategory(), []);
  const tags = useLiveQuery(() => listTags(), []);

  const tree = useMemo(
    () => (categories ? buildCategoryTree(categories, counts) : []),
    [categories, counts],
  );

  // ---------------------------- 反推 ----------------------------

  const runAnalyze = useCallback(
    async (ctx: AnalyzeContext, modelId?: string, targetId?: string) => {
      const current = settingsRef.current;

      if (!current || !isProviderReady(current)) {
        setAnalysisCtx(ctx);
        setAnalysisView({
          status: 'error',
          error: t('analyze.noProvider'),
        });
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setAnalysisCtx(ctx);
      setAnalysisTargetId(targetId);
      setAnalysisDims({ w: ctx.width, h: ctx.height });
      setAnalysisView({ status: 'running' });

      try {
        // modelId 不传就用设置里的默认模型;传了说明用户在结果面板里换了模型重推
        const res = await analyzeImage(ctx, current, {
          modelId,
          signal: controller.signal,
        });
        analysisResultRef.current = res;
        setAnalysisModelId(res.modelId);
        setAnalysisView({ status: 'done', fields: res.fields, imageUrl: ctx.imageUrl });
      } catch (err) {
        if (controller.signal.aborted) {
          setAnalysisView({ status: 'idle' });
          return;
        }
        setAnalysisView({ status: 'error', error: (err as Error).message });
      } finally {
        abortRef.current = null;
      }
    },
    [],
  );

  const saveAnalysis = useCallback(
    async (edited: EditedFields) => {
      const res = analysisResultRef.current;
      const current = settingsRef.current;
      if (!res || !current) return;

      try {
        // 以用户在面板里编辑过的内容为准 —— 他删掉的标签、改过的措辞都该被尊重,
        // 而不是把模型的原始返回原样存进去
        const fields: PromptFields = {
          prompt: edited.prompt,
          negative: edited.negative,
          tags: edited.tags,
          raw: res.fields.raw,
        };

        if (analysisTargetId) {
          // 从详情页发起的反推(比如先「收藏这张图」再补提示词):写回原记录,不新建
          await updateItem(analysisTargetId, {
            title: deriveTitle(fields),
            prompt: fields,
            targetModel: res.modelId,
          });
          // 合并而不是替换 —— 用户之前手打的标签要留着
          if (current.autoCreateTags) await appendTags(analysisTargetId, edited.tags);
        } else {
          // URL 直传时本地并没有图,收藏前补一次下载,保证图片落到用户自己电脑上
          const processed = await ensureLocalImage(analysisCtx, res);

          // 归类来自模型判断;名字对不上系统里的分类就当没归类
          const categoryId = await findCategoryByName(res.fields.category);

          await createItem({
            title: deriveTitle(fields),
            source: 'image',
            prompt: fields,
            targetModel: res.modelId,
            categoryId,
            imageBlob: processed?.original,
            thumbnailBlob: processed?.thumbnail,
            imageUrl: analysisCtx.imageUrl,
            width: processed?.width,
            height: processed?.height,
            sourceUrl: analysisCtx.pageUrl,
            sourceTitle: analysisCtx.pageTitle,
            sourceSite: res.sourceSite,
            tagNames: current.autoCreateTags ? edited.tags : [],
          });
        }

        analysisResultRef.current = null;
        setAnalysisView({ status: 'idle' });
      } catch (err) {
        setAnalysisView({ status: 'error', error: t('analyze.saveFailed', { message: (err as Error).message }) });
      }
    },
    [analysisCtx, analysisTargetId],
  );

  // ---------------------------- 右键菜单投递的任务 ----------------------------

  const handleTask = useCallback(
    (task: PendingTask) => {
      // 右键唤出的选图:直接把图片列表铺开,省掉「先开面板、再点一次按钮」
      if (task.kind === 'pick') {
        setView('library');
        collectPageImages().then(setPageImages);
        return;
      }

      if (task.kind === 'image' && task.imageUrl) {
        setView('library');
        runAnalyze({
          imageUrl: task.imageUrl,
          pageUrl: task.pageUrl,
          pageTitle: task.pageTitle,
        });
        return;
      }

      if (task.kind === 'text' && task.text) {
        // 文字收藏不过模型:用户选中的往往已经是整理好的提示词,再过一遍只会画蛇添足
        createItem({
          title: task.text.slice(0, 40),
          source: 'text',
          prompt: textOnlyFields(task.text),
          sourceUrl: task.pageUrl,
          sourceTitle: task.pageTitle,
          sourceSite: siteOf(task.pageUrl),
        }).then((item) => setDetailId(item.id));
      }
    },
    [runAnalyze],
  );

  useEffect(() => {
    if (!settings) return; // 等设置就绪,避免误报「未配置」

    const consume = async () => {
      const raw = await chrome.storage.session.get(PENDING_TASK_KEY);
      const task = raw[PENDING_TASK_KEY] as PendingTask | undefined;
      if (!task) return;
      // 先清掉再处理,防止组件重挂载时重复执行
      await chrome.storage.session.remove(PENDING_TASK_KEY);
      handleTask(task);
    };

    // 这里监听的是 storage.session.onChanged,它只回调 changes,没有 area 参数
    //(带 area 的是总的 chrome.storage.onChanged)
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[PENDING_TASK_KEY]?.newValue) consume();
    };

    chrome.storage.session.onChanged.addListener(onChanged);
    consume(); // 侧边栏刚被打开时,任务已经在 session 里等着了

    return () => chrome.storage.session.onChanged.removeListener(onChanged);
  }, [settings, handleTask]);

  // ---------------------------- 页面选图 ----------------------------

  const pickFromPage = async () => {
    setSelectedUrls([]);
    setPageImages(await collectPageImages());
  };

  const toggleSelectUrl = (url: string) => {
    setSelectedUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  };

  const startBatch = async () => {
    const urls = [...selectedUrls];
    if (!urls.length) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setPageImages(null);
    setSelectedUrls([]);

    // 只选一张时走单张预览流程,保留「看一眼再入库」的体验;
    // 多张才进批量队列 —— 逐张确认在批量场景下不现实
    const first = urls[0];
    if (urls.length === 1 && first) {
      const picked = pageImages?.find((p) => p.src === first);
      runAnalyze({
        imageUrl: first,
        width: picked?.width,
        height: picked?.height,
        pageUrl: tab?.url,
        pageTitle: tab?.title,
      });
      return;
    }

    const res = (await chrome.runtime.sendMessage({
      type: 'startBatch',
      urls,
      pageUrl: tab?.url,
      pageTitle: tab?.title,
    })) as { ok: boolean; error?: string };

    if (!res?.ok) {
      setToast(res?.error ?? t('batch.startFailed'));
      return;
    }
    setShowBatch(true);
  };

  const toggleTag = (id: string) => {
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  // ---------------------------- 渲染 ----------------------------

  return (
    <div className="relative flex h-screen flex-col bg-canvas text-ink">
      <header className="flex items-center gap-1.5 border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">
        <span className="font-brand text-[15px] leading-none tracking-wide">Promptary</span>

        <div className="flex-1" />

        {/* 顺序即使用频率:选图 → 库 → 回收站 → 设置。
            当前所在的位置用朱砂色标出来,用户一眼知道自己在哪 */}
        <button
          type="button"
          onClick={() => {
            if (pageImages) {
              setPageImages(null);
              setSelectedUrls([]);
            } else {
              setView('library');
              void pickFromPage();
            }
          }}
          className={headerBtn(inPicker)}
          title={t('app.pickImage')}
        >
          <IconGrid />
        </button>
        <button
          type="button"
          onClick={() => {
            // 这两个视图会占住主区域,不一起收掉的话,库视图仍被让位条件挡着
            setPageImages(null);
            setDetailId(undefined);
            setView('library');
          }}
          className={headerBtn(inLibrary)}
          title={t('app.library')}
        >
          <IconLibrary />
        </button>
        <button
          type="button"
          onClick={() => setView('trash')}
          className={headerBtn(view === 'trash')}
          title={t('app.trash')}
        >
          <IconTrash />
        </button>
        <button
          type="button"
          onClick={() => setView('settings')}
          className={headerBtn(view === 'settings')}
          title={t('app.settings')}
        >
          <IconSettings />
        </button>
      </header>

      {view === 'settings' ? (
        settings ? (
          <SettingsPanel settings={settings} onChanged={reloadSettings} />
        ) : (
          <div className="flex-1 p-4 text-[11px] text-neutral-400">{t('common.loading')}</div>
        )
      ) : view === 'trash' ? (
        <TrashPanel />
      ) : // 选图面板和详情页此时会占满剩余空间,库视图要让位 ——
      // 三者同时渲染的话,它们会挤在库下面而不是替换库
      pageImages || detailId ? null : (
        <>
          <div className="flex items-center gap-1.5 border-b border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
            <div className="relative min-w-0 flex-1">
              <IconSearch className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t('search.placeholder')}
                className="w-full rounded-md border border-neutral-300 bg-transparent py-1.5 pl-7 pr-2 text-[11px] outline-none focus:border-accent dark:border-neutral-700"
              />
            </div>

            {/* 批量选择和筛选是一类操作,放在这里比挤在顶栏更顺 */}
            <Button
              size="sm"
              square
              variant={selectMode ? 'accent' : 'secondary'}
              onClick={() => {
                setSelectMode((v) => !v);
                setSelectedIds([]);
              }}
              title={selectMode ? t('app.exitSelect') : t('app.select')}
              icon={<IconCheckSquare />}
            />
          </div>

          {(tree.length > 0 || (tags && tags.length > 0)) && (
            <div className="border-b border-neutral-200 dark:border-neutral-800">
              {tree.length > 0 && (
                <div className="flex gap-1 overflow-x-auto px-2 pt-1.5 pb-1">
                  <Chip
                    active={!categoryId && !uncategorized}
                    onClick={() => {
                      setCategoryId(undefined);
                      setUncategorized(false);
                    }}
                  >
                    {t('filter.all')}
                  </Chip>
                  {tree.map((c) => (
                    <Chip
                      key={c.id}
                      active={categoryId === c.id}
                      onClick={() => {
                        setCategoryId(c.id);
                        setUncategorized(false);
                      }}
                    >
                      {categoryLabel(c.name)}
                      {c.total > 0 && <span className="ml-1 text-neutral-400">{c.total}</span>}
                    </Chip>
                  ))}
                  <Chip
                    active={uncategorized}
                    onClick={() => {
                      setUncategorized(true);
                      setCategoryId(undefined);
                    }}
                  >
                    {t('filter.uncategorized')}
                  </Chip>
                  <Button
                    size="xs"
                    square
                    variant="ghost"
                    onClick={() => setShowCategoryManager(true)}
                    title={t('filter.manageCategories')}
                    icon={<IconSliders className="h-3 w-3" />}
                  />
                </div>
              )}

              {tags && tags.length > 0 && (
                <div className="flex gap-1 overflow-x-auto px-2 pb-1.5">
                  {tags.slice(0, 24).map((t) => (
                    <Chip key={t.id} active={selectedTags.includes(t.id)} onClick={() => toggleTag(t.id)}>
                      {t.name}
                      <span className="ml-1 text-neutral-400">{t.count}</span>
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          )}

          <main className="flex-1 overflow-y-auto p-2">
            {!items?.length ? (
              <EmptyState hasFilter={Boolean(keyword || categoryId || uncategorized || selectedTags.length)} />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
                {items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    onOpen={(i) => setDetailId(i.id)}
                    onDelete={(i) => softDeleteItem(i.id)}
                    onToggleStar={(i) => toggleStar(i.id)}
                    selectMode={selectMode}
                    selected={selectedIds.includes(item.id)}
                    onToggleSelect={(i) =>
                      setSelectedIds((prev) =>
                        prev.includes(i.id) ? prev.filter((x) => x !== i.id) : [...prev, i.id],
                      )
                    }
                  />
                ))}
              </div>
            )}
          </main>

          {selectMode && (
            <div className="flex items-center gap-2 border-t border-neutral-200 p-2 dark:border-neutral-800">
              <Button
                size="sm"
                icon={<IconCheck />}
                onClick={() =>
                  setSelectedIds(
                    selectedIds.length === items?.length ? [] : (items ?? []).map((i) => i.id),
                  )
                }
              >
                {selectedIds.length === items?.length && selectedIds.length > 0
                  ? t('select.deselectAll') : t('select.all')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                className="flex-1"
                disabled={!selectedIds.length}
                icon={<IconTrash />}
                onClick={async () => {
                  // 同样是软删除,可恢复,不弹确认
                  for (const id of selectedIds) await softDeleteItem(id);
                  setSelectedIds([]);
                  setSelectMode(false);
                }}
              >
                {t('select.deleteN', { count: selectedIds.length })}
              </Button>
            </div>
          )}
        </>
      )}

      {showCategoryManager && (
        <CategoryManager onClose={() => setShowCategoryManager(false)} />
      )}

      {view === 'library' && detailId && categories && tags && (
        <ItemDetail
          itemId={detailId}
          categories={categories}
          tags={tags}
          onClose={() => setDetailId(undefined)}
          defaultModelId={settings?.defaultModelId ?? 'gpt-image'}
          onAnalyze={(item, modelId) => {
            // 先收起详情,让结果面板露出来
            setDetailId(undefined);
            runAnalyze(
              {
                imageUrl: item.imageUrl,
                width: item.width,
                height: item.height,
                // 优先用本地图:外部图床可能已经挂掉或加了防盗链
                imageBlob: item.imageBlob,
                pageUrl: item.sourceUrl,
                pageTitle: item.sourceTitle,
              },
              modelId,
              item.id,
            );
          }}
        />
      )}

      {view === 'library' && pageImages && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-2">
            {pageImages.length === 0 ? (
              <p className="p-3 text-[11px] leading-relaxed text-neutral-400">
                {t('picker.empty')}
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                {pageImages.map((img) => {
                  const selected = selectedUrls.includes(img.src);
                  return (
                    <button
                      key={img.src}
                      type="button"
                      onClick={() => toggleSelectUrl(img.src)}
                      className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-colors ${
                        selected
                          ? 'border-accent'
                          : 'border-transparent hover:border-neutral-300 dark:hover:border-neutral-700'
                      }`}
                    >
                      <img
                        src={img.src}
                        alt={img.alt}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                      {selected && (
                        <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] text-white">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-neutral-200 p-2 dark:border-neutral-800">
            <Button
              size="sm"
              square
              className="h-7"
              onClick={() =>
                setSelectedUrls(
                  selectedUrls.length === pageImages.length ? [] : pageImages.map((i) => i.src),
                )
              }
              title={
                selectedUrls.length === pageImages.length && pageImages.length > 0
                  ? t('select.deselectAll')
                  : t('select.all')
              }
              icon={<IconCheck />}
            />
            <Button
              variant="primary"
              className="h-7 flex-1"
              disabled={!selectedUrls.length}
              icon={<IconSparkle />}
              onClick={startBatch}
            >
              {selectedUrls.length === 1 ? t('picker.analyzeOne') : t('picker.analyzeN', { count: selectedUrls.length })}
            </Button>
          </div>
        </div>
      )}

      <AnalyzeOverlay
        state={analysisView}
        modelId={analysisModelId}
        sourceWidth={analysisDims.w}
        sourceHeight={analysisDims.h}
        updating={Boolean(analysisTargetId)}
        onCancel={() => abortRef.current?.abort()}
        onSave={saveAnalysis}
        onDismiss={() => {
          analysisResultRef.current = null;
          setAnalysisView({ status: 'idle' });
        }}
        onRegenerate={(id) => runAnalyze(analysisCtx, id, analysisTargetId)}
      />

      {showBatch && <BatchProgress onClose={() => setShowBatch(false)} />}

      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-3 py-1.5 text-[11px] text-canvas shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/**
 * 向当前标签页要一份图片清单。
 *
 * 抽成模块级函数而不是 useCallback:右键任务回调和「页内选图」按钮都要用它,
 * 放外面就不必把它塞进 handleTask 的依赖数组,省掉一堆依赖顺序的麻烦。
 */
async function collectPageImages(): Promise<PageImage[]> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return [];

  try {
    const imgs = (await chrome.tabs.sendMessage(tab.id, {
      type: 'collectImages',
    })) as PageImage[];
    return imgs ?? [];
  } catch {
    // 扩展刚装好、或页面不允许注入时,页面里还没有 content script
    return [];
  }
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] transition-colors ${
        active
          ? 'bg-accent text-white'
          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
      <p className="text-[11px] text-neutral-400">
        {hasFilter ? t('empty.noMatch') : t('empty.noItems')}
      </p>
      {!hasFilter && (
        <p className="text-[10px] leading-relaxed text-neutral-400">
          {t('empty.hint')}
        </p>
      )}
    </div>
  );
}
