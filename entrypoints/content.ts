import { debugLog } from '@/lib/inpage/debug';
import { createHoverButton } from '@/lib/inpage/hover-button';
import { createResultPanel } from '@/lib/inpage/result-panel';
import {
  IMAGE_WATCH_PORT,
  type AnalyzedPayload,
  type BackgroundResponse,
  type ImagesUpdatedMessage,
  type PageImage,
  type TabCommand,
} from '@/lib/messages';
import { detectLocale, setLocale, t } from '@/lib/i18n';
import { SETTINGS_STORAGE_KEY } from '@/lib/settings';
import { formatDimensions } from '@/lib/vision/image';
import { deriveTitle } from '@/lib/vision/schema';

/**
 * 内容脚本。承担三件后台做不到的事:
 *   1. 读页面 DOM —— 采集可反推的图片列表
 *   2. 写页面 DOM —— 把提示词注入生图工具的输入框
 *   3. 页面内交互 —— 图片悬停按钮、快捷键、反推结果面板
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main() {
    // 右键反推在页面缺少内容脚本时会动态注入本文件,同一页面可能跑两次。
    // 重复注册监听器会让按钮闪烁、把模型调用两次,这里挡一道。
    const flag = '__promptaryContentReady';
    const scope = window as unknown as Record<string, unknown>;
    if (scope[flag]) return;
    scope[flag] = true;

    listenToExtension();
    setupInPageUI();
  },
});

/**
 * 取原图尺寸,用于在结果面板里提示比例。
 * 悬停按钮那条路径手上就有 img 元素,直接读;右键来的只有 URL,得加载一次 ——
 * 多半命中浏览器缓存,成本很低。
 */
function resolveImageSize(
  target: HTMLImageElement | string,
  imageUrl: string,
): Promise<{ w: number; h: number } | undefined> {
  if (typeof target !== 'string' && target.naturalWidth > 0) {
    return Promise.resolve({ w: target.naturalWidth, h: target.naturalHeight });
  }
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
    probe.onerror = () => resolve(undefined);
    probe.src = imageUrl;
  });
}

/** 由 setupInPageUI 赋值,供右键菜单触发的反推调用 */
let analyzeInPage: ((imageUrl: string) => void) | null = null;

// ============================ 与扩展其他部分通信 ============================

function listenToExtension(): void {
  chrome.runtime.onMessage.addListener(
    (msg: TabCommand, _sender, sendResponse: (r: unknown) => void) => {
      if (msg?.type === 'collectImages') {
        sendResponse(collectImages());
      } else if (msg?.type === 'insertPrompt') {
        sendResponse(insertPrompt(msg.text));
      } else if (msg?.type === 'analyzeInPage') {
        // 右键菜单触发的反推,走和悬停按钮同一套页面内面板
        analyzeInPage?.(msg.imageUrl);
      }
      return false;
    },
  );

  // 选图面板通过长连接盯住本页图片:连上就开盯,断开就收工
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== IMAGE_WATCH_PORT) return;

    watchPorts.add(port);
    startWatchingImages();

    // 新面板连上时先给它一份当前快照,不必等第一次 DOM 变化才有内容。
    // 多个侧边栏同时开着时会重复发一轮,但合并在侧边栏侧是幂等的,不值得为它加分支
    pushImages(true);

    port.onDisconnect.addListener(() => {
      watchPorts.delete(port);
      if (watchPorts.size === 0) stopWatchingImages();
    });
  });
}

// ============================ 图片变化监听 ============================

/**
 * 选图面板打开期间,持续把页面图片清单推给侧边栏。
 *
 * 为什么不反过来让侧边栏定时来拉:轮询要么慢(用户滚完还得等下一拍),
 * 要么勤(每轮都要遍历全部 img 并读 getBoundingClientRect,那是强制重排,
 * 几百张图的页面上每秒跑一次很贵)。改成页面侧盯住变化、有变化才推,两边都省。
 */

/** 变化合并窗口。滚动和懒加载是连成串触发的,攒一下再算,免得中间态白跑好几轮 */
const WATCH_DEBOUNCE_MS = 300;

/** 正在盯这块页面的面板。多窗口可以同时开多个侧边栏,所以是个集合 */
const watchPorts = new Set<chrome.runtime.Port>();

interface Watcher {
  observer: MutationObserver;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** 上轮推送的内容。null 表示还没推过 —— 别用空字符串,那会把「空页面」误判成「没变化」 */
  fingerprint: string | null;
  onLoad: () => void;
  onScroll: () => void;
}

let watcher: Watcher | null = null;

