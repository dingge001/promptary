import { t } from '../i18n';
import type { AnalyzedPayload } from '../messages';
import { MODEL_PROFILES, getModelProfile } from '../vision/models';
import { PANEL_HOST_ID } from './hosts';

/**
 * 页面内反推结果面板。
 *
 * 悬停按钮、快捷键、右键菜单三条路径共用它 —— 同一个功能不该有三种界面。
 * 能力也刻意和侧边栏里的结果面板对齐:提示词可改、标签可删、能换模型重推。
 *
 * 为什么不直接打开侧边栏:chrome.sidePanel.open() 要求调用发生在用户手势中,
 * 而内容脚本转发消息到后台时手势已经失效,调用会失败。
 */

/** 模型输出会直接拼进 innerHTML,必须转义 —— 否则这就是个现成的 XSS 入口 */
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const STYLES = `
  .panel {
    position: fixed; right: 16px; bottom: 16px; width: 340px; max-height: 76vh;
    display: flex; flex-direction: column;
    background: #fff; color: #171717;
    border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.26);
    font: 12px/1.5 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    overflow: hidden; pointer-events: auto;
  }
  .head { display: flex; align-items: center; justify-content: space-between;
          padding: 8px 10px; border-bottom: 1px solid #e7e7e7; }
  .t { font-weight: 600; font-size: 12px; }
  .x { border: 0; background: transparent; cursor: pointer; font-size: 16px; line-height: 1;
       color: #666666; padding: 2px 6px; border-radius: 4px; }
  .x:hover { background: #f2f0f0; }
  .body { padding: 10px; overflow-y: auto; flex: 1; }
  .body.center { display: flex; flex-direction: column; align-items: center; justify-content: center;
                 gap: 10px; padding: 28px 10px; color: #666666; }
  .spin { width: 22px; height: 22px; border: 2px solid #d8d8d8; border-top-color: #c13d2c;
          border-radius: 50%; animation: sp .8s linear infinite; }
  @keyframes sp { to { transform: rotate(360deg); } }
  .lbl { font-size: 10px; font-weight: 600; color: #71717a; margin: 0 0 3px; }
  .lbl:not(:first-child) { margin-top: 10px; }
  .row { display: flex; gap: 6px; margin-bottom: 2px; }
  /* 自定义下拉:原生 select 展开后的列表由浏览器渲染,CSS 根本碰不到,
     所以只能自己画一个。弹层用 fixed —— .panel 有 overflow:hidden,绝对定位会被裁掉 */
  .selwrap { flex: 1; min-width: 0; }
  .seltrigger { display: flex; align-items: center; justify-content: space-between; gap: 6px;
                width: 100%; height: 24px; padding: 0 6px; border: 1px solid #d8d8d8;
                border-radius: 6px; background: transparent; color: inherit;
                font-size: 11px; font-family: inherit; cursor: pointer; text-align: left; }
  .seltrigger:hover { border-color: #c13d2c; }
  .seltrigger.open .selarrow { transform: rotate(180deg); }
  .seltext { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .selarrow { width: 12px; height: 12px; flex-shrink: 0; color: #71717a;
              transition: transform .2s; }
  .selmenu { position: fixed; z-index: 2147483647; max-height: 220px; overflow-y: auto;
             padding: 4px; border: 1px solid #e7e7e7; border-radius: 8px; background: #fff;
             box-shadow: 0 8px 28px rgba(0,0,0,.18); }
  .selmenu[hidden] { display: none; }
  .selopt { display: flex; align-items: center; justify-content: space-between; gap: 6px;
            width: 100%; padding: 5px 7px; border: 0; border-radius: 5px;
            background: transparent; color: #171717; font-size: 11px; font-family: inherit;
            cursor: pointer; text-align: left; }
  .selopt:hover { background: #f2f0f0; }
  .selopt.on { background: rgba(193,61,44,.12); color: #c13d2c; }
  .chk { width: 11px; height: 11px; flex-shrink: 0; }
  .regen { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;
           flex-shrink: 0; padding: 0; border: 1px solid #c13d2c; border-radius: 6px;
           background: transparent; color: #c13d2c; cursor: pointer; }
  .regen:hover { background: rgba(193,61,44,.12); }
  .regen:disabled { opacity: .3; cursor: default; border-color: #d8d8d8; color: #71717a; }
  .regen svg { width: 12px; height: 12px; }
  .area { width: 100%; box-sizing: border-box; resize: vertical; border: 0; border-radius: 8px;
          background: #f2f0f0; color: inherit; padding: 8px; font-size: 11px; line-height: 1.6;
          font-family: inherit; outline: none; }
  .area:focus { box-shadow: 0 0 0 1px #c13d2c; }
  .inp { width: 100%; box-sizing: border-box; border: 1px solid #d8d8d8; border-radius: 6px;
         padding: 4px 6px; font-size: 11px; background: transparent; color: inherit; outline: none; }
  .inp:focus { border-color: #c13d2c; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .tag { display: inline-flex; align-items: center; gap: 3px; background: #f2f0f0;
         border-radius: 4px; padding: 1px 4px 1px 6px; font-size: 10px; color: #666666; }
  .tag button { border: 0; background: transparent; cursor: pointer; color: #71717a;
                font-size: 12px; line-height: 1; padding: 0 1px; }
  .tag button:hover { color: #dc2626; }
  .empty { font-size: 10px; color: #71717a; }
  .foot { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #e7e7e7; }
  .primary { flex: 1; border: 0; border-radius: 7px; background: #c13d2c; color: #fff;
             font: 600 11px/1 system-ui; padding: 9px 0; cursor: pointer; }
  .primary:hover { background: #a63225; }
  .primary:disabled { opacity: .6; cursor: default; }
  .ghost { border: 1px solid #d8d8d8; background: transparent; border-radius: 7px;
           padding: 9px 12px; font: 500 11px/1 system-ui; color: #666666; cursor: pointer; }
  .ghost:hover { background: #f2f0f0; }
  .err { background: #fef2f2; color: #b91c1c; border-radius: 8px; padding: 10px;
         font-size: 11px; word-break: break-word; }
`;

