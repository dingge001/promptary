<div align="center">

# Promptary

**右键网页上的任意图片,得到一条真正能用的生图提示词。**

[![License: MIT](https://img.shields.io/badge/License-MIT-c13d2c.svg)](./LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-c13d2c.svg)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-c13d2c.svg)](./CONTRIBUTING.md)
[![Chrome 应用商店](https://img.shields.io/badge/Chrome%20%E5%BA%94%E7%94%A8%E5%95%86%E5%BA%97-%E6%95%AC%E8%AF%B7%E6%9C%9F%E5%BE%85-lightgrey.svg)](#安装)

[English](./README.md) · [简体中文](./README.zh-CN.md)

<img src="./assets/store/01-reverse-engineer.png" width="800" alt="用 Promptary 反推一张图片" />

</div>

---

## 为什么做这个

市面上多数「图片转提示词」工具,给你的是一段画面描述。那不是提示词——你还得自己重写一遍才能用。

而真正麻烦的地方在于:**同一张图,给不同模型就得用不同的写法**:

| 模型 | 它真正想要的 |
| --- | --- |
| Stable Diffusion | 逗号分隔的标签串、权重、画质词、负向提示词 |
| FLUX | 完整句子——而且加 `masterpiece` 反而有害 |
| Midjourney | 简洁描述 + 尾部 `--ar` / `--style` / `--v` |
| GPT-Image | 详细的长段落 |
| nano banana | 自然的描述式语言 |
| Seedream | 中文,这是它最擅长的 |

不区分这些的工具,产出的提示词**从结构上就有一半是错的**——用户拿到手还得自己重写一遍,那这个工具就没有存在意义。

Promptary 按你选定的模型格式生成提示词。选一次,之后每条都是复制即用的成品。

## 功能

**在哪都能反推**
在任意网站的图片上右键。或者鼠标悬停时点浮现的按钮。或者按 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> 直接反推光标所指的那张图。

**按模型的「方言」输出**
六份模型档案,每份都有独立的规则和一条真实示例。见[上面的表格](#为什么做这个)——换模型改变的是输出格式,不只是措辞。

**一个用得下去的收藏库**
分类(树状)与标签(多对多)两套组织方式。全文搜索覆盖标题、提示词、标签、备注。回收站可恢复。支持完整的导入导出。

**直接送进你的生图工具**
一键把存好的提示词注入生图工具的输入框,不用来回复制粘贴。

**离线可用,五种语言**
English、简体中文、繁體中文、日本語、한국어。

## 界面一览

**收藏库** —— 左边分类与标签,右边缩略图网格。鼠标悬停卡片可星标或删除。

<img src="./assets/store/02-library.png" width="820" alt="Promptary 收藏库" />

**模型档案** —— 目标模型选一次即可。每份档案带着自己的规则,所以换模型改变的是输出格式,而不只是措辞。

<img src="./assets/store/03-models.png" width="820" alt="设置里的模型档案" />

**详情页** —— 改提示词、删标签、换模型重推。一键送进生图工具。

<img src="./assets/store/04-detail.png" width="820" alt="收藏详情页" />

## 隐私

没有账号,不用注册,没有埋点,没有遥测。

- 你的图片、提示词、标签都存在浏览器的本地数据库里,不会上传给我们。
- API 密钥与收藏内容分开存放,并刻意排除在导出的备份之外。
- **图片怎么送到模型由你选择。** 用自己的 API Key,请求从浏览器直连你配置的服务,完全不经过我们;用官方免费额度,则经我们的一台中转服务器转发 —— 它只转发,不留存你的图片和提示词。那台服务器上保留的记录只有一个匿名设备标识和每日次数,7 天后删除。

官方渠道的意义是让你不必先去注册一个模型服务就能试用。如果你不希望任何东西经过我们,用自己的 API Key 就好 —— 那条路完全直连。

完整政策:[English](./docs/PRIVACY.md) · [简体中文](./docs/PRIVACY.zh-CN.md)

## 安装

**Chrome 应用商店** —— 敬请期待。

**从源码安装**(现在就能用):

```bash
git clone https://github.com/dingge001/promptary.git
cd promptary
pnpm install
pnpm build
```

然后打开 `chrome://extensions`,开启**开发者模式**,点**加载已解压的扩展程序**,选择 `.output/chrome-mv3`。

## 配置

Promptary 需要一个支持图像输入的模型。它走 OpenAI 兼容协议,所以任何兼容的服务都能接——DeepSeek、OpenAI、OpenRouter、硅基流动,或者你自己搭的服务。

1. 点工具栏图标打开侧边栏
2. 进**设置**,填写接口地址、API Key 和模型名
3. 点**测试连接**

在**设置 → 查看实际发送的提示词**里,可以看到真正发给模型的那段文本。模型表现不对时先看这里——那是真东西,不是对它的描述。

## 使用

| 想做什么 | 怎么做 |
| --- | --- |
| 反推一张图 | 图片上右键 → **反推这张图的提示词** |
| 只收藏图、不反推 | 图片上右键 → **收藏这张图** |
| 收藏一段文字 | 选中文字 → 右键 → **收藏选中文字为提示词** |
| 从整页里挑图 | 顶栏 → 四宫格图标 |
| 换一个模型重推已有收藏 | 打开详情 → 选模型 → **重新反推** |
| 把提示词送进生图工具 | 打开详情 → 注入图标 |

## 开发

```bash
pnpm dev        # 启动带扩展的浏览器,支持热重载
pnpm compile    # 类型检查
pnpm build      # 产出到 .output/chrome-mv3
pnpm zip        # 打包成可上传商店的 zip
```

改动 `entrypoints/content.ts` 或 `background.ts` 后,需要重载扩展**并刷新目标网页**——内容脚本是页面加载时注入的。

### 目录结构

```
entrypoints/
  background.ts        右键菜单、模型调用、图片抓取
  content.ts           页面 DOM:采集图片、注入提示词、页面内 UI
  sidepanel/           主界面
lib/
  db/                  Dexie 数据层(UUID 主键、软删除、预埋同步字段)
  providers/           模型接入,OpenAI 兼容
  vision/              models.ts  ← 模型档案(核心资产)
                       schema.ts  ← 拼装 system prompt
  i18n/                五种语言,带类型约束,漏翻一条就编译不过
```

## 贡献

最有价值的贡献恰好也最容易上手:**新增一份模型档案**。只需要往 `lib/vision/models.ts` 的数组里加一项,不用改任何逻辑。

怎么写好 `rules`、以及为什么那条 `example` 比 rules 更重要,见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可

[MIT](./LICENSE)