/** 内容指纹。只需能分辨两轮采集是否一致,不必可逆 */
function fingerprintOf(images: PageImage[]): string {
  return images.map((img) => `${img.src} ${img.width}x${img.height}`).join('\n');
}

/**
 * 推一次当前快照。
 *
 * force 用于「有面板刚连上」:那时指纹没变,但它还没拿到过任何数据。
 */
function pushImages(force = false): void {
  if (!watcher || watchPorts.size === 0) return;

  const images = collectImages();
  const fingerprint = fingerprintOf(images);
  if (!force && fingerprint === watcher.fingerprint) return;
  watcher.fingerprint = fingerprint;

  for (const port of watchPorts) {
    try {
      port.postMessage({ images } satisfies ImagesUpdatedMessage);
    } catch {
      // 端口正在断开,onDisconnect 马上会来收尾,这里不必管
    }
  }
}

function schedulePush(): void {
  if (!watcher) return;
  clearTimeout(watcher.timer);
  watcher.timer = setTimeout(() => pushImages(), WATCH_DEBOUNCE_MS);
}

function startWatchingImages(): void {
  if (watcher) return; // 已经在盯了,再来一个面板不必重复挂监听

  const observer = new MutationObserver(schedulePush);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    // 只盯能改变「图片地址」的属性。刻意不含 class / style ——
    // 动画和 hover 会让它们疯狂变化,却完全不影响采集结果
    attributes: true,
    attributeFilter: [
      'src',
      'srcset',
      'data-src',
      'data-original',
      'data-lazy-src',
      'data-actualsrc',
    ],
  });

  // 懒加载有一半是「src 没动、浏览器自己把图拉下来了」,属性上留不下痕迹,
  // 但 load 事件会响。capture 才收得到 img 的 load —— 它不冒泡
  const onLoad = () => schedulePush();
  document.addEventListener('load', onLoad, true);

  // 触底加载更多。capture 是为了收到站点内部滚动容器的滚动:
  // 很多图站整页高度是固定的,真正在滚的是里面那个 div
  const onScroll = () => schedulePush();
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });

  watcher = { observer, timer: undefined, fingerprint: null, onLoad, onScroll };
}

function stopWatchingImages(): void {
  if (!watcher) return;

  watcher.observer.disconnect();
  clearTimeout(watcher.timer);
  document.removeEventListener('load', watcher.onLoad, true);
  window.removeEventListener('scroll', watcher.onScroll, true);
  watcher = null;
}

// ============================ 页面内 UI ============================

function setupInPageUI(): void {
  const panel = createResultPanel();

  // 连着点两下按钮会重复调用模型,白花两份钱,这里挡一道
  let busy = false;

  async function runAnalyze(target: HTMLImageElement | string, modelId?: string): Promise<void> {
    if (busy) return;
    busy = true;

    // 面板马上要弹出来了,先把悬停按钮收掉 ——
    // 此刻鼠标通常还停在原地不会触发 mouseover,按钮会一直留在面板上面
    hover.hide();
    panel.showLoading();

    // 悬停按钮传元素过来:懒加载站点要取 currentSrc,src 常是占位图。
    // 右键菜单和「重新生成」只给得到 URL,直接透传。
    const imageUrl = typeof target === 'string' ? target : target.currentSrc || target.src;

    // 尺寸和分析并行取,不额外拖慢流程
    const sizePromise = resolveImageSize(target, imageUrl);

    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'analyzeFromPage',
        imageUrl,
        pageUrl: location.href,
        pageTitle: document.title,
        modelId,
      })) as BackgroundResponse<AnalyzedPayload>;

      if (!res?.ok) {
        panel.showError(res?.error ?? t('inpage.noResponse'));
        return;
      }

      const data = res.data;
      const size = await sizePromise;
      panel.showResult(data, {
        onSave: async (edited) => {
          const fields = {
            prompt: edited.prompt,
            negative: edited.negative,
            tags: edited.tags,
          };

          const saved = (await chrome.runtime.sendMessage({
            type: 'saveFromPage',
            imageUrl,
            pageUrl: location.href,
            pageTitle: document.title,
            title: deriveTitle(fields),
            fields,
            modelId: data.modelId,
          })) as BackgroundResponse;

          if (!saved?.ok) throw new Error(saved?.error ?? t('inpage.saveFailed'));
        },
        // 换模型重推:用同一个图片地址再走一遍
        onRegenerate: (id) => void runAnalyze(imageUrl, id),
      }, formatDimensions(size?.w, size?.h));
    } catch (err) {
      panel.showError((err as Error).message);
    } finally {
      busy = false;
    }
  }

  const hover = createHoverButton((img) => void runAnalyze(img));
  analyzeInPage = (imageUrl) => void runAnalyze(imageUrl);

  // 快捷键:反推鼠标当前所指的图片。
  // 悬停按钮关闭时它依然可用 —— 两条路径互不依赖。
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.shiftKey || e.code !== 'KeyP') return;

    const img = hover.getCurrent();
    if (!img) return;

    e.preventDefault();
    void runAnalyze(img);
  });

  // 悬停按钮开关。设置改动要即时生效,不能让用户改完还得刷新页面
  const applySettings = (value: unknown) => {
    const settings = value as { hoverButton?: boolean; locale?: string } | undefined;
    hover.setEnabled(settings?.hoverButton ?? true);
    // 页面内 UI 不走 React,语言得在这儿自己同步一次
    if (settings?.locale && settings.locale !== 'auto') setLocale(settings.locale as never);
    else setLocale(detectLocale());
  };

  chrome.storage.local.get(SETTINGS_STORAGE_KEY).then((raw) => {
    applySettings(raw?.[SETTINGS_STORAGE_KEY]);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_STORAGE_KEY]) {
      applySettings(changes[SETTINGS_STORAGE_KEY].newValue);
    }
  });

  debugLog('内容脚本已就绪。鼠标移到图片上看按钮,或按 Alt+Shift+P 反推鼠标所指的图');
}

