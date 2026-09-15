import type { PromptFields } from '../db/types';
import { t } from '../i18n';
import type { ModelProfile } from './models';

/**
 * 反推的提示词工程。
 *
 * system prompt 不是写死的,而是按目标模型档案动态拼装 ——
 * 换个模型就换一套规则和示例,这是「同一个画面给不同模型不同写法」的实现方式。
 *
 * 普通 VL 模型的默认行为是输出「一位银发少女站在雨中…」这类散文,
 * 那是图片解说不是提示词。这套规则的作用就是把它掰成目标模型真正吃得下的形状。
 */
export function buildSystemPrompt(
  profile: ModelProfile,
  categories: string[] = [],
  language?: 'zh' | 'en',
): string {
  const wantsCategory = categories.length > 0;
  const lang = language ?? profile.output.language;

  const zh = lang === 'zh';

  const shape = zh
    ? `{
  "prompt": "按上述要求写好的中文提示词",
  "negative": "${profile.output.negative ? '负向提示词,逗号分隔' : '留空字符串'}",
  "tags": ["标签1", "标签2"]${wantsCategory ? ',\n  "category": "分类名"' : ''}
}`
    : `{
  "prompt": "the prompt written in English as specified above",
  "negative": "${profile.output.negative ? 'negative prompt, comma separated' : 'empty string'}",
  "tags": ["tag1", "tag2"]${wantsCategory ? ',\n  "category": "category name"' : ''}
}`;

  const parts = zh
    ? [
        `你是资深的 AI 绘画提示词工程师。用户给你一张图片,你要把它逆向成**可以直接粘进 ${profile.name} 就能出图**的提示词。`,
        '',
        `【${profile.name} 的格式要求】`,
        ...profile.rules.zh.map((rule, i) => `${i + 1}. ${rule}`),
        '',
        '【通用铁律】',
        '1. 你产出的是提示词,不是图片解说。严禁出现"这张图""画面中""展示了""描绘了"这类叙述词。',
        '2. 不要写主观评价(如"很漂亮""构图精美""很有感觉"),只写具体的视觉特征。',
        '3. 判断不出来的细节就略过,严禁编造图中不存在的内容。',
        '4. 只输出 JSON 对象本身,不要 markdown 代码块,不要任何前后解释文字。',
        '',
        '【输出 JSON 结构】',
        shape,
        '',
        '【示例】',
        profile.example,
        '',
        'tags 请给 3 到 8 个便于归档检索的短标签,用中文,如"银发""赛博朋克""俯视构图""厚涂"。',
      ]
    : [
        `You are a senior AI art prompt engineer. The user gives you an image, and you reverse-engineer it into a prompt that can be **pasted straight into ${profile.name}** to produce an image.`,
        '',
        `[Format requirements for ${profile.name}]`,
        ...profile.rules.en.map((rule, i) => `${i + 1}. ${rule}`),
        '',
        '[Universal rules]',
        '1. You produce a prompt, not a description of the image. Never write phrases like "this image", "in the picture", "shows" or "depicts".',
        '2. No subjective judgement (such as "beautiful" or "well composed") — only concrete visual traits.',
        '3. If a detail cannot be determined, leave it out. Never invent content that is not in the image.',
        '4. Output the JSON object only. No markdown code fences, no explanatory text before or after.',
        '',
        '[Output JSON structure]',
        shape,
        '',
        '[Example]',
        profile.example,
        '',
        'tags: give 3 to 8 short labels for archiving and search, in English, e.g. "silver hair", "cyberpunk", "top-down composition", "thick paint".',
      ];

  // 语言指示放在最后,用来压过模型规则里的语言措辞 ——
  // 比如 SD 的规则写着「英文标签串」,用户选了中文时得覆盖掉它。
  //
  // 措辞要收着点:只声明「语言」这一件事上的优先级,并明说其他格式要求照常。
  // 写成「一律以本条为准」这种强措辞,模型可能过度解读成可以忽略其他规则。
  parts.push(
    '',
    zh ? '【输出语言】' : '[Output language]',
    zh
      ? 'prompt、negative 和 tags 三个字段都用中文书写。本条只决定语言,上面其他格式要求照常遵守;若上面的规则里提到「英文」,仅在该语言描述上以本条为准。'
      : 'prompt, negative and tags must all be written in English. This rule only decides language; follow every other formatting requirement above as usual. If a rule above mentions Chinese, this rule overrides it for that language description only.',
  );

  if (wantsCategory) {
    const list = categories.join(' / ');
    parts.push(
      '',
      zh ? '【分类】' : '[Category]',
      zh
        ? `从下面这些已有分类里挑一个最贴切的填进 category 字段:${list}`
        : `Pick the single most fitting category from the list below and put it in the category field: ${list}`,
      zh
        ? '都不合适就填空字符串,不要硬凑 —— 归错类比不归类更麻烦。'
        : 'If none fits, use an empty string. Do not force a match — a wrong category is worse than none.',
    );
  }

  return parts.join('\n');
}

