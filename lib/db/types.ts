import type { Locale } from '../i18n';

/**
 * Promptary 数据模型
 *
 * 所有业务表遵守「同步友好」三条约定,为二阶段的云同步预留能力:
 *   1. 主键一律用 UUID,绝不用自增 ID —— 多设备下自增必然冲突
 *   2. 删除一律软删除(deletedAt 墓碑)—— 物理删除后,同步端无从得知"这条被删了"
 *   3. 每条记录都带 updatedAt —— 同步时做增量比对的时间基准
 *
 * 这三条现在加成本为零,事后补要迁移全量用户数据。
 */

/** 所有可同步记录的共同字段 */
export interface Syncable {
  /** UUID v4,由客户端生成 */
  id: string;
  /** 创建时间(毫秒时间戳) */
  createdAt: number;
  /** 最后修改时间(毫秒时间戳),增量同步的比对依据 */
  updatedAt: number;
  /** 软删除墓碑。非空即视为已删除,UI 一律过滤掉 */
  deletedAt?: number;
  /**
   * 同步状态。V1 全部为 'local',二阶段接云同步时才会流转。
   * 预埋此字段是为了让同步逻辑不必回填历史数据。
   */
  syncState?: 'local' | 'pending' | 'synced';
}

/** 收藏项来源 */
export type ItemSource = 'image' | 'text';

/**
 * 反推结果。
 *
 * 刻意不把提示词拆成「主体/风格/光线/色彩」这类散字段 ——
 * 用户要的是一条能直接粘进去出图的东西,拆开只会增加拼装负担,
 * 而且不同目标模型需要的排列方式本来就不同,拆开反而写不对。
 */
export interface PromptFields {
  /** 提示词本体。已按目标模型的格式生成,复制即用 */
  prompt: string;
  /** 负向提示词。只有标签系模型(Stable Diffusion 等)有值,其余为空 */
  negative: string;
  /** 模型抽出的归档标签,入库时并入标签体系 */
  tags: string[];
  /** 模型判断最合适的分类名。没把握时为空字符串,不要硬凑 */
  category?: string;
  /** 模型原始返回,排查问题用 */
  raw?: string;
}

/** 一条收藏记录:可以是图片反推结果,也可以是网页上选中的一段文字 */
export interface PromptItem extends Syncable {
  source: ItemSource;

  /** 标题。默认取模型摘要或页面标题,用户可改 */
  title: string;

  // ---------- 图片字段(source === 'image' 时有值)----------
  /** 原图 Blob。直接存二进制而非 base64,省 33% 体积 */
  imageBlob?: Blob;
  /** 缩略图 Blob。列表只加载它,避免为渲染一张卡片解码整张原图 */
  thumbnailBlob?: Blob;
  /** 原图地址,溯源与「重新拉取」用 */
  imageUrl?: string;
  width?: number;
  height?: number;

  // ---------- 提示词内容 ----------
  prompt?: PromptFields;
  /** 这条提示词是为哪个目标模型生成的,对应 lib/vision/models.ts 里的档案 id */
  targetModel?: string;

  // ---------- 溯源 ----------
  /** 收藏时的页面地址 */
  sourceUrl?: string;
  /** 收藏时的页面标题 */
  sourceTitle?: string;
  /** 站点域名,用于按来源筛选 */
  sourceSite?: string;
  /** 作者/画师,能解析到时才有 */
  author?: string;

  // ---------- 组织维度 ----------
  /** 所属分类 —— 分类是树,单一归属。需要多归属时请用标签 */
  categoryId?: string;
  /** 标签 id 列表,多对多 */
  tagIds: string[];

  /** 是否星标 */
  starred: boolean;
  /** 用户备注 */
  note?: string;
}

/** 分类 —— 树状结构,单一归属,当文件夹用 */
export interface Category extends Syncable {
  name: string;
  /** 父分类 id。顶层为 undefined */
  parentId?: string;
  /** 同级排序权重 */
  order: number;
  /** 内置分类不可删除 */
  builtin?: boolean;
}

/** 标签 —— 扁平多对多,用于跨分类检索 */
export interface Tag extends Syncable {
  name: string;
  /** 归一化名(小写、折叠空白),用于去重和匹配 */
  normalized: string;
  /** 引用计数,用于「热门标签」排序与清理孤立标签 */
  count: number;
  /** 展示用颜色 */
  color?: string;
  /** 标签分组,如「风格」「人物」「场景」 */
  group?: string;
}

/**
 * 应用设置 —— 存在 chrome.storage.local,不进 IndexedDB。
 *
 * 关键设计:设置与业务数据物理隔离,所以「导出备份」天然不会带出 API Key,
 * 用户分享备份文件时不会泄露密钥。
 */
/**
 * 提示词输出语言。
 * auto = 跟随目标模型的惯例(Seedream 中文,其余英文)
 */
export type PromptLanguage = 'auto' | 'zh' | 'en';

export interface AppSettings {
  /**
   * 走哪条模型渠道。
   *
   * builtin - Promptary 官方提供的免费渠道。开箱即用、不必注册与充值,
   *           代价是有每日次数限制,且请求要经过官方服务器转发
   * custom  - 用户自己的 OpenAI 兼容服务,不受次数限制
   */
  providerMode: ProviderMode;
  /**
   * 用户自带的模型服务配置。
   *
   * 即使当前用的是官方渠道,这份配置也原样留着 —— 两边分开存,
   * 用户来回切换时才不会把自己的 Key 弄丢。
   */
  provider: ProviderConfig;
  /** 默认目标模型:反推时按它的格式生成提示词。对应 lib/vision/models.ts 的档案 id */
  defaultModelId: string;
  /** 提示词用哪种语言输出。auto 跟随模型惯例 */
  promptLanguage: PromptLanguage;
  /** 界面语言。auto 跟随浏览器 */
  locale: Locale | 'auto';
  /** 反推后是否自动收藏(默认只预览,用户确认才入库) */
  autoSaveAfterAnalyze: boolean;
  /** 落库时是否自动创建模型抽出的标签 */
  autoCreateTags: boolean;
  /** 是否让模型判断这条该归入哪个分类 */
  autoCategorize: boolean;
  /** 鼠标悬停在网页图片上时,是否显示快捷反推按钮 */
  hoverButton: boolean;
  /** 主题 */
  theme: 'system' | 'light' | 'dark';
}

/** 模型渠道:官方免费渠道,还是用户自带的 */
export type ProviderMode = 'builtin' | 'custom';

/** OpenAI 兼容的模型服务配置 */
export interface ProviderConfig {
  /** 服务地址,如 https://api.deepseek.com/v1 */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 模型名,如 deepseek-v4-flash-vision-exp */
  model: string;
  /** 可选:自定义请求头 */
  headers?: Record<string, string>;
  /** 采样温度 */
  temperature?: number;
  /**
   * 图片传输方式偏好。
   * auto   - 优先公网 URL 直传,失败再降级为 base64(推荐,省流量且避开 CORS)
   * url    - 只用 URL 直传
   * base64 - 只用 base64
   */
  imageTransfer: 'auto' | 'url' | 'base64';
}
