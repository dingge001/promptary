# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **动手前先读 [AGENTS.md](./AGENTS.md)。** 它记录了这个项目「不知道就一定会踩」的具体约定（i18n 类型约束、Tailwind 类覆盖顺序、`neutral` 色阶重映射、Dexie 的 `undefined` 陷阱、MV3 无 `FileReader`）以及三条不许越界的产品边界和理由。本文不复述这些内容，只讲命令与架构。

## 项目是什么

Promptary 是一个 Chrome MV3 扩展：把网页上的图片反推成 AI 绘画提示词并管理成收藏库。

它区别于同类工具的唯一要点是：**提示词的输出格式按目标模型区分**。同一张图，Stable Diffusion 要逗号标签串 + 权重 + 画质词 + 负向词，FLUX 要完整句子且**加画质词反而有害**，Midjourney 要尾部 `--ar/--style/--v` 参数，Seedream 用中文最好。这套「方言」定义在 `lib/vision/models.ts` 的 `MODEL_PROFILES`，是整个产品的核心资产。

本地优先：无后端、无账号、无遥测。唯一出网请求是用户自己触发的、发往用户自己配置的 OpenAI 兼容端点。

## 常用命令

```bash
pnpm install    # postinstall 会跑 `wxt prepare`，生成 .wxt/ 类型（tsconfig 依赖它）
pnpm dev        # 启动带扩展的浏览器，热重载
pnpm dev:edge   # 同上，Edge
pnpm compile    # tsc --noEmit —— 改完代码就跑这个
pnpm build      # 产出到 .output/chrome-mv3
pnpm zip        # 打包上架用的 zip
```

`pnpm compile` 是最有用的一条命令，它同时承担了「五种语言包 key 是否齐全」的校验（见下）。CI（`.github/workflows/ci.yml`）只跑 `pnpm compile` + `pnpm build`，无测试框架。

## 架构

### 三个运行上下文

必须先分清代码跑在哪，否则会写出「在 Service Worker 里用 DOM」这类必然失败的代码：

| 上下文 | 入口 | 能做什么 | 不能做什么 |
| --- | --- | --- | --- |
| Service Worker | `entrypoints/background.ts` | 有 `host_permissions`，可 fetch 任意厂商 API；右键菜单 | 无 DOM、无 `FileReader`，且会被空闲回收 |
| Content script | `entrypoints/content.ts` | 读写页面 DOM、注入输入框 | fetch 受页面 CORS 约束，**不能直接调模型 API** |
| Side panel | `entrypoints/sidepanel/` | React + Dexie + 主界面 | 关闭即中断其中的长任务 |

`lib/inpage/`（悬停按钮、结果面板）是第四个「上下文」：跑在 content script 里，用原生 DOM + Shadow DOM 写，**不是 React**，但和侧边栏共享 `lib/i18n`。

### 消息流

- **右键菜单 → 侧边栏**：不直接传参，而是往 `chrome.storage.session` 写一条 `PendingTask`（`lib/messages.ts`），侧边栏读它。因为 `sidePanel.open()` 只能开面板、带不了参数。
- **右键菜单 → 页面内面板**：`background.ts` 用 `chrome.tabs.sendMessage(tabId, {type:'analyzeInPage'})` 让页内结果面板干活。之所以不走侧边栏——`sidePanel.open()` 要求用户手势，而内容脚本转发过来的调用已经没有手势了。若页面还没注入 content script，会 `chrome.scripting.executeScript` 动态补一次；**该路径硬编码了 `content-scripts/content.js`，改 `entrypoints/content.ts` 的文件名要同步改 `background.ts`**。
- **页面内 UI → 后台**：`runtime.sendMessage` 发 `analyzeFromPage` / `saveFromPage` / `startBatch`，模型调用统一在后台做（CORS）。`lib/messages.ts` 是这些协议的唯一定义处。
- **选图面板 ↔ 页面**：`chrome.tabs.connect` 建 Port 长连接（`IMAGE_WATCH_PORT`），页面侧盯住图片增减并推快照。之所以用长连接而不是普通消息，是因为侧边栏是被浏览器直接销毁的，关闭那一刻发不出「停止监听」——Port 的 `onDisconnect` 才是可靠且即时的收尾信号。
- **标签页通信的注入兜底**：发消息一律走 `lib/tabs.ts` 的 `sendToTab()`，它在首次失败时补注入一次内容脚本。页面可能比扩展先加载（扩展刚装、刚重载），页面上没有内容脚本时直接 `sendMessage` 必然失败，而失败长得很像「这页没图」。

### 两条存储，物理隔离

这是**有意的设计**，不是随手放的：

