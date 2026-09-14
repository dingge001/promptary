import { debugLog } from '@/lib/inpage/debug';
import { createHoverButton } from '@/lib/inpage/hover-button';
import { createResultPanel } from '@/lib/inpage/result-panel';
import type { AnalyzedPayload, BackgroundResponse, PageImage, TabCommand } from '@/lib/messages';
import { detectLocale, setLocale, t } from '@/lib/i18n';
import { SETTINGS_STORAGE_KEY } from '@/lib/settings';
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
      });
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
    .slice(0, 120);
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
