import type { TabCommand } from './messages';

/**
 * 与标签页里的内容脚本通信。
 *
 * 抽出来的原因:右键菜单反推和侧边栏选图要做同一件事 ——
 * 「先发消息,失败就补注入一次再重试」。
 *
 * 为什么必须补注入:内容脚本是在页面加载时注入的,所以「页面比扩展先就位」
 * 时页面上根本没有它 —— 扩展刚安装、刚重载、刚更新之后打开的老页面全是这种状态。
 * 此时直接 sendMessage 必然失败,而失败看上去和「这页没图」一模一样,
 * 用户只能靠刷新页面自己猜。补注入把这个窗口彻底抹掉。
 */

/**
 * WXT 按入口文件名生成的产物路径。
 *
 * 改 entrypoints/content.ts 的文件名时要同步改这里 ——
 * 这是全项目唯一需要知道该路径的地方。
 */
const CONTENT_SCRIPT_PATH = 'content-scripts/content.js';

/**
 * 给标签页发指令,必要时补注入内容脚本。
 *
 * 首次失败一律当作「内容脚本还没注入」处理。重复注入是安全的:
 * 内容脚本自己用 __promptaryContentReady 挡了第二次注册,不会重复挂监听器。
 *
 * 再失败就是真的失败(浏览器内置页面等地址根本不允许注入),抛给调用方决定怎么提示。
 */
export async function sendToTab<T>(tabId: number, message: TabCommand): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    // 页面上还没有内容脚本,补注入后重试
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_PATH],
  });

  return (await chrome.tabs.sendMessage(tabId, message)) as T;
}