// ============================ 页面 DOM 操作 ============================

/** 小于这个尺寸的一律当图标/装饰图,不当候选 */
const MIN_EDGE = 200;

/**
 * 候选数量上限。
 *
 * 留到 300 是给「滚动加载」留的余量:新图只会追加到列表末尾,上限若卡在
 * 刚好看完一屏的数量,后面滚出来的就再也挤不进来,表现成「滚了也没反应」。
 * 列表里的缩略图是懒加载的,放宽上限不会拖慢打开速度。
 */
const MAX_CANDIDATES = 300;

function collectImages(): PageImage[] {
  const seen = new Set<string>();

  return Array.from(document.images)
    .map((img) => {
      // 懒加载站点的图往往还没真正加载,src 是占位符、naturalWidth 是 0。
      // 依次尝试各个常见的懒加载属性,尽量还原出真实地址。
      const src =
        img.currentSrc ||
        img.src ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-actualsrc') ||
        '';

      // 尺寸同理:没加载出来时 naturalWidth 为 0,退回元素的实际显示尺寸。
      // 早先只用 naturalWidth 判断,导致懒加载图片全被当成小图过滤掉了。
      const rect = img.getBoundingClientRect();
      const width = img.naturalWidth || Math.round(rect.width);
      const height = img.naturalHeight || Math.round(rect.height);

      return { src, width, height, alt: img.alt || '', loaded: img.naturalWidth > 0 };
    })
    .filter((img) => img.src && img.width >= MIN_EDGE && img.height >= MIN_EDGE)
    .filter((img) => {
      if (!img.src || seen.has(img.src)) return false;
      seen.add(img.src);
      return true;
    })
    // 按面积从大到小,用户想要的多半是主图
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, MAX_CANDIDATES);
}

function isEditable(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return ['text', 'search', 'url', 'email', ''].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable;
}

/**
 * 找注入目标:优先当前焦点元素,否则退而求其次找页面上可见面积最大的输入区。
 * 后者对生图工具特别有效 —— 提示词框通常就是页面上最大的那个 textarea。
 */
function findEditable(): HTMLElement | null {
  if (isEditable(document.activeElement)) return document.activeElement;

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'textarea, [contenteditable="true"], input[type="text"], input[type="search"]',
    ),
  ).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 120 && r.height > 20 && r.bottom > 0 && r.top < window.innerHeight;
  });

  if (!candidates.length) return null;

  const largest = candidates.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return rb.width * rb.height - ra.width * ra.height;
  })[0];

  return largest ?? null;
}

/**
 * 写入值并派发事件。
 *
 * 必须走原生 setter:Midjourney、Stable Diffusion WebUI 这类站点用 React/Vue
 * 接管了输入框,直接赋 el.value 会被框架下一次 diff 覆盖掉,表面看是「注入没反应」。
 */
function setNativeValue(el: HTMLElement, value: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  } else {
    el.textContent = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function insertPrompt(text: string): { ok: boolean; message: string } {
  const el = findEditable();
  if (!el) return { ok: false, message: t('detail.noInputBox') };

  el.focus();
  setNativeValue(el, text);
  return { ok: true, message: '已注入' };
}
