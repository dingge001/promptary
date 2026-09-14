import { initDefaultData } from '@/lib/db';
import { detectLocale, setLocale, t } from '@/lib/i18n';
import { createItem, findCategoryByName } from '@/lib/db/repo';
import type { AppSettings } from '@/lib/db/types';
import {
  BATCH_JOB_KEY,
  PENDING_TASK_KEY,
  type AnalyzedPayload,
  type BackgroundRequest,
  type BackgroundResponse,
  type BatchJob,
  type PendingTask,
} from '@/lib/messages';
import { getSettings, isProviderReady, SETTINGS_STORAGE_KEY } from '@/lib/settings';
import { analyzeImage, ensureLocalImage } from '@/lib/vision/analyze';
import { siteOf } from '@/lib/vision/image';

/**
 * 后台脚本。
 *
 * 职责刻意保持很窄:建右键菜单、把任务投递给侧边栏。
 * 真正的模型调用放在侧边栏里做 —— 这样进度对用户天然可见,
 * 不必再搭一套「后台跑任务 + 往前端推进度」的消息机制。
 *
 * 代价是侧边栏关闭会中断分析。等 V1.5 接入批量反推时,
 * 再把长任务迁到 offscreen document。
 */
export default defineBackground(() => {
  // 首次安装时准备内置分类,失败不应阻断扩展启动
  initDefaultData().catch((err) => console.error('[promptary] 初始化数据失败', err));

  // 点击工具栏图标直接开侧边栏,而不是弹一个一失焦就关的 popup
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('[promptary] 设置侧边栏行为失败', err));

  // 先定语言再建菜单 —— 菜单标题是创建时固定的,顺序反了就是错的
  void refreshMenu();

  // 用户改了界面语言要重建菜单,标题不会自己更新
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_STORAGE_KEY]) void refreshMenu();
  });
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'promptary-open-panel') {
      await openPanel(tab?.id);
      return;
    }

    // 「反推本页图片」不在这里直接干活,而是把选图界面推给侧边栏 ——
    // 省掉「先开面板,再点一次页内选图」那一步
    if (info.menuItemId === 'promptary-pick-image') {
      const pickTask: PendingTask = {
        id: crypto.randomUUID(),
        kind: 'pick',
        pageUrl: info.pageUrl ?? tab?.url,
        pageTitle: tab?.title,
        createdAt: Date.now(),
      };
      // 先开面板再写任务。sidePanel.open() 必须在用户手势有效期内调用,
      // 而 await 一次 storage 之后手势就可能失效,面板会打不开 ——
      // 这条顺序不能颠倒。
      const opening = openPanel(tab?.id);
      await chrome.storage.session.set({ [PENDING_TASK_KEY]: pickTask });
      await opening;
      return;
    }

    // 右键反推:交给页面内的结果面板执行,和悬停按钮走同一套 UI ——
    // 同一个功能不该有两种长得不一样的界面
    if (info.menuItemId === 'promptary-analyze-image') {
      if (info.srcUrl) await analyzeInPage(tab?.id, info.srcUrl);
      return;
    }

    // 「收藏这张图」只存图,不调模型 ——
    // 菜单上写着「收藏」却偷偷花掉一次 API 费用,既误导又没必要
    if (info.menuItemId === 'promptary-save-image') {
      if (info.srcUrl) await saveImageOnly(info.srcUrl);
      return;
    }

    // 剩下的是文字收藏:直接入库,本来就不需要模型
    const task: PendingTask = {
      id: crypto.randomUUID(),
      kind: 'text',
      text: info.selectionText,
      pageUrl: info.pageUrl ?? tab?.url,
      pageTitle: tab?.title,
      createdAt: Date.now(),
    };

    // 同上:先开面板,再写任务
    const opening = openPanel(tab?.id);
    await chrome.storage.session.set({ [PENDING_TASK_KEY]: task });
    await opening;
  });

  // 页面内 UI(悬停按钮 / 快捷键)发来的请求。
  // 模型调用必须在这里做 —— content script 的 fetch 受页面 CORS 约束,直接调会被拦。
  chrome.runtime.onMessage.addListener(
    (msg: BackgroundRequest, _sender, sendResponse: (r: BackgroundResponse) => void) => {
      if (msg?.type === 'analyzeFromPage') {
        handleAnalyzeFromPage(msg).then(sendResponse);
        return true; // 异步响应,必须返回 true 把消息通道留住
      }
      if (msg?.type === 'saveFromPage') {
        handleSaveFromPage(msg).then(sendResponse);
        return true;
      }
      if (msg?.type === 'startBatch') {
        handleStartBatch(msg).then(sendResponse);
        return true;
      }
      if (msg?.type === 'cancelBatch') {
        handleCancelBatch().then(sendResponse);
        return true;
      }
      return false;
    },
  );
});

// ============================ 右键菜单触发的操作 ============================

/**
 * 让页面内的结果面板执行反推。
 *
 * 走页面内面板而不是侧边栏,是为了和悬停按钮保持一致。
 * 侧边栏那条路根本走不通:sidePanel.open() 要求用户手势,
 * 而内容脚本转发过来的调用已经没有手势了。
 */
