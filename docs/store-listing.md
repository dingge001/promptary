# Chrome Web Store 上架素材

提交时对照本文档逐项填写。纯文本,可直接复制。

---

## 1. 名称

```
Promptary
```

## 2. 简短说明(上限 132 字符)

英文:

```
Right-click any image to reverse-engineer it into a ready-to-use AI art prompt. Organise, tag and reuse. Local-first, bring your own API key.
```

中文(如果单独提交中文商店页):

```
右键任意图片即可反推成可直接使用的 AI 绘画提示词。分类、打标签、随时复用。数据全在本地,模型用自己的 API Key。
```

## 3. 详细说明

英文:

```
Promptary turns any image you find on the web into a prompt you can actually use.

Most "image to prompt" tools give you a paragraph describing the picture. That is not a prompt — you still have to rewrite it. Promptary generates the prompt in the exact format your generator expects:

• Stable Diffusion — comma-separated tags with weights, quality tags, and a negative prompt
• FLUX — full sentences; adding "masterpiece" actually hurts here, so it doesn't
• Midjourney — concise description with --ar / --style / --v parameters appended
• GPT-Image — long, detailed paragraphs; it understands them well
• nano banana — natural descriptive language
• Seedream — Chinese, which is what it handles best

Pick your target model once and every prompt comes out ready to paste.

HOW IT WORKS

Right-click any image on any site and choose "Reverse-engineer this image". A few seconds later you get a prompt you can copy, edit, or send straight into your generator. Hovering over an image also shows a small button, and Alt+Shift+P analyses whatever image your cursor is over.

Prompts you like can be saved to your library, filed into categories, tagged, searched, and reused later. When you are ready to generate, one click inserts the prompt into your image tool's input box — no copy-pasting.

BUILT FOR YOUR OWN LIBRARY

• Categories (a tree) and tags (many-to-many) for organisation
• Full-text search across titles, prompts, tags and notes
• Trash with restore, so a mis-click is never fatal
• Import and export everything as JSON, or export to a folder with images as separate files
• Available in English, 简体中文, 繁體中文, 日本語 and 한국어

YOUR DATA STAYS YOURS

No account. No sign-up. No analytics. No telemetry. There is no Promptary server.

Your images, prompts and tags are stored in your browser's local database and never uploaded to us. Your API key is stored separately from your library, and is deliberately excluded from exported backups.

You bring your own API key, which means the only network request Promptary ever makes is the one you trigger: sending an image to the AI model service you configured yourself. Nothing else ever leaves your device.

Open source — every claim above can be verified in the code:
https://github.com/dingge001/promptary
```

中文:

```
Promptary 把你在网上看到的任意图片,变成一条真正能用的提示词。

市面上多数「图片转提示词」工具给你的是一段画面描述——那不是提示词,你还得自己重写一遍。Promptary 直接按目标生图工具要求的格式生成:

• Stable Diffusion —— 逗号标签串 + 权重 + 画质词 + 负向词
• FLUX —— 完整句子;加 masterpiece 反而有害,所以不加
• Midjourney —— 简洁描述 + 尾部 --ar / --style / --v 参数
• GPT-Image —— 详细长段落,它对长描述的理解很好
• nano banana —— 自然描述式语言
• Seedream —— 中文,这是它最擅长的

选一次目标模型,之后每条提示词都是复制即用的成品。

怎么用

在任意网站的图片上右键,选「反推这张图的提示词」,几秒后就能拿到可复制、可编辑、可直接投喂生图工具的提示词。鼠标悬停在图片上也会浮现一个小按钮,快捷键 Alt+Shift+P 可以直接反推光标所指的图。

满意的提示词可以存进收藏库,分类、打标签、搜索、以后随时复用。要出图时,一键把提示词注入生图工具的输入框,不用来回复制粘贴。

为「你自己的库」而做

• 分类(树状)与标签(多对多)两套组织方式
• 全文搜索,覆盖标题、提示词、标签、备注
• 回收站可恢复,误删不会是致命的
• 全部内容可导出为 JSON,或导出到文件夹(图片落成独立文件)
• 支持 English、简体中文、繁體中文、日本語、한국어

数据始终是你的

没有账号,不用注册,没有埋点,没有遥测。Promptary 没有服务器。

你的图片、提示词、标签都存在浏览器的本地数据库里,不会上传给我们。API 密钥与收藏内容分开存放,并刻意排除在导出的备份之外。

模型接口由你自己提供,这意味着 Promptary 唯一一次网络请求就是你主动触发的那次:把图片发送到你自己配置的 AI 模型服务。除此之外,你的数据不会离开设备。

项目开源,以上每一条都能在代码里核实:
https://github.com/dingge001/promptary
```

