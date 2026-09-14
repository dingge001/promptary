# 设计规格:aidingge.top

> 扒取自 https://aidingge.top
> 风格定位:**Warm Editorial —— 朱砂文艺**
> 适配场景:个人作品集、内容型产品,以及**需要一点文化质感的工具类界面**

---

## 1. 设计哲学

| 维度 | 描述 |
| --- | --- |
| 整体调性 | 暖调纸感 + 单点朱砂,克制、郑重,不喧哗 |
| 视觉关键词 | 朱砂红 / 暖白纸感 / 大留白 / 衬线点题 / 柔和双层阴影 |
| 字体策略 | 品牌用书法感中文(ZCOOL XiaoWei)+ 衬线(Cormorant Garamond);正文用可变无衬线(Roboto Flex);数字与代码用 JetBrains Mono |
| 色彩策略 | **单一强调色**(朱砂 `#c13d2c`),其余全是中性灰阶。暗色模式下强调色**提亮**到 `#d95a45`,补偿低亮度环境的感知衰减 |
| 动效策略 | 全部缓出,三段入场动画,不做弹跳。尊重 `prefers-reduced-motion` |
| 内容策略 | 大段留白;英文做 eyebrow,中文做正文,双语并置 |

**一句话调性**:它不像多数科技产品那样用蓝色表达"可信",而是用朱砂红和书法体表达"郑重"——这是内容型站点才敢做的选择。

---

## 2. 设计 Token

### 2.1 颜色

亮色定义在 `:root, html[data-theme=light]`,暗色在 `html[data-theme=dark]`。**用属性切换而非媒体查询**,说明站点支持用户手动覆盖系统偏好。

```css
:root, html[data-theme="light"] {
  /* 强调色:朱砂。全局只有这一个彩色 */
  --accent:        #c13d2c;
  --accent-hover:  #a63225;
  --accent-soft:   rgba(193, 61, 44, .12);   /* 浅底,用于标签/选中态背景 */
  --accent-glow:   rgba(193, 61, 44, .28);   /* 光晕,用于聚焦环 */
  /* 辅助色仅作点缀,不参与主视觉 */
  --accent-orange: #ffa41c;
  --accent-blue:   #3084ff;
  --accent-cyan:   #19f2ff;
  --accent-red:    #ff483c;

  /* 三层背景:画布 / 卡片 / 次级面 */
  --canvas:      #f1f1f1;
  --surface:     #ffffff;
  --surface-alt: #f2f0f0;

  --border:        #e7e7e7;
  --border-strong: #d8d8d8;

  /* 三级文字 */
  --text-1: #171717;   /* 标题 */
  --text-2: #666666;   /* 正文 */
  --text-3: #a1a1aa;   /* 弱化说明 */

  /* 双层柔和阴影:一层贴边勾轮廓,一层散开做纵深 */
  --shadow:       0 1px 2px rgba(23,23,23,.05), 0 8px 24px rgba(23,23,23,.06);
  --shadow-hover: 0 4px 8px rgba(23,23,23,.07), 0 16px 40px rgba(23,23,23,.12);
  --shadow-accent:0 8px 20px rgba(193,61,44,.25);
}

html[data-theme="dark"] {
  --accent:       #d95a45;   /* 提亮,不是简单反色 */
  --accent-hover: #e66b55;
  --accent-soft:  rgba(217, 90, 69, .14);
  --accent-glow:  rgba(217, 90, 69, .32);

  --canvas:      #0d0d10;
  --surface:     #161619;
  --surface-alt: #121215;

  --border:        #26262b;
  --border-strong: #34343b;

  --text-1: #edece8;   /* 暖白,不是 #fff —— 呼应朱砂的温度 */
  --text-2: #9c9a92;
  --text-3: #5c5a55;
}
```

**配色心法**:全局只有朱砂一个彩色,所以它出现的地方就是视线焦点。想强调什么,就给什么上朱砂——不需要第二种颜色。
暗色的文字用暖白 `#edece8` 而非纯白,是因为朱砂本身偏暖,配冷白会显得脏。

### 2.2 字体

