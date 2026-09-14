import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// WXT 配置:https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: {
    name: 'Promptary',
    // 与商店 listing 保持英文一致 —— 这段文字会显示在 chrome://extensions 上,
    // 中文会让英文用户装完后看到一句看不懂的描述
    description: 'Reverse-engineer any web image into a ready-to-use AI art prompt. Local-first, bring your own API key.',
    // 权限说明(遵循最小权限原则,申请了就必须真的用到):
    // contextMenus - 右键菜单(图片/文字反推与收藏)
    // storage      - 保存设置、API Key 与待处理任务
    // sidePanel    - 主界面侧边栏
    // activeTab    - 用户主动触发时读取当前页地址与标题
    // scripting    - 右键反推时若页面还没有内容脚本,动态补注入一次
    permissions: ['contextMenus', 'storage', 'sidePanel', 'activeTab', 'scripting'],
    // 抓取图片与调用模型 API 需要
    host_permissions: ['<all_urls>'],
    side_panel: { default_path: 'sidepanel.html' },
    action: { default_title: 'Promptary' },
  },

  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
