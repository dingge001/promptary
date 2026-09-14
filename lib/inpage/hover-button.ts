/**
 * 网页图片上的悬停快捷按钮。
 *
 * 两个关键设计:
 * 1. 内容挂在 Shadow DOM 里 —— 各家网站的 CSS 五花八门,不隔离样式的话
 *    按钮会被页面的 reset / 全局选择器搞得面目全非
 * 2. 宿主元素设 pointer-events: none,只有按钮本身接收事件 ——
 *    绝不能在页面上挡出一块「死区」
 */

import { t } from '../i18n';
import { debugLog } from './debug';
import { HOVER_HOST_ID, PANEL_HOST_ID } from './hosts';

const BTN_SIZE = 28;

/**
 * 判断标准以「用户实际看到的尺寸」为准,而不是图片的原始分辨率 ——
 * 一张 4000px 的原图被缩到 150px 显示时,用户眼里它就是张小图;
 * 反过来,缩略图站点上 200px 的图也可能被放大展示。
 *
 * 下面这组阈值是为了挡住头像、logo、图标、装饰条这类东西 ——
 * 它们尺寸不大却很常见,鼠标划过时频繁弹按钮非常烦人。
 * 单看一条不够:头像挡得住,细长横幅挡不住,所以尺寸、面积、宽高比一起用。
 *
 * 最短边定在 120 是权衡的结果:再高会把 250×140 这类正常配图挡在外面,
 * 再低则小头像会漏进来。
 */
const MIN_RENDERED_EDGE = 120;
/**
 * 面积下限。这条比最短边更管用 —— 120×120 和 150×150 的头像
 * 最短边都过关,但面积过不了这关。
 */
const MIN_AREA = 25_000;
/** 宽高比上下限(1:4 ~ 4:1),超出这个范围的基本是横幅或竖条装饰 */
const MIN_ASPECT = 0.25;
const MAX_ASPECT = 4;
/** 原始尺寸下限,只用来排除 1x1 追踪像素 */
const MIN_NATURAL_EDGE = 64;

/** 命中这些命名的元素几乎可以断定是小图标,不该弹按钮 */
const ICON_HINT =
  /(^|[-_ ])(logo|avatar|icon|favicon|badge|emoji|sprite|qrcode|qr-code|gravatar)([-_ ]|$)/i;

/**
 * 图片自身或最近几层祖先的 class/id 里有没有图标语义。
 *
 * 只看三层:再往上就是整个卡片或页面容器了,那些命名(如 post-thumbnail)
 * 说明不了这张图本身是不是图标,看多了反而误伤。
 */
function looksLikeIcon(el: HTMLImageElement): boolean {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    const signature = `${node.getAttribute('class') ?? ''} ${node.id}`;
    if (ICON_HINT.test(signature)) return true;
  }
  return false;
}