- **IndexedDB（Dexie，`lib/db/`）**——收藏项、分类、标签。选它而非 `chrome.storage` 是因为后者总配额仅 10MB，几张原图就爆；IndexedDB 原生支持 Blob。图片直接存二进制，列表只加载 `thumbnailBlob`。
- **`chrome.storage.local`（`lib/settings.ts`）**——设置与 API Key。分开的收益是：**导出备份天然不会带出 API Key**，用户分享备份文件不泄露密钥。
- **`chrome.storage.session`**——`PendingTask`、`BatchJob` 这类瞬态任务。用 session 让它们不落盘、且侧边栏能读到进度。

### 数据层约定（`lib/db/types.ts`）

所有表遵守「同步友好」三约定，为二阶段云同步预埋：UUID 主键（绝不用自增）、软删除墓碑（`deletedAt`）、每条记录带 `updatedAt` + `syncState`。**新增字段/新表时要延续这三条**，事后补要迁移全量用户数据。

其他要点：

- `PromptFields` 刻意**不拆成「主体/风格/光线」散字段**——用户要的是能直接粘贴的一条成品，且不同模型的排列顺序本来就不同，拆开反而写不对。
- 标签有 `count` 引用计数，归零即自动软删除；`pruneOrphanTags()` 在侧边栏启动时兜底扫一次。
- `listItems()` 走「全量取出 + 内存过滤」，几千条量级够用。真要上万条再换倒排索引，调用方接口不用变。

### 反推流水线（产品核心）

`lib/vision/analyze.ts` 的 `analyzeImage()` 串起了整条链路：

1. `getModelProfile()` 取目标模型档案 → `resolveLanguage()` 定输出语言
2. `buildSystemPrompt()`（`lib/vision/schema.ts`）按档案**动态拼装** system prompt：档案的 `rules` + 通用铁律 + 输出 JSON 结构 + `example`。换模型 = 换一整套规则和示例，不是换措辞。
3. `decideStrategy()` 决定传图方式：http(s) 优先 **URL 直传**（让服务端取图，省流量且避开本地跨域），失败自动降级为「本地下载 + base64」重试一次。防盗链站点很常见，这条降级路径是必需的。`blob:` / `data:` 地址必须转 base64，外部服务取不到。
4. `chatCompletion()`（`lib/providers/openai.ts`）发 OpenAI 兼容的 `/chat/completions`，带 `response_format: json_object`。
5. `parsePromptFields()` 解析，**全程容错**：剥 markdown 代码块、兜底抓首尾大括号、字段类型不对就退化，保证用户拿到一条能用的提示词而不是红色报错。

**加一个新目标模型只需往 `MODEL_PROFILES` 数组加一项，不动任何逻辑**，但要记得在五个语言包里补 `hintKey` 对应的 key（否则编译失败）。写 `rules` 的经验见 `CONTRIBUTING.md`：`example` 比 `rules` 管用。

`lib/vision/image.ts` 里的硬约束：送模型的图压到最长边 1536（主流 VL 模型本来就会缩到固定 token 数），缩略图压到 480。

### i18n（`lib/i18n/`）

自研轻量方案，不引 i18next。**当前语言存在模块级变量里而非 React Context**——因为页内面板是原生 DOM，读不到 Context，全局变量是两边都能用的最小公约数。侧边栏的语言切换由 App 的 state 驱动重渲染。

五种语言包以 `zh-CN.ts` 的 `Dict` 为类型基准，漏翻一条就编译不过（这是刻意的）。内置分类存的是 `builtin.people` 这类 **i18n key 而不是中文名**，否则会在创建时就被中文固化；显示时统一走 `categoryLabel()`。

### 样式

`assets/tailwind.css` 是 Tailwind v4 的 token 源文件，用 `@theme inline` 定义语义色，并用 `@custom-variant dark` 把 `dark:` 前缀绑到 `[data-theme="dark"]` 上——**主题由 `data-theme` 属性驱动，不是媒体查询**（`App.tsx` 里设置该属性）。token 命名以 `assets/tailwind.css` 为准（`--line` / `--ink`），`docs/design/design-spec.md` 里的 `--border` / `--text-1` 是旧名。

`@/` 别名指向项目根目录（WXT 默认）。

## 验证改动

没有测试套件，靠手工验证：

1. `pnpm build`
2. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `.output/chrome-mv3`
3. **改了 `entrypoints/content.ts` 或 `background.ts` 后，必须重新加载扩展并刷新目标网页**——内容脚本在页面加载时注入，不刷新跑的还是旧代码。
4. 悬停按钮的行为可用 `test/hover-test.html` 本地打开验证（四个用例即验收标准）。

调试页内 UI 时，Console 里看 `[Promptary]` 前缀的日志（`lib/inpage/debug.ts`）。
