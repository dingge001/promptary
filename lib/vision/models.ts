/**
 * 目标模型档案 —— 整个产品的核心。
 *
 * 反推出来的提示词不是「一种东西」,而是「多种方言」。同一个画面:
 *   Stable Diffusion 要逗号标签串 + 权重 + 画质词 + 负向词
 *   FLUX 要完整句子,而且加 masterpiece 这类词反而有害(CFG-distilled,不吃这套)
 *   Midjourney 要简洁描述 + 尾部 -- 参数
 *   Seedream 用中文描述效果最好
 *
 * 不区分模型的「图片转提示词」,产出的东西必然有一半是废的 ——
 * 用户拿到手还得自己重写一遍,那这个插件就没有存在价值。
 *
 * 每条规则都会直接拼进 system prompt,改动这里的文案就等于调整模型行为。
 */

export interface ModelProfile {
  id: string;
  name: string;
  /** UI 上的分组 */
  group: string;
  /** 给用户看的一句话说明的 i18n key,由 UI 侧翻译 */
  hintKey: string;
  /**
   * 格式规则,逐条写进 system prompt。
   *
   * 分语言写两套,而不是写一套再翻译 —— 英文语料训练的模型(SD / FLUX)
   * 对英文指令的遵循度更高,而且英文用户看预览时得能读懂。
   */
  rules: { zh: string[]; en: string[] };
  /** few-shot 示例。示例比规则更能约束住模型的行为 */
  example: string;
  output: {
    language: 'en' | 'zh';
    /** 负向提示词对这个模型是否有意义 */
    negative: boolean;
    /** 是否需要画质词(masterpiece / best quality 之类) */
    qualityTags: boolean;
    /** 参数后缀的参考写法 */
    paramsHint?: string;
  };
}