async function analyzeInPage(tabId: number | undefined, imageUrl: string): Promise<void> {
  if (tabId == null) return;

  const message = { type: 'analyzeInPage' as const, imageUrl };

  try {
    await chrome.tabs.sendMessage(tabId, message);
    return;
  } catch {
    // 内容脚本还没注入(扩展刚装或刚更新时打开的老页面),动态补一次再重试
  }

  try {
    // 这个路径由 WXT 按入口文件名生成,改 entrypoints/content.ts 的名字时要同步改这里
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/content.js'],
    });
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    console.warn('[promptary] 无法在页面内反推,请刷新页面后重试', err);
  }
}

/** 右键「收藏这张图」:只把图片存进库,不调用模型 */
async function saveImageOnly(imageUrl: string): Promise<void> {
  try {
    const processed = await ensureLocalImage({ imageUrl });

    await createItem({
      title: t('item.untitled'),
      source: 'image',
      imageUrl,
      imageBlob: processed?.original,
      thumbnailBlob: processed?.thumbnail,
      width: processed?.width,
      height: processed?.height,
      sourceSite: siteOf(imageUrl),
      tagNames: [],
    });

    await flashBadge('✓', '#16a34a');
  } catch (err) {
    console.warn('[promptary] 收藏图片失败', err);
    await flashBadge('!', '#dc2626');
  }
}

/**
 * 在扩展图标上闪一下结果。
 *
 * Service Worker 里没有页面可以弹提示,徽标是最轻的反馈方式 ——
 * 不给任何反馈的话,用户根本不知道刚才那下点没点上。
 */
async function flashBadge(text: string, color: string): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' }).catch(() => {});
    }, 2000);
  } catch {
    /* 徽标不可用不影响主流程 */
  }
}

// ============================ 页面内请求处理 ============================