```css
:root {
  --font-brand:   "ZCOOL XiaoWei", "Cormorant Garamond", "PingFang SC", "Microsoft YaHei", serif;
  --font-display: "Be Vietnam Pro", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --font-body:    "Roboto Flex", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --font-mono:    "JetBrains Mono", "Roboto Mono", ui-monospace, monospace;
}
```

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;700;900&family=Roboto+Flex:opsz,wght@8..144,100..1000&family=JetBrains+Mono:wght@400;700&family=ZCOOL+XiaoWei&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&display=swap" rel="stylesheet">
```

分工:**品牌名**用 ZCOOL XiaoWei(书法感,只用于 logo 和 slogan,不能用于正文,笔画太细);**正文**用 Roboto Flex(可变字重,一个文件覆盖 100–1000);**数字/代码**用 JetBrains Mono(等宽,数字对齐好看)。

### 2.3 圆角 / 间距 / 缓动

```css
:root {
  --radius-sm: 8px;    /* 按钮、输入框、标签 */
  --radius-md: 20px;   /* 卡片 */
  --radius-lg: 24px;   /* 大容器、弹窗 */
  --radius-pill: 999px;/* 胶囊按钮、开关 */

  --space-1: 4px;  --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
  --space-5: 24px; --space-6: 32px;  --space-7: 48px;  --space-8: 64px;
  --space-9: 96px; --space-10: 128px;

  --ease-out:      cubic-bezier(.12, .23, .5, 1);
  --ease-out-expo: cubic-bezier(.22, 1, .36, 1);
  --ease-spring:   cubic-bezier(.34, 1.56, .64, 1);   /* 备用,主视觉里几乎不用 */

  --container: 1200px;
  --header-h: 64px;
}
```

圆角偏大(卡片 20px)是全站柔和的来源;间距走 4 的倍数,且跨度很大(4 → 128),说明留白是刻意拉开的。

---

## 3. 排版系统

```css
:root {
  --text-display-xl: clamp(48px, 6vw, 72px);
  --text-display-l:  clamp(40px, 5vw, 56px);
  --text-h2:         clamp(28px, 3.5vw, 40px);
  --text-h3: 28px;
  --text-h4: 20px;
  --text-body-l: 18px;
  --text-body:   16px;
  --text-caption:14px;
  --text-label:  12px;
}
```

用 `clamp()` 做流体排版,不写断点也能在任意宽度下平滑缩放。**标题与正文的比例接近 4:1**,对比强烈是这套设计的骨架。

---

## 4. 全局规范

- **Reset**:清掉默认 margin/padding,`box-sizing: border-box`
- **字体平滑**:`-webkit-font-smoothing: antialiased`
- **滚动条**:细窄、无按钮、颜色跟随 `--border`
- **焦点环**:用 `--accent-glow` 而不是浏览器默认蓝框
- **动效降级**:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  }
  ```

---

## 5. 组件规范

从类名可以还原出这套组件库:`hero` / `feature-card` / `carousel` / `stats-grid` / `filter-tabs` / `badge-dot`。

**卡片**(`feature-card` / `carousel-card`):
```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  transition: box-shadow .3s var(--ease-out), transform .3s var(--ease-out);
}
.card:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-2px);
}
```
hover 只做「阴影加深 + 上移 2px」,非常克制——没有缩放、没有变色。

**筛选标签**(`filter-tabs` / `filter-tab`):胶囊形,选中态用 `--accent-soft` 打底 + 朱砂文字,不用实心填充。

**徽标点**(`badge-dot`):小圆点 + 文字,用 `--accent` 或状态色。

---

## 6. 布局与栅格

| 容器 | 宽度 |
| --- | --- |
| `--container` | 1200px |
| 内容最大宽 | 约 1200px,两侧留白 |

**断点**:960px / 860px / 720px / 640px,四档。栅格用 Grid `repeat(auto-fill, minmax(...))` 自适应,不写死列数。

---

## 7. 动画与过渡

| 关键帧 | 用途 |
| --- | --- |
| `page-in` | 整页入场 |
| `fade-in` | 元素淡入 |
| `rise-in` | 上浮淡入(卡片、列表项) |

**缓动选择**:入场用 `--ease-out-expo`(起步快、收尾极缓,显得从容);hover 用 `--ease-out`(更短促)。`--ease-spring` 虽有定义但主视觉几乎不用——弹跳会破坏郑重的调性。

**时长**:hover 约 .3s,入场约 .5–.7s。

---

## 8. 资源与文件清单

- **字体**:见 2.2 的 Google Fonts 链接。中文回退到 `PingFang SC`(macOS)/ `Microsoft YaHei`(Windows)
- **图标**:站内未见图标库引用,`feature-icon` 应该是内联 SVG。建议插件也用手写内联 SVG,不引第三方图标库
- **元信息**:`--header-h: 64px`,主题用 `data-theme` 属性

---

## 9. 适配 Promptary 的建议

插件侧边栏宽度只有 320–500px,**大留白和 clamp 流体排版要按比例收窄**,但色彩、圆角梯度、动效缓动可以完整继承。

| 主站 | Promptary | 说明 |
| --- | --- | --- |
| `--text-display-xl: clamp(48px,6vw,72px)` | `clamp(18px, 4vw, 22px)` | 侧边栏放不下大标题 |
| `--radius-md: 20px` | `12px` | 小尺寸下 20px 圆角会显得圆胖 |
| `--space-5: 24px` | `12px` | 间距整体压缩约一半 |
| `--container: 1200px` | 去掉 | 侧边栏自适应宽度 |
| 朱砂 `--accent: #c13d2c` | **原样继承** | 这是识别度的来源 |
| 暖白文字 `#edece8` | **原样继承** | 暗色下尤其重要 |
| `page-in` / `rise-in` | 保留,时长减半 | 小界面里长动画显得拖沓 |

**实施 Checklist**:
- [ ] 把 Token 表写进 `assets/tailwind.css`(Tailwind v4 的 `@theme`)
- [ ] 主题切换从 `prefers-color-scheme` 改为 `data-theme` 属性,与主站一致
- [ ] 所有 `blue-600` 主色替换为朱砂
- [ ] 图标重绘为内联 SVG,线条风格统一(建议 1.5px 描边、圆头)
- [ ] 字体:插件不宜加载 6 个远程字体,建议只保留 ZCOOL XiaoWei(品牌名)+ Roboto Flex(正文)

---

## 10. 文件清单

| 文件 | 用途 |
| --- | --- |
| `design-spec.md` | 本文档 |
| `design-tokens.html` | 可视化 Token 速查表 |
| `styles.css` | 原站完整 CSS(已下载,48470 字符) |
| `fonts.md` | 字体与远程资源清单 |
| `index.html` | 原站 HTML |