/** 用户在面板里编辑后的结果,保存时以它为准 */
export interface EditedFields {
  prompt: string;
  negative: string;
  tags: string[];
}

export interface ResultPanelHandlers {
  onSave: (edited: EditedFields) => Promise<void>;
  /** 换一个目标模型重推 */
  onRegenerate: (modelId: string) => void;
}

export interface ResultPanel {
  showLoading(): void;
  showResult(data: AnalyzedPayload, handlers: ResultPanelHandlers): void;
  showError(message: string): void;
  hide(): void;
}

export function createResultPanel(): ResultPanel {
  let host: HTMLDivElement | null = null;
  let shadow: ShadowRoot | null = null;
  /** 当前标签。删改都作用在它身上,保存时直接取 */
  let currentTags: string[] = [];

  function ensureDom(): void {
    if (host) return;
    host = document.createElement('div');
    host.id = PANEL_HOST_ID;
    // 宿主不能挡页面,只有 .panel 接收事件
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    shadow = host.attachShadow({ mode: 'open' });

    // 点面板以外的地方收起下拉。注册一次就够 —— 面板内容会反复重建,
    // 挂在 document 上的监听不能跟着重建,否则会越积越多
    document.addEventListener('mousedown', (e) => {
      const menu = shadow?.querySelector<HTMLElement>('[data-el="selmenu"]');
      if (!menu || menu.hidden) return;
      // composedPath 能穿透 shadow,用它判断点击是否落在面板内
      if (e.composedPath().includes(host as EventTarget)) return;
      menu.hidden = true;
      shadow?.querySelector('.seltrigger')?.classList.remove('open');
    });

    (document.body ?? document.documentElement).appendChild(host);
  }

  function render(inner: string): void {
    ensureDom();
    if (!shadow) return;
    shadow.innerHTML = `<style>${STYLES}</style>${inner}`;
    shadow.querySelector('[data-act="close"]')?.addEventListener('click', () => hide());
  }

  function hide(): void {
    currentTags = [];
    host?.remove();
    host = null;
    shadow = null;
  }

  return {
    showLoading() {
      render(`
        <div class="panel">
          <div class="head"><span class="t">Promptary</span><button class="x" data-act="close">×</button></div>
          <div class="body center">
            <div class="spin"></div>
            <span>${t('inpage.analyzing')}</span>
          </div>
        </div>
      `);
    },

    showResult(data, handlers) {
      const f = data.fields;
      const profile = getModelProfile(data.modelId);
      currentTags = [...f.tags];

      render(`
        <div class="panel">
          <div class="head">
            <span class="t">${t('inpage.result')}</span>
            <button class="x" data-act="close">×</button>
          </div>
          <div class="body">
            <div class="lbl">${t('analyze.targetModel')}</div>
            <div class="row">
              <div class="selwrap">
                <button type="button" class="seltrigger" data-act="seltoggle">
                  <span class="seltext">${esc(profile.name)}</span>
                  <svg class="selarrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5L8 10.5l4-4"/></svg>
                </button>
              </div>
              <button type="button" class="regen" data-act="regen" title="${t('analyze.regenerate')}">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.9 8a5.1 5.1 0 018.8-3.5"/><path d="M11.7 1.9v2.6H9.1"/><path d="M13.1 8a5.1 5.1 0 01-8.8 3.5"/><path d="M4.3 14.1v-2.6h2.6"/></svg>
              </button>
            </div>
            <div class="selmenu" data-el="selmenu" hidden>
              ${MODEL_PROFILES.map(
                (m) =>
                  `<button type="button" class="selopt${m.id === data.modelId ? ' on' : ''}" data-value="${m.id}">
                     <span>${esc(m.name)}</span>
                     ${
                       m.id === data.modelId
                         ? '<svg class="chk" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>'
                         : ''
                     }
                   </button>`,
              ).join('')}
            </div>

            <div class="lbl">${t('analyze.prompt')}</div>
            <textarea class="area" data-el="prompt" rows="6">${esc(f.prompt)}</textarea>

            ${
              profile.output.negative
                ? `<div class="lbl">${t('analyze.negative')}</div>
                   <textarea class="area" data-el="negative" rows="2">${esc(f.negative)}</textarea>`
                : ''
            }

            <div class="lbl">${t('detail.tags')}</div>
            <div class="tags" data-el="tags"></div>
            <input class="inp" data-el="taginput" placeholder="${t('inpage.tagPlaceholder')}" />
          </div>
          <div class="foot">
            <button class="primary" data-act="save">${t('inpage.save')}</button>
            <button class="ghost" data-act="copy">${t('common.copy')}</button>
          </div>
        </div>
      `);

      if (!shadow) return;
      const root = shadow;

      // 标签区单独重绘:删一个标签时不能整块重建,否则旁边输入框里的字会丢
      const tagsBox = root.querySelector<HTMLElement>('[data-el="tags"]');
      const paintTags = () => {
        if (!tagsBox) return;
        tagsBox.innerHTML = currentTags.length
          ? currentTags
              .map(
                (tag) =>
                  `<span class="tag">${esc(tag)}<button data-tag="${esc(tag)}" title="${t('detail.removeTag')}">×</button></span>`,
              )
              .join('')
          : `<span class="empty">${t('analyze.noTags')}</span>`;

        tagsBox.querySelectorAll<HTMLButtonElement>('[data-tag]').forEach((btn) => {
          btn.addEventListener('click', () => {
            currentTags = currentTags.filter((tag) => tag !== btn.dataset.tag);
            paintTags();
          });
        });
      };
      paintTags();

      const tagInput = root.querySelector<HTMLInputElement>('[data-el="taginput"]');
      tagInput?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const value = tagInput.value.trim();
        if (value && !currentTags.includes(value)) {
          currentTags = [...currentTags, value];
          paintTags();
        }
        tagInput.value = '';
      });

      // 自定义下拉。选项选中后只改显示,真正重推要点「重新生成」——
      // 选一下就直接调模型的话,手滑一次就是一次 API 花费
      const trigger = root.querySelector<HTMLElement>('[data-act="seltoggle"]');
      const menu = root.querySelector<HTMLElement>('[data-el="selmenu"]');
      const regenBtn = root.querySelector<HTMLButtonElement>('[data-act="regen"]');
      let picked = data.modelId;

      trigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!menu) return;
        if (!menu.hidden) {
          menu.hidden = true;
          trigger.classList.remove('open');
          return;
        }
        const rect = trigger.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${rect.left}px`;
        menu.style.width = `${rect.width}px`;
        menu.hidden = false;
        trigger.classList.add('open');
      });

      menu?.querySelectorAll<HTMLElement>('[data-value]').forEach((opt) => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          picked = opt.dataset.value ?? picked;
          const text = trigger?.querySelector('.seltext');
          if (text) text.textContent = getModelProfile(picked).name;
          menu.querySelectorAll('.selopt').forEach((o) => o.classList.remove('on'));
          opt.classList.add('on');
          menu.hidden = true;
          trigger?.classList.remove('open');
          if (regenBtn) regenBtn.disabled = picked === data.modelId;
        });
      });

      regenBtn?.addEventListener('click', () => handlers.onRegenerate(picked));

      const readPrompt = () =>
        root.querySelector<HTMLTextAreaElement>('[data-el="prompt"]')?.value ?? '';
      const readNegative = () =>
        root.querySelector<HTMLTextAreaElement>('[data-el="negative"]')?.value ?? '';

      root.querySelector('[data-act="save"]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = t('inpage.saving');
        try {
          // 读 textarea 的当前值,而不是最初的 fields —— 用户改过的内容要算数
          await handlers.onSave({
            prompt: readPrompt(),
            negative: readNegative(),
            tags: currentTags,
          });
          btn.textContent = t('inpage.saved');
        } catch (err) {
          btn.textContent = t('inpage.saveFailed');
          btn.disabled = false;
          console.error('[promptary] 保存失败', err);
        }
      });

      root.querySelector('[data-act="copy"]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        try {
          await navigator.clipboard.writeText(readPrompt());
          btn.textContent = t('common.copied');
        } catch {
          btn.textContent = t('common.copyFailed');
        }
        setTimeout(() => {
          btn.textContent = t('common.copy');
        }, 1500);
      });
    },

    showError(message) {
      render(`
        <div class="panel">
          <div class="head"><span class="t">${t('inpage.failed')}</span><button class="x" data-act="close">×</button></div>
          <div class="body"><div class="err">${esc(message)}</div></div>
        </div>
      `);
    },

    hide,
  };
}
