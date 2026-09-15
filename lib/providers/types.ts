/** 文本内容块 */
export interface TextPart {
  type: 'text';
  text: string;
}

/**
 * 图片内容块。
 *
 * url 字段既接受公网 http(s) 地址,也接受 `data:image/jpeg;base64,...` 形式,
 * 这正是 OpenAI 兼容协议的约定,DeepSeek / OpenAI / 各类中转都遵循。
 * detail 控制模型侧的图像缩放策略:low 更省 token,high 保细节。
 */
export interface ImagePart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

export type ContentPart = TextPart | ImagePart;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/**
 * 官方渠道的剩余额度。
 *
 * 定义在协议层而不是 builtin.ts,是因为它要穿过 chatCompletion ——
 * 让通用调用层反过来依赖具体渠道的类型,层次就倒了。
 */
export interface QuotaInfo {
  used: number;
  limit: number;
  /** 额度重置时刻(毫秒时间戳) */
  resetAt: number;
}

export interface ChatOptions {
  /** 要求模型返回严格 JSON */
  json?: boolean;
  signal?: AbortSignal;
  /**
   * 响应头里带回的额度。
   *
   * 只有官方渠道会带(自带 Key 没有这个概念),所以是可选的 ——
   * 调用方不传就当作不关心。
   */
  onQuota?: (quota: QuotaInfo) => void;
}

/** 模型服务调用失败的统一错误类型,便于 UI 区分「配置错」和「网络错」 */
export class ProviderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
