/**
 * 注入到页面里的宿主元素 id。
 *
 * 集中定义是为了让各模块能互相「认出」对方 —— 悬停按钮必须知道
 * 结果面板在哪,才能避免浮到面板上面去。字符串散在各处迟早写错。
 */
export const HOVER_HOST_ID = 'promptary-hover-host';
export const PANEL_HOST_ID = 'promptary-panel-host';

/**
 * 该元素是不是 Promptary 自己注入的节点。
 *
 * 注意 shadow DOM 的对外表现:elementFromPoint 系列返回的是宿主元素,
 * 而不是 shadow 内部的节点,所以这里比对 id 就够了。
 */
export function isOwnHost(el: unknown): boolean {
  return (
    el instanceof HTMLElement && (el.id === HOVER_HOST_ID || el.id === PANEL_HOST_ID)
  );
}
