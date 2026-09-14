# 贡献指南

感谢愿意帮忙。这个项目最需要贡献的地方,恰好也是最容易上手的地方。

## 最欢迎的两类贡献

### 1. 新增或修正模型档案(门槛最低,价值最高)

`lib/vision/models.ts` 是整个产品的核心——不同生图模型对提示词的要求差别很大,`MODEL_PROFILES` 数组里每个条目就是一套「方言」。

新增一个模型,只需要往数组里加一项,**不用动任何逻辑**:

```ts
{
  id: 'your-model',
  name: 'Your Model',
  group: '标签系' | '自然语言系' | '参数系' | '中文系',
  hintKey: 'model.yourModel.hint',   // 在 locales/*.ts 里补这个 key
  rules: {
    zh: ['用中文写的格式要求…'],
    en: ['The same requirements in English…'],
  },
  example: '一条真实的示例提示词',
  output: { language: 'en', negative: false, qualityTags: false },
}
```

写 `rules` 时的经验:

- **`example` 比 `rules` 管用**。光写「请用逗号分隔」模型照样写完整句子,给一条真实样例它立刻就跟上。务必配一个。
- **规则要具体到可执行**。不写「描述要详细」,写「把光线方向、材质质感、镜头视角都交代清楚」。
- **中英两套分开写,不要机器翻译**。英文语料训练的模型(SD / FLUX)对英文指令的遵循度确实更高。

### 2. 修正翻译

`lib/i18n/locales/` 下有五种语言。类型系统会保证 key 齐全(漏一条编译不过),但**译文是否地道只能靠母语者**。

发现读着别扭的地方直接改,尤其是:

- 英文的术语选择(比如「反推」译成 *reverse-engineer* 是否自然)
- 日/韩的软件界面用语习惯

## 开发

```bash
pnpm install
pnpm dev        # 启动带扩展的浏览器,热重载
pnpm compile    # 类型检查
pnpm build      # 产出到 .output/chrome-mv3
```

改动 `entrypoints/content.ts` 或 `background.ts` 后,需要刷新扩展并**刷新目标网页**才会生效——内容脚本是页面加载时注入的。

## 提交前

- `pnpm compile` 必须通过
- 改了用户可见文案,记得**五种语言包都要加**(否则编译报错,这正是我们想要的)

## 不要做的事

有几条边界在 `docs/PRD.md` 里写明了,提 PR 前请先看一眼:

- **不做插件内生图**——MV3 的 Service Worker 会被随时终止,撑不住 10~60 秒的生图任务
- **不引入第三方 UI 组件库**——统共十几个控件,不值得多几百 KB
- **不上传用户数据**——这是产品的立身之本,任何联网行为都必须发生在「用户自己配置的模型 API」和「用户主动触发的导出」上

## 提交 PR

不必先开 issue 讨论,小改动直接提。但**涉及架构的改动**(数据模型、存储方式、任务调度)请先开 issue,这类改动返工成本高。