## 4. 类别

```
Productivity
```

## 5. 单一用途说明(Single purpose)

商店表单里必填。英文:

```
Promptary has a single purpose: to reverse-engineer images into AI art prompts, and to let users save, organise and reuse those prompts.

Every feature serves that purpose — the right-click menu extracts a prompt from an image, the side panel is where saved prompts are organised, and the "insert into page" action sends a saved prompt back into an image-generation tool.
```

## 6. 权限用途说明

表单会逐条问你为什么需要每个权限。以下是建议答案:

**`contextMenus`**
```
The right-click menu is the primary way users invoke the extension. It adds "Reverse-engineer this image", "Save this image" and "Save selected text as a prompt".
```

**`storage`**
```
Stores the user's own settings (chosen AI model endpoint, interface language, theme) and their API key locally. Nothing stored here is transmitted anywhere.
```

**`sidePanel`**
```
Hosts the main interface — the library where saved prompts are browsed, searched, filed into categories and tagged.
```

**`activeTab`**
```
When the user triggers an action, reads the current tab's URL and title so the saved item can record where it came from. Used only in direct response to a user action.
```

**`scripting`**
```
If the user invokes reverse-engineering from the right-click menu on a page that was already open before the extension was installed, the content script is not present yet. This permission injects it once so the action still works, instead of failing silently.
```

**`<all_urls>` (host permission)** — 这条最关键,审核重点看
```
Promptary works on any website because users find reference images anywhere — artist sites, social feeds, blogs, shops.

This permission is used only in direct response to a user action, to:
1. read the image the user right-clicked, so it can be analysed
2. list the images on the current page, so the user can pick one
3. insert prompt text into an input box when the user clicks "Insert into page"
4. display the hover button over images

The extension does not run in the background, does not read pages the user has not acted on, and does not transmit page content anywhere on its own. The only outbound network request the extension ever makes is to the AI model endpoint the user configured themselves.
```

## 7. 数据使用声明

在「数据使用」表单中:

| 问题 | 选择 |
| --- | --- |
| 是否收集或使用用户数据? | **不收集**(扩展本身不向开发者传输任何数据) |
| 是否出售用户数据? | 否 |
| 是否将数据用于与单一用途无关的目的? | 否 |
| 是否用于确定信用度或放贷? | 否 |

三条认证全部勾选。

**注意**:虽然扩展自身不收集数据,但反推时用户主动把图片发给**用户自己配置的模型服务**。这一点已在详细说明和隐私政策中明确披露。如果表单里有额外备注栏,建议补充:

```
The extension itself collects and transmits nothing. When the user requests image analysis, the image is sent by the user's browser directly to the AI model endpoint the user configured — the developer operates no server and receives no data.
```

## 8. 隐私政策 URL

```
https://dingge001.github.io/promptary/PRIVACY
```

## 9. 图片素材(需要你自己截)

| 素材 | 尺寸 | 是否必需 |
| --- | --- | --- |
| 商店图标 | 128×128 | 必需(已有:`public/icon/128.png`) |
| 截图 | 1280×800 或 640×400 | **至少 1 张**,最多 5 张 |
| 小型宣传图 | 440×280 | 可选 |
| 大型宣传图 | 1400×560 | 可选 |

**建议截这四张**(按顺序,第一张最重要):

1. **反推结果面板** —— 网页右下角那个面板,展示提示词和标签。这是产品的核心瞬间。
2. **侧边栏库视图** —— 缩略图网格 + 分类/标签筛选,体现"收藏管理"。
3. **设置页的模型选择** —— 那 6 个模型卡片,体现"按模型区分"这个差异化。
4. **提示词注入生图工具** —— 或者详情页,展示从收藏到使用的闭环。

**截图注意**:

- 尺寸必须精确,不能用默认截图直接提交(商店会拒绝)
- 建议在**浅色主题**下截,缩略图更好看
- 内容要有真实数据(先反推几张图,别用空库截图)