async function handleAnalyzeFromPage(
  msg: Extract<BackgroundRequest, { type: 'analyzeFromPage' }>,
): Promise<BackgroundResponse<AnalyzedPayload>> {
  const settings = await getSettings();

  if (!isProviderReady(settings)) {
    return {
      ok: false,
      error: t('analyze.noProvider'),
    };
  }

  try {
    const result = await analyzeImage(
      { imageUrl: msg.imageUrl, pageUrl: msg.pageUrl, pageTitle: msg.pageTitle },
      settings,
      { modelId: msg.modelId },
    );
    return {
      ok: true,
      data: {
        fields: result.fields,
        title: result.title,
        modelId: result.modelId,
        sourceSite: result.sourceSite,
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function handleSaveFromPage(
  msg: Extract<BackgroundRequest, { type: 'saveFromPage' }>,
): Promise<BackgroundResponse> {
  const settings = await getSettings();

  try {
    // 走 URL 直传时本地并没有图,收藏前补一次下载 ——
    // 用户要的是图片落在自己电脑上,不能只存个网址
    const processed = await ensureLocalImage({
      imageUrl: msg.imageUrl,
      pageUrl: msg.pageUrl,
      pageTitle: msg.pageTitle,
    });

    await createItem({
      title: msg.title,
      source: 'image',
      prompt: msg.fields,
      // 面板里换过模型的话以它为准,没换就是默认模型
      targetModel: msg.modelId ?? settings.defaultModelId,
      categoryId: await findCategoryByName(msg.fields.category),
      imageBlob: processed?.original,
      thumbnailBlob: processed?.thumbnail,
      imageUrl: msg.imageUrl,
      width: processed?.width,
      height: processed?.height,
      sourceUrl: msg.pageUrl,
      sourceTitle: msg.pageTitle,
      sourceSite: siteOf(msg.pageUrl),
      tagNames: settings.autoCreateTags ? msg.fields.tags : [],
    });

    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ============================ 批量反推 ============================

async function loadBatchJob(): Promise<BatchJob | undefined> {
  const raw = await chrome.storage.session.get(BATCH_JOB_KEY);
  return raw[BATCH_JOB_KEY] as BatchJob | undefined;
}

async function saveBatchJob(job: BatchJob): Promise<void> {
  await chrome.storage.session.set({ [BATCH_JOB_KEY]: job });
}

async function handleStartBatch(
  msg: Extract<BackgroundRequest, { type: 'startBatch' }>,
): Promise<BackgroundResponse<BatchJob>> {
  const settings = await getSettings();
  if (!isProviderReady(settings)) {
    return { ok: false, error: t('analyze.noProvider') };
  }
  if (!msg.urls.length) {
    return { ok: false, error: t('batch.noImages') };
  }

  // 同一时间只允许一个批量任务,否则两个循环会互相覆盖进度
  const existing = await loadBatchJob();
  if (existing?.status === 'running') {
    return { ok: false, error: t('batch.alreadyRunning') };
  }

  const job: BatchJob = {
    id: crypto.randomUUID(),
    status: 'running',
    total: msg.urls.length,
    done: 0,
    saved: 0,
    failed: [],
    startedAt: Date.now(),
  };
  await saveBatchJob(job);

  // 故意不 await:任务在后台自己跑,侧边栏靠监听 storage.session 看进度。
  // 每处理一张都写一次 storage —— 这既更新了进度,也顺带让 Service Worker
  // 始终有活动,MV3 的空闲回收就不会在半路把它干掉。
  void runBatch(job, msg, settings);

  return { ok: true, data: job };
}

async function handleCancelBatch(): Promise<BackgroundResponse> {
  const job = await loadBatchJob();
  if (job?.status === 'running') {
    // 只改状态,由 runBatch 循环自己发现并停下 ——
    // 后台无法从外部打断一个正在进行中的 fetch
    await saveBatchJob({ ...job, status: 'cancelled' });
  }
  return { ok: true, data: null };
}

/**
 * 同时处理几张图。
 *
 * 不设成 1(太慢)也不设成无限(几乎必然触发服务商限流,反而更容易失败)。
 * 3 是常见模型服务的舒适区,遇到 429 说明该调小。
 */
const BATCH_CONCURRENCY = 3;

async function runBatch(
  job: BatchJob,
  msg: Extract<BackgroundRequest, { type: 'startBatch' }>,
  settings: AppSettings,
): Promise<void> {
  const ctx = { pageUrl: msg.pageUrl, pageTitle: msg.pageTitle };
  const queue = [...msg.urls];
  let cursor = 0;

  // 几个 worker 并行取任务。JS 单线程,所以 cursor++ 和 job.done++ 不会有竞态,
  // 真正需要小心的是别让并发数失控 —— 那会招来服务商的限流。
  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      const url = queue[cursor++];
      if (!url) return;

      // 每轮重读一次,才能感知到用户中途点了「取消」
      const fresh = await loadBatchJob();
      if (fresh?.status === 'cancelled') {
        job.status = 'cancelled';
        return;
      }

      try {
        const result = await analyzeImage({ imageUrl: url, ...ctx }, settings);
        const processed = await ensureLocalImage({ imageUrl: url, ...ctx }, result);

        await createItem({
          title: result.title,
          source: 'image',
          prompt: result.fields,
          targetModel: result.modelId,
          categoryId: await findCategoryByName(result.fields.category),
          imageBlob: processed?.original,
          thumbnailBlob: processed?.thumbnail,
          imageUrl: url,
          width: processed?.width,
          height: processed?.height,
          sourceUrl: msg.pageUrl,
          sourceTitle: msg.pageTitle,
          sourceSite: result.sourceSite,
          tagNames: settings.autoCreateTags ? result.fields.tags : [],
        });

        job.saved++;
      } catch (err) {
        // 单张失败不该中断整批,记下来继续跑
        if (job.failed.length < 20) {
          job.failed.push({ url, error: (err as Error).message });
        }
      }

      job.done++;
      await saveBatchJob(job);
    }
  };

  try {
    // 起若干个 worker 一起跑。取并发数和任务数的较小值,避免为两张图开三个 worker
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, queue.length) }, () => worker()),
    );
    if (job.status === 'running') job.status = 'done';
  } catch (err) {
    job.status = 'error';
    job.error = (err as Error).message;
  } finally {
    job.finishedAt = Date.now();
    await saveBatchJob(job);
  }
}

/**
 * 打开侧边栏。
 * sidePanel.open() 必须在用户手势中调用,右键菜单点击满足这个条件;
 * 万一失败(旧版浏览器),退回到打开扩展弹窗,至少不让操作石沉大海。
 */
async function openPanel(tabId?: number): Promise<void> {
  try {
    if (tabId != null) {
      await chrome.sidePanel.open({ tabId });
      return;
    }
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.id != null) await chrome.sidePanel.open({ tabId: active.id });
  } catch (err) {
    console.warn('[promptary] 打开侧边栏失败,尝试打开弹窗', err);
    await chrome.action.openPopup?.().catch(() => {});
  }
}

/**
 * 按当前界面语言重建右键菜单。
 *
 * 每次 Service Worker 启动都要跑一遍,而不是只在 onInstalled 里建一次 ——
 * MV3 的 SW 会被随时终止,onInstalled 不再触发,改了菜单定义却看不到变化
 * 就是这么来的。语言切换同理,标题不会自己跟着变,只能重建。
 */
async function refreshMenu(): Promise<void> {
  const settings = await getSettings();
  setLocale(settings.locale === 'auto' ? detectLocale() : settings.locale);

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'promptary-analyze-image',
      title: t('menu.analyzeImage'),
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: 'promptary-save-image',
      title: t('menu.saveImage'),
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: 'promptary-save-text',
      title: t('menu.saveText'),
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'promptary-pick-image',
      title: t('menu.pickImage'),
      contexts: ['page', 'selection'],
    });
    // 用 all 而不是 page:在图片、链接、选中文字上右键时也应该能打开面板 ——
    // 之前的 'page' 只在页面空白处出现,用户在图片上右键就找不到入口
    chrome.contextMenus.create({
      id: 'promptary-open-panel',
      title: t('menu.openPanel'),
      contexts: ['all'],
    });
  });
}