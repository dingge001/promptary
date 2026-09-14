# Promptary

提示词收藏、图片反推与标签管理。Chrome MV3 扩展,数据全部留在本机。

## 快速开始

```bash
pnpm install
pnpm dev        # 开发模式,自动打开带扩展的浏览器
pnpm build      # 产出到 .output/chrome-mv3
pnpm compile    # 类型检查
pnpm zip        # 打包发布用的 zip
```

手动加载:打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选 `.output/chrome-mv3`。

首次使用需要到侧边栏的「设置」页填模型服务(接口地址 + API Key + 模型名),点「测试连接」确认通了再开始用。

## 怎么用

| 操作 | 入口 |
| --- | --- |
| 反推网页上某张图 | 图片上右键 →「反推这张图的提示词」 |
| 收藏一张图 | 图片上右键 →「收藏这张图」 |
| 收藏一段文字 | 选中文字 → 右键 →「收藏选中文字为提示词」 |
| 从当前页挑图 | 侧边栏顶栏 →「页内选图」 |
| 管理收藏 | 点扩展图标打开侧边栏 |
| 把提示词填进生图工具 | 详情页 →「注入到页面」 |

## 架构

```
entrypoints/
  background.ts        右键菜单、把任务投递给侧边栏
  content.ts           读页面 DOM(采集图片)、写页面 DOM(注入提示词)
  sidepanel/           主界面
lib/
  db/                  Dexie 数据层:types 模型 / index 实例 / repo 业务操作
  providers/           模型接入,统一 OpenAI 兼容协议
  vision/              反推:models 模型档案 / schema 提示词工程 / image 图片处理 / analyze 编排
  settings.ts          设置读写(与业务数据分离存放)
```

### 几个关键决策

**只做 OpenAI 兼容协议。** DeepSeek、OpenAI、OpenRouter、硅基流动、各类中转全部兼容它。用户换服务商只是改 baseUrl + model 两行配置,不需要为每家写适配器。

**按目标模型区分反推规则 —— 产品的核心。** 同一个画面,Stable Diffusion 要 `1girl, solo, silver hair, (neon lights:1.2), masterpiece, best quality` 这样的标签串;FLUX 要完整句子,而且**加 `masterpiece` 反而有害**(它是 CFG-distilled 模型);Midjourney 要简洁描述加 `--ar 3:2 --style raw`;Seedream 用中文最顺。不区分的「图片转提示词」,产出的东西必然有一半是废的。规则和 few-shot 示例都写在 `lib/vision/models.ts` 的档案里,system prompt 按选中的档案动态拼装 —— 加新模型只要往数组里加一项,不用改任何逻辑。

**图片三级获取。** 优先让模型服务端按 URL 自己去取图(省流量、避开本地跨域);失败自动降级为本地下载 + base64 上传。这条降级路径是必需的,防盗链站点很常见。

**数据同步友好。** 所有表主键是 UUID、删除一律软删除、每条记录带 `updatedAt`,并预埋 `syncState`。这是为二阶段云同步准备的 —— 现在加成本为零,事后补要迁移全量用户数据。

**设置与业务数据物理隔离。** API Key 存在 `chrome.storage.local`,收藏内容存在 IndexedDB。这样「导出备份」天然不会带出密钥。

### 几个环境坑

- MV3 Service Worker 里**没有 `FileReader`**,base64 只能拿 `arrayBuffer` 手动编码(见 `lib/vision/image.ts`)
- Dexie 的 `update()` 会**静默忽略值为 `undefined` 的字段**。想真正删掉某个字段(比如把收藏移回「未分类」)必须走 `modify` 手动 `delete`(见 `lib/db/repo.ts`)
- 往 React/Vue 写的输入框注入值必须用**原生 setter** 再派发 `input` 事件,直接赋 `value` 会被框架的 diff 覆盖(见 `entrypoints/content.ts`)
- 右键菜单不能只在 `onInstalled` 里建 —— SW 重启后它不再触发,改了菜单定义却看不到变化。现在每次 SW 启动都先清后建(见 `entrypoints/background.ts`)
- 批量任务要跑几十秒,而 MV3 的 SW 会被空闲回收。做法是每处理一张就写一次 `storage.session`:既更新了进度,也让 SW 始终有活动(见 `entrypoints/background.ts`)

## 当前状态

V1 已全部完成:

- 右键反推图片提示词 / 收藏图片 / 收藏选中文字
- 图片悬停快捷按钮,快捷键 `Alt+Shift+P`
- 按目标模型反推(6 个模型档案),结果可编辑、标签可删减、可换模型重推
- 分类树 + 标签体系,反推标签自动创建;分类支持增删改(树形,级联删除时收藏退回未分类而非被删)
- 全文搜索、详情编辑、提示词注入生图工具页面
- 批量反推:后台串行执行,可中途取消,侧边栏关掉再打开仍能恢复进度
- 回收站:软删除 + 恢复 + 彻底删除
- 存储位置透明化(路径 / 占用 / 条目数)、导入导出备份
- BYOK 模型配置与连通性测试

## 后续方向

片段组合器、翻译/扩写/精简、SD↔MJ 语法互转、以图搜图溯源(SauceNAO / ascii2d)、Obsidian 同步、云同步(二阶段收费项)。