/**
 * 给模型的那句话。
 *
 * 刻意不带来源页面的标题和地址。它们对反推的边际价值很低 —— 图片本身
 * 已经说明了一切,而地址多半是 xxx.net/artworks/12345 这种对写提示词
 * 毫无帮助的东西。但送出去的却是「用户此刻在看哪个网页」,那属于浏览记录,
 * 不该为了这点收益离开用户的设备。
 *
 * 溯源要用的地址和标题仍然照常记进收藏项,那些只留在本地。
 */
export function buildUserPrompt(profile: ModelProfile, language: 'zh' | 'en' = 'zh'): string {
  return language === 'zh'
    ? `请把这张图片逆向成可用于 ${profile.name} 的提示词。`
    : `Reverse-engineer this image into a prompt usable with ${profile.name}.`;
}

// ---------------------------- 解析 ----------------------------

/** 模型偶尔仍会裹一层 markdown 代码块,这里做剥离 */
function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/** 从模型返回里抠出 JSON 对象,容忍前后夹杂的少量噪声 */
function extractJson(text: string): Record<string, unknown> {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    // 退一步:取第一个 { 到最后一个 } 之间的内容再试
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* 落到下面统一抛错 */
      }
    }
    throw new Error(t('error.badJson'));
  }
}

const asText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 字符串数组字段的容错:模型有时会返回 "a, b, c" 这样的字符串而不是数组 */
const asList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(asText).filter(Boolean);
  if (typeof v === 'string') {
    return v
      .split(/[,,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

/** 兜底拼接:万一模型没给 prompt 字段,用其他字段凑一条出来 */
function joinFallback(obj: Record<string, unknown>): string {
  return [
    obj.subject,
    obj.style,
    obj.composition,
    obj.lighting,
    obj.color,
    ...asList(obj.qualityTags),
  ]
    .map(asText)
    .filter(Boolean)
    .join(', ');
}

/**
 * 把模型返回的原始文本解析成结构化字段。
 *
 * 全程容错:字段缺失或类型不对都不抛错,退化成空值或兜底拼接,
 * 保证用户至少能拿到一条可用的提示词,而不是一个红色报错。
 * 同时兼容旧字段名(promptEn / subject 等),换模型时不会因为字段名差异直接失败。
 */
export function parsePromptFields(raw: string): PromptFields {
  const obj = extractJson(raw);

  const prompt =
    asText(obj.prompt) ||
    asText(obj.promptEn) ||
    asText(obj.promptZh) ||
    joinFallback(obj);

  if (!prompt) throw new Error(t('error.noPrompt'));

  return {
    prompt,
    // negative 可能是字符串,也可能是数组
    negative: asText(obj.negative) || asList(obj.negative).join(', '),
    tags: asList(obj.tags),
    category: asText(obj.category),
    raw,
  };
}

/** 生成收藏项标题:截断到适合卡片展示的长度 */
export function deriveTitle(fields: PromptFields, fallback = '图片反推'): string {
  const base = fields.prompt || fallback;
  return base.length > 40 ? `${base.slice(0, 40)}…` : base;
}

/**
 * 网页上选中的文字转成结构化字段。
 *
 * 文字收藏不走模型 —— 用户选中的往往已经是整理好的提示词,
 * 再过一遍模型只会画蛇添足,还平白多花一次调用的钱和几秒等待。
 */
export function textOnlyFields(text: string): PromptFields {
  return { prompt: text, negative: '', tags: [] };
}