export const MODEL_PROFILES: ModelProfile[] = [
  {
    id: 'stable-diffusion',
    name: 'Stable Diffusion',
    group: '标签系',
    hintKey: 'model.sd.hint',
    rules: {
      zh: [
        '输出逗号分隔的英文标签串,不要写成完整句子。',
        '按「主体 → 外观特征 → 动作姿态 → 服装 → 环境背景 → 构图镜头 → 光线 → 画质词」的顺序排列。',
        '关键元素可以用权重语法强调,如 (silver hair:1.2);最多用两处,滥用会让画面崩坏。',
        '必须包含画质词,通常用 masterpiece, best quality, highly detailed。',
        '负向词针对这张图容易出现的问题给,常用底层词包括 lowres, bad anatomy, extra fingers, watermark。',
        '人物图要写清人数与特征词(如 1girl, solo),这是 SD 系最容易翻车的地方。',
      ],
      en: [
        'Output a comma-separated tag string. Do not write full sentences.',
        'Order the tags: subject → appearance → pose → clothing → environment → composition → lighting → quality words.',
        'Emphasise key elements with weight syntax like (silver hair:1.2); at most two, overuse degrades the image.',
        'Always include quality words, typically masterpiece, best quality, highly detailed.',
        'Give negative tags targeting what this image is likely to get wrong; common baselines include lowres, bad anatomy, extra fingers, watermark.',
        'For people, state the count and identity tags (e.g. 1girl, solo) — this is where SD models fail most often.',
      ],
    },
    example:
      '1girl, solo, long silver hair, red eyes, from side, black coat, standing, rainy city street at night, neon lights, bokeh, depth of field, cinematic lighting, masterpiece, best quality, highly detailed',
    output: { language: 'en', negative: true, qualityTags: true },
  },
  {
    id: 'flux',
    name: 'FLUX',
    group: '自然语言系',
    hintKey: 'model.flux.hint',
    rules: {
      zh: [
        '写成一段完整、连贯的英文描述,像在向摄影师交代要拍什么。',
        '不要堆砌逗号标签 —— FLUX 对标签串的响应明显不如自然语言。',
        '不要加 masterpiece、best quality 这类画质词,对 FLUX 无效,反而会把画面带偏。',
        '不要输出负向词,该字段留空字符串。',
        '把材质、光线方向、景深、氛围具体写出来,FLUX 对这些细节的还原度很高。',
      ],
      en: [
        'Write a complete, flowing description in English, as if briefing a photographer on what to shoot.',
        'Do not pile up comma-separated tags — FLUX responds noticeably worse to tag strings than to natural language.',
        'Do not add quality words like masterpiece or best quality; they have no effect on FLUX and can skew the image.',
        'Do not output a negative prompt; leave that field as an empty string.',
        'Spell out materials, light direction, depth of field and mood — FLUX reproduces these details very faithfully.',
      ],
    },
    example:
      'A young woman with long silver hair stands in profile on a rain-soaked city street at night. Neon signs cast blue and magenta reflections across the wet pavement. She wears a black coat, and the camera holds a shallow depth of field so she stays sharp against the softly blurred background.',
    output: { language: 'en', negative: false, qualityTags: false },
  },
  {
    id: 'midjourney',
    name: 'Midjourney',
    group: '参数系',
    hintKey: 'model.mj.hint',
    rules: {
      zh: [
        '用简洁的英文短语描述画面,聚焦主体、动作、环境与氛围,不要长篇铺陈。',
        '不要用逗号堆砌形容词,MJ 更看重画面感强的核心词。',
        '末尾必须附上参数,形如 --ar 3:2 --style raw --v 7;横竖构图按图片实际比例给 --ar。',
        '不要输出负向词;如果确实需要排除某个元素,用 --no xxx 的参数形式写进 prompt 末尾。',
      ],
      en: [
        'Describe the image with concise English phrases, focusing on subject, action, setting and mood. Do not write at length.',
        'Do not stack adjectives with commas — MJ responds to strong visual keywords, not volume.',
        'Always append parameters at the end, e.g. --ar 3:2 --style raw --v 7; set --ar to match the actual aspect ratio of the image.',
        'Do not output a negative prompt. To exclude an element, use --no xxx as a parameter at the end of the prompt.',
      ],
    },
    example:
      'a young woman with long silver hair in profile, rainy neon city street at night, reflections in puddles, cinematic --ar 3:2 --style raw --v 7',
    output: {
      language: 'en',
      negative: false,
      qualityTags: false,
      paramsHint: '--ar 3:2 --style raw --v 7',
    },
  },
  {
    id: 'gpt-image',
    name: 'GPT-Image',
    group: '自然语言系',
    hintKey: 'model.gptImage.hint',
    rules: {
      zh: [
        '写成详细、准确的英文段落,把画面当成一份交给画师的 brief。',
        '可以写长 —— 这个模型对长描述的理解力很好,信息给足了还原度更高。',
        '把光线方向、材质质感、镜头视角、画面色调都具体交代清楚。',
        '不要加画质词(它不认这类词),不要输出参数,不要输出负向词。',
      ],
      en: [
        'Write a detailed, precise English paragraph — treat it as a brief handed to an illustrator.',
        'Length is fine. This model understands long descriptions well, and more information means a closer reproduction.',
        'Be specific about light direction, material texture, camera angle and overall colour cast.',
        'Do not add quality words (it does not recognise them), do not output parameters, and do not output a negative prompt.',
      ],
    },
    example:
      'A portrait-oriented photograph of a young woman with long silver hair, shown in profile on a rain-soaked city street at night. She wears a black wool coat. Neon signage in blue and magenta reflects across the wet pavement and across her face. The camera sits at eye level with a shallow depth of field, keeping her features sharp while the background falls softly out of focus.',
    output: { language: 'en', negative: false, qualityTags: false },
  },
  {
    id: 'nano-banana',
    name: 'nano banana',
    group: '自然语言系',
    hintKey: 'model.nanoBanana.hint',
    rules: {
      zh: [
        '用自然、描述性的英文写出画面内容,语气接近日常描述,不要写成参数化的指令。',
        '按「画面里有什么 → 它们的状态与相互关系 → 整体氛围与风格」组织。',
        '不要用标签堆砌,不要画质词,不要参数,不要负向词。',
        '如果画面中出现文字,把文字内容原样写出来并说明位置 —— 这个模型的文字渲染很准,值得保留。',
      ],
      en: [
        'Describe the image content in natural, descriptive English, close to everyday speech rather than parameterised instructions.',
        'Organise it as: what is in the frame → their state and relationships → overall mood and style.',
        'Do not pile up tags, do not add quality words, parameters, or a negative prompt.',
        'If the image contains text, write the text out verbatim and say where it appears — this model renders text accurately, so it is worth preserving.',
      ],
    },
    example:
      'A young woman with long silver hair is seen in profile on a rainy city street at night. She wears a black coat, and neon signs reflect in the puddles around her feet. The scene has a cinematic, moody atmosphere with cool blue and magenta tones.',
    output: { language: 'en', negative: false, qualityTags: false },
  },
  {
    id: 'seedream',
    name: 'Seedream',
    group: '中文系',
    hintKey: 'model.seedream.hint',
    rules: {
      zh: [
        '用中文写描述,符合中文语序,不要输出英文标签串。',
        '写成通顺的中文句子或短语串,像在向画师描述你想要的画面。',
        '把主体、环境、光线、氛围、画面风格按自然顺序交代清楚。',
        '不要加画质词,不要输出参数,不要输出负向词。',
      ],
      en: [
        'Write the description in Chinese, following natural Chinese word order. Do not output English tag strings.',
        'Write flowing Chinese sentences or phrases, as if describing the image you want to an illustrator.',
        'Cover subject, environment, lighting, mood and visual style in a natural order.',
        'Do not add quality words, do not output parameters, and do not output a negative prompt.',
      ],
    },
    example:
      '一位留着银色长发的年轻女子侧身站在雨夜的街道上,霓虹灯的光倒映在积水中,她穿着黑色外套,画面呈电影感,浅景深,背景虚化。',
    output: { language: 'zh', negative: false, qualityTags: false },
  },
];

/** 默认目标模型。GPT-Image 对自然语言的理解最稳,新用户开箱效果最好 */
export const DEFAULT_MODEL_ID = 'gpt-image';

export function getModelProfile(id: string | undefined): ModelProfile {
  return MODEL_PROFILES.find((m) => m.id === id) ?? MODEL_PROFILES[0]!;
}

/**
 * 定下这次反推用什么语言写提示词。
 *
 * 用户显式选了语言就听用户的,选 auto 才跟随模型惯例 ——
 * 但要注意:Stable Diffusion 系的标签是用英文语料训练的,强制中文会明显掉质量,
 * 所以 UI 上得把这个代价讲清楚。
 */
export function resolveLanguage(
  profile: ModelProfile,
  preference: 'auto' | 'zh' | 'en',
  uiLocale?: string,
): 'zh' | 'en' {
  if (preference === 'zh') return 'zh';
  if (preference === 'en') return 'en';

  // auto:跟随界面语言。中文界面 → 中文提示词,其余一律英文。
  //
  // 刻意不再优先看模型惯例(Seedream 本来偏中文):用户能直接感知和调整的
  // 是界面语言,让默认行为跟着它走,比藏在模型档案里的偏好直观得多 ——
  // 也省掉一个需要用户理解的概念。真想要特定语言,显式选就是。
  if (uiLocale) return uiLocale.toLowerCase().startsWith('zh') ? 'zh' : 'en';

  return profile.output.language;
}