export interface HoverButton {
  /** 当前悬停的图片。快捷键模式需要读它 */
  getCurrent(): HTMLImageElement | null;
  /** 收起按钮。结果面板弹出前必须调用,否则按钮会留在原地浮在面板上 */
  hide(): void;
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export function createHoverButton(onTrigger: (img: HTMLImageElement) => void): HoverButton {
  let host: HTMLDivElement | null = null;
  let btn: HTMLButtonElement | null = null;
  let current: HTMLImageElement | null = null;
  let enabled = true;
  let rafId = 0;
  /** 首次命中只打一条日志,免得鼠标划过一片图时刷屏 */
  let loggedFirstHit = false;

  /** 懒创建:只有真的需要显示按钮时才往页面里插节点 */
  function ensureDom(): void {
    if (host) return;

    host = document.createElement('div');
    host.id = HOVER_HOST_ID;
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .pbtn {
          position: fixed;
          display: none;
          align-items: center;
          justify-content: center;
          width: ${BTN_SIZE}px;
          height: ${BTN_SIZE}px;
          padding: 0;
          border: 0;
          border-radius: 8px;
          background: rgba(193, 61, 44, 0.94);
          color: #fff;
          font: 700 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
          cursor: pointer;
          pointer-events: auto;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
          transition: transform 0.12s ease, background 0.12s ease;
        }
        .pbtn.on { display: flex; }
        .pbtn:hover { background: rgb(166, 50, 37); transform: scale(1.08); }
      </style>
      <button class="pbtn" type="button" title="${t('inpage.hoverTitle')}">P</button>
    `;

    btn = shadow.querySelector<HTMLButtonElement>('.pbtn');

    // 拦住 mousedown/click,别让页面拿到这次点击 ——
    // 否则很容易顺手触发图片的灯箱或跳转
    btn?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (current) onTrigger(current);
    });

    // 挂 body 最通用;极少数页面此刻还没有 body 时退回 documentElement
    (document.body ?? document.documentElement).appendChild(host);
  }

  function isUsableImage(el: HTMLImageElement): boolean {
    if (el.naturalWidth < MIN_NATURAL_EDGE || el.naturalHeight < MIN_NATURAL_EDGE) return false;

    const { width: w, height: h } = el.getBoundingClientRect();

    if (Math.min(w, h) < MIN_RENDERED_EDGE) return false;
    if (w * h < MIN_AREA) return false;

    const aspect = w / h;
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) return false;

    // 尺寸都过关了,再核一眼语义 —— 少数站点会把 logo 拉得很大
    return !looksLikeIcon(el);
  }

  function resolveImage(target: EventTarget | null, x: number, y: number): HTMLImageElement | null {
    if (target instanceof HTMLImageElement && isUsableImage(target)) return target;

    // 很多图站会在图片上盖一层 <a> 或遮罩,这时事件 target 根本不是 img。
    // 按坐标穿透查询,才能找到底下那张真正显示的图。
    //
    // 但 elementsFromPoint 返回的是该点下的**所有**元素(从顶到底),不只是最顶层那个 ——
    // 所以它会连结果面板底下的图片一起返回。必须在途中认出自己的面板并提前收手。
    for (const el of document.elementsFromPoint(x, y)) {
      if (!(el instanceof HTMLElement)) continue;

      // 鼠标落在结果面板上:收起按钮,别让它浮在面板前面
      if (el.id === PANEL_HOST_ID) return null;

      // 落在按钮自己身上:跳过继续往下找。否则按钮会因为「鼠标压在自己身上」
      // 导致命中测试找不到底下的图片,反而把自己弄消失
      if (el.id === HOVER_HOST_ID) continue;

      if (el instanceof HTMLImageElement && isUsableImage(el)) return el;
    }
    return null;
  }

  /** 该坐标是否被结果面板遮住 */
  function isCoveredByPanel(x: number, y: number): boolean {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el instanceof HTMLElement && el.id === PANEL_HOST_ID) return true;
    }
    return false;
  }

  function show(img: HTMLImageElement): void {
    ensureDom();
    if (!btn) return;

    const r = img.getBoundingClientRect();
    const top = Math.max(4, r.top + 6);
    const left = Math.max(4, Math.min(window.innerWidth - BTN_SIZE - 4, r.right - BTN_SIZE - 6));

    // 按钮该出现的位置若正被结果面板盖着,就别显示。
    // 面板弹出时鼠标往往没动、不会触发 mouseover,所以这个检查必须放在显示之前 ——
    // 否则按钮会残留在原地,浮在面板上面。
    if (isCoveredByPanel(left + BTN_SIZE / 2, top + BTN_SIZE / 2)) {
      btn.classList.remove('on');
      return;
    }

    if (!loggedFirstHit) {
      loggedFirstHit = true;
      debugLog('识别到可反推的图片:', img.currentSrc || img.src);
    }

    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;
    btn.classList.add('on');
  }

  function hide(): void {
    current = null;
    btn?.classList.remove('on');
  }

  function onMouseOver(e: MouseEvent): void {
    // 事件对象在 rAF 回调里会被回收,先把要用的值取出来
    const x = e.clientX;
    const y = e.clientY;
    const target = e.target;

    // mouseover 在页面里触发得非常密,合并到每帧最多处理一次
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const img = resolveImage(target, x, y);

      // 不论按钮开关如何都记录当前图片 —— 快捷键不该因为关掉按钮就失效。
      // 所以这里不用 hide(),那个函数会顺手把 current 清空。
      current = img;
      if (img && enabled) show(img);
      else btn?.classList.remove('on');
    });
  }

  document.addEventListener('mouseover', onMouseOver, true);
  // 滚动后图片位置变了,按钮留在原地会很突兀,直接收起
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  return {
    getCurrent: () => current,
    hide,
    setEnabled: (v: boolean) => {
      enabled = v;
      if (!v) hide();
    },
    destroy: () => {
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      if (rafId) cancelAnimationFrame(rafId);
      host?.remove();
      host = null;
      btn = null;
      current = null;
    },
  };
}
