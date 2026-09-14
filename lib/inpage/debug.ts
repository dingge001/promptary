/**
 * 页面内调试日志。
 *
 * 悬停按钮、快捷键这类「注入到别人页面里」的功能,出问题时最难查 ——
 * 现象只是「什么都没发生」,没有任何反馈。这几行日志就是为了让它开口说话:
 * 在网页上按 F12 打开 Console,能直接看到内容脚本有没有注入、有没有认出图片。
 *
 * 产品成熟后把 DEBUG 改成 false 即可,不必逐处删日志。
 */
export const DEBUG = true;

export function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log('[Promptary]', ...args);
}
