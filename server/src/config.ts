/**
 * 服务端配置。
 *
 * 全部从环境变量读,启动时一次性校验完 —— 缺 key 就立刻退出,而不是等
 * 第一个用户请求进来才 500。配额类配置都有保守的默认值,运维忘了配也不会
 * 落到「无限额度」这种最坏情况上。
 */

export interface Config {
  port: number;
  host: string;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  upstreamModel: string;
  /** 单个设备每天可用次数 */
  dailyDeviceLimit: number;
  /** 全局每天总调用上限,触顶即整体停服 —— 防破产的最后一道闸 */
  dailyGlobalBudget: number;
  /** 强制的输出上限,忽略客户端传入值 */
  maxOutputTokens: number;
  upstreamTimeoutMs: number;
  /** 请求体上限。1536px 的图转 base64 约 500KB,留足余量但不容忍滥用 */
  maxBodyBytes: number;
  dbPath: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[promptary-api] 缺少必需的环境变量:${name}`);
    process.exit(1);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    console.error(`[promptary-api] 环境变量 ${name} 不是有效的非负数:${raw}`);
    process.exit(1);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    port: num('PORT', 8788),
    // 默认只监听本机:生产环境让 Nginx 在前面反代,不给外面留直连入口
    host: process.env.HOST?.trim() || '127.0.0.1',

    upstreamBaseUrl: process.env.UPSTREAM_BASE_URL?.trim() || 'https://api.deepseek.com',
    upstreamApiKey: required('UPSTREAM_API_KEY'),
    upstreamModel: process.env.UPSTREAM_MODEL?.trim() || 'deepseek-flash',

    dailyDeviceLimit: num('DAILY_DEVICE_LIMIT', 3),
    dailyGlobalBudget: num('DAILY_GLOBAL_BUDGET', 5000),
    maxOutputTokens: num('MAX_OUTPUT_TOKENS', 512),
    upstreamTimeoutMs: num('UPSTREAM_TIMEOUT_MS', 60_000),
    maxBodyBytes: num('MAX_BODY_BYTES', 4 * 1024 * 1024),

    dbPath: process.env.DB_PATH?.trim() || './data/quota.db',
  };
}
