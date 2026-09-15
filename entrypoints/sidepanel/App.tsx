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
  IMAGE_WATCH_PORT,
  PENDING_TASK_KEY,
  type BatchJob,
  type ImagesUpdatedMessage,
  type PageImage,
  type PendingTask,
} from '@/lib/messages';
import { categoryLabel, detectLocale, setLocale, t } from '@/lib/i18n';
import { fetchQuota, type QuotaInfo } from '@/lib/providers/builtin';
import { getSettings, isProviderReady } from '@/lib/settings';
import { sendToTab } from '@/lib/tabs';
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
  /** 采集失败的页面(浏览器内置页面之类),与「这页确实没图」要分开提示 */
  const [pickerError, setPickerError] = useState<PickerFailure>();
  /** 选图面板当前盯着的标签页。用户切标签页时改它,监听才会跟着换到新页 */
  const [pickerTabId, setPickerTabId] = useState<number>();
  /** 官方渠道的剩余额度。反推时从响应头捎回来,顶栏在快用完时提示 */
  const [quota, setQuota] = useState<QuotaInfo>();
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

  /**
   * 今日剩余次数。
   *
   * 只在官方渠道下有意义(自带 Key 没有上限),而且只打算在快用完时露脸 ——
   * 平时挂一个「剩 10 次」既占地方,又平白制造焦虑,还会让用户觉得
   * 「这东西是要收费的吧」。
   */
  const quotaLeft =
    settings?.providerMode === 'builtin' && quota
      ? Math.max(0, quota.limit - quota.used)
      : undefined;

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

      // 首次走官方渠道先告知一次,见 ensureDisclosure 的说明
      if (!(await ensureDisclosure(current.providerMode))) return;

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
          onQuota: setQuota,
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

  // ---------------------------- 页面选图 ----------------------------

  /**
   * 打开选图面板:采一份快照,再把「盯住这页图片变化」挂上。
   *
   * 之所以定义在 handleTask 之前:右键唤出的选图也要用它,而 useCallback
   * 的依赖数组是在渲染时就求值的,写到后面会直接撞上 TDZ。
   */
  const pickFromPage = useCallback(async () => {
    // 详情页和选图面板占的是同一块主区域,不清掉详情就会叠在一起
    setDetailId(undefined);
    setSelectedUrls([]);
    const result = await collectPageImages();
    setPageImages(result.images);
    // 采集失败(浏览器内置页面之类)就别记 tabId 了 —— 记了会让下面的 effect
    // 去建一条注定失败的 Port 连接,而那种失败只会变成控制台里一条看不懂的报错
    setPickerTabId(result.failure ? undefined : result.tabId);
    setPickerError(result.failure);
  }, []);

  /** 收起选图面板。三处退出入口共用,免得漏清某一项状态 */
  const closePicker = useCallback(() => {
    setPageImages(null);
    setSelectedUrls([]);
    setPickerError(undefined);
  }, []);

  /**
   * 打开详情。
   *
   * 反过来也要收一次选图面板 —— 从选图进入详情、或在选图面板开着时右键收藏
   * 一段文字,都会走到这里。两套视图的互斥只在入口处保证,渲染层不做兜底。
   */
  const openDetail = useCallback(
    (id: string) => {
      closePicker();
      setDetailId(id);
    },
    [closePicker],
  );

  // ---------------------------- 右键菜单投递的任务 ----------------------------

  const handleTask = useCallback(
    (task: PendingTask) => {
      // 右键唤出的选图:直接把图片列表铺开,省掉「先开面板、再点一次按钮」
      if (task.kind === 'pick') {
        setView('library');
        void pickFromPage();
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
        }).then((item) => openDetail(item.id));
      }
    },
    [runAnalyze, pickFromPage, openDetail],
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

  // ---------------------------- 选图面板内的操作 ----------------------------

  const toggleSelectUrl = (url: string) => {
    setSelectedUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  };

  /**
   * 批量反推前先对一下额度。
   *
   * 只在官方渠道下做:自带 Key 没有每日上限,不必为此多一次网络往返。
   * 返回实际能处理的张数,0 表示不该开始。
   */
  const checkBatchQuota = async (count: number): Promise<number> => {
    if (settings?.providerMode !== 'builtin') return count;

    const quota = await fetchQuota();
    // 查不到就放行 —— 额度查询失败不该阻断用户本来要做的事
    if (!quota) return count;

    const remaining = Math.max(0, quota.limit - quota.used);
    if (remaining === 0) {
      setToast(t('batch.quotaExhausted'));
      return 0;
    }
    if (count <= remaining) return count;

    return confirm(t('batch.quotaLimited', { count, remaining })) ? remaining : 0;
  };

  const startBatch = async () => {
    const pickedUrls = [...selectedUrls];
    if (!pickedUrls.length) return;

    // 官方渠道有每日上限,而批量动辄选十几张。不先对一下数,用户看到的就是
    // 「前几张成功、后面全失败」,而且那些失败还是同一个原因重复 N 遍 ——
    // 最挫败的一类失败:已经投入了操作,却在跑到一半才被告知做不了。
    //
    // 检查放在关面板之前:用户取消时面板还在,选中的东西也没丢。
    if (!(await ensureDisclosure(settings?.providerMode ?? 'custom'))) return;

    const allowed = await checkBatchQuota(pickedUrls.length);
    if (allowed === 0) return;
    const urls = pickedUrls.slice(0, allowed);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    closePicker();

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

    try {
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
    } catch {
      // 后台不可达时 sendMessage 会 reject。不接住的话它就是个未捕获的 rejection,
      // 而用户那边只表现为「点了没反应」—— 那比报错更难查
      setToast(t('batch.startFailed'));
    }
  };

  const toggleTag = (id: string) => {
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  // ---------------------------- 选图面板的生命周期 ----------------------------

  /** 用布尔量而不是 pageImages 本身做依赖:否则每收到一次推送都会断开重连监听 */
  const pickerOpen = pageImages !== null;

  // 盯住当前页的图片增减。滚动加载出来的新图会由页面侧推过来,不必关掉面板重开
  useEffect(() => {
    if (!pickerOpen || pickerTabId == null) return;

    // 用长连接而不是消息:侧边栏被关掉的那一刻连接自动断开,页面侧据此收工。
    // 换成「停止监听」指令的话根本来不及发 —— 面板是被浏览器直接销毁的
    const port = chrome.tabs.connect(pickerTabId, { name: IMAGE_WATCH_PORT });

    port.onMessage.addListener((msg: unknown) => {
      const incoming = msg as ImagesUpdatedMessage | undefined;
      if (!Array.isArray(incoming?.images)) return;

      // 面板没开就原样返回。推送本来只会在开着时来,但不设这道防线的话,
      // 一条迟到的消息会把用户已经关掉的面板重新弹出来
      setPageImages((prev) => (prev === null ? prev : mergeImages(prev, incoming.images)));
      setPickerError(undefined);
    });

    // 必须读一下 lastError。连不上时(页面被关掉、被导航走,或不允许注入)
    // 错误是通过这里报出来的,没人读的话 Chrome 会记一条
    // 「Unchecked runtime.lastError: Could not establish connection」到扩展的错误列表里。
    // 这种情况本身不算异常:上面已经把失败的页面挡掉了,这里只是收个尾。
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
    });

    return () => port.disconnect();
  }, [pickerOpen, pickerTabId]);

  // 切标签页时列表要跟着换页 —— 否则会拿着 A 页的图去反推,而 B 页的图一张都看不见
  useEffect(() => {
    if (!pickerOpen) return;

    const onActivated = async () => {
      setSelectedUrls([]);
      const result = await collectPageImages();
      // 采集期间面板可能已被关掉,那就别再把它写回来
      setPageImages((prev) => (prev === null ? prev : result.images));
      setPickerTabId(result.tabId);
      setPickerError(result.failure);
    };

    chrome.tabs.onActivated.addListener(onActivated);
    return () => chrome.tabs.onActivated.removeListener(onActivated);
  }, [pickerOpen]);

  // ---------------------------- 渲染 ----------------------------

  return (
    <div className="relative flex h-screen flex-col bg-canvas text-ink">
      <header className="flex items-center gap-1.5 border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">
        <span className="font-brand text-[15px] leading-none tracking-wide">Promptary</span>

        {/* 快用完才出现。目标是让「突然用完」变成「早知道快完了」 */}
        {quotaLeft !== undefined && quotaLeft <= 3 && (
          <span
            className="ml-1 shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] text-accent"
            title={t('app.quotaLeftHint')}
          >
            {t('app.quotaLeft', { count: quotaLeft })}
          </span>
        )}

        <div className="flex-1" />

        {/* 顺序即使用频率:选图 → 库 → 回收站 → 设置。
            当前所在的位置用朱砂色标出来,用户一眼知道自己在哪 */}
        <button
          type="button"
          onClick={() => {
            if (pageImages) {
              closePicker();
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
            closePicker();
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
                    onOpen={(i) => openDetail(i.id)}
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
              // 「读不到这页」和「这页没图」给的下一步动作完全不同,不能共用一句提示 ——
              // 前者要用户换个页面,后者要用户往下滚一滚
              <p className="p-3 text-[11px] leading-relaxed text-neutral-400">
                {pickerError ? t('picker.noAccess') : t('picker.empty')}
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

/** 采集失败的原因。和「这一页确实没图」是两回事,提示语完全不同 */
type PickerFailure = 'noTab' | 'noAccess';

interface CollectResult {
  images: PageImage[];
  /** 采集到的标签页。选图面板要靠它把变化监听挂到同一页上 */
  tabId?: number;
  failure?: PickerFailure;
}

/** 已确认过首次告知的标记 */
const DISCLOSURE_KEY = 'promptary_disclosure_ack';

/**
 * 首次使用官方渠道前的一次性告知。
 *
 * Chrome 的政策要求:扩展若要收集数据,必须在**扩展内**、在数据被收集**之前**
 * 明确告知,不能只写在商店页面和隐私政策里。设置页虽然写了,但用户完全可能
 * 一次都没打开过设置就直接反推 —— 所以在这里补一道。
 *
 * 只问一次,确认后记住。走自带 Key 的渠道不涉及数据经过我们,直接放行。
 */
async function ensureDisclosure(mode: AppSettings['providerMode']): Promise<boolean> {
  if (mode !== 'builtin') return true;

  const raw = await chrome.storage.local.get(DISCLOSURE_KEY);
  if (raw[DISCLOSURE_KEY]) return true;

  if (!confirm(t('disclosure.body'))) return false;

  await chrome.storage.local.set({ [DISCLOSURE_KEY]: true });
  return true;
}

/**
 * 向当前标签页要一份图片清单。
 *
 * 抽成模块级函数而不是 useCallback:右键任务回调和「页内选图」按钮都要用它,
 * 放外面就不必把它塞进 handleTask 的依赖数组,省掉一堆依赖顺序的麻烦。
 *
 * 走 sendToTab 而不是直接 sendMessage:页面可能比扩展先加载(扩展刚装、刚重载,
 * 或者页面在这次安装之前就开着),此时页面上没有内容脚本。补注入一次,
 * 用户就不必自己想到「刷新页面」这一步。
 */
async function collectPageImages(): Promise<CollectResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return { images: [], failure: 'noTab' };

  try {
    const images = await sendToTab<PageImage[]>(tab.id, { type: 'collectImages' });
    return { images: images ?? [], tabId: tab.id };
  } catch {
    // 补注入也失败:浏览器内置页面等地址根本不允许扩展注入,这是真的读不到
    return { images: [], tabId: tab.id, failure: 'noAccess' };
  }
}

/**
 * 把新快照并进现有列表:出现过的保持原位,新出现的追加到末尾。
 *
 * 不直接拿快照替换,是因为采集那边每轮都按面积重排 —— 用户滚动加载时
 * 列表会整体跳动,刚勾好的图跑到别处去了。选图这件事上「位置稳定」
 * 比「大图永远排最前」重要得多。
 */
function mergeImages(prev: PageImage[], next: PageImage[]): PageImage[] {
  const pending = new Map(next.map((img) => [img.src, img]));

  const kept: PageImage[] = [];
  for (const img of prev) {
    const updated = pending.get(img.src);
    if (!updated) continue; // 页面上已经没有了,从列表里撤掉
    // 用新数据(尺寸可能刚从占位值变成真实值),但位置一动不动
    kept.push(updated);
    pending.delete(img.src);
  }

  // 剩下的都是这一轮新出现的,按快照里的顺序(面积从大到小)接在后面
  return [...kept, ...pending.values()];
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
