import { Hono, type Context } from 'hono';
import type { Config } from './config.js';
import type { QuotaStore, QuotaSnapshot } from './quota.js';
import { callUpstream, UpstreamError } from './upstream.js';
import { readDeviceId, validateAnalyzeRequest } from './validate.js';

/**
 * HTTP 层。
 *
 * 和入口(index.ts)分开,是为了能被端到端测试直接 import —— 入口一执行就会
 * 监听端口,没法在测试里复用。
 *
 * 端点刻意做成 OpenAI 兼容的 /v1/chat/completions:扩展侧只要把 baseUrl
 * 指过来就能用,现有的调用与解析逻辑一行都不用改。
 */

/**
 * 只放行扩展来源。
 *
 * Origin 由浏览器强制写上,页面脚本伪造不了,所以这一条挡掉了
 * 「写个网页直接调我们的接口」这种最省事的刷法。挡不住的是自己写个扩展 ——
 * 那需要真的开发并安装,门槛高得多,剩下的交给设备配额和全局预算。
 *
 * 没有 Origin 的请求(curl、服务端调用)一律放行:无法区分它和正常的
 * 非浏览器调用,而全局预算已经把最坏情况兜住了。
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return (
    /^chrome-extension:\/\//i.test(origin) ||
    // 本地联调用
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  );
}

/** 每 IP 每分钟的请求上限 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_IP = 30;

/**
 * 速率计数只放在内存里,不落盘。阈值定得宽松到正常用户永远碰不到 ——
 * 目的不是限制人,而是让脚本狂刷时服务还能喘气,别把当天的全局预算
 * 在几分钟内烧光、让后面的人一个都用不上。
 *
 * 刻意不保留任何 IP 记录:进程重启即清空,这也让隐私政策里
 * 「不存储 IP」这句话是成立的。
 */
const ipHits = new Map<string, { count: number; resetAt: number }>();

export function hitRateLimit(ip: string, now: number): boolean {
  const entry = ipHits.get(ip);

  if (!entry || now >= entry.resetAt) {
    // 顺手清理过期条目,免得 Map 无限长大
    if (ipHits.size > 10_000) {
      for (const [key, value] of ipHits) {
        if (now >= value.resetAt) ipHits.delete(key);
      }
    }
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_MAX_PER_IP;
}

/** 仅供测试重置速率计数 */
export function resetRateLimit(): void {
  ipHits.clear();
}

/**
 * 取客户端地址。
 *
 * 直接信 X-Forwarded-For 是安全的,前提是服务只监听本机(见 config 的默认
 * host)—— 那就只有本机的 Nginx 能连进来,这个头必然是它写的。
 * 若哪天把 host 改成 0.0.0.0,这里立刻变成可伪造,必须同步改。
 */
function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';

  // Node 适配器把原始 socket 挂在 env.incoming 上
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? 'unknown';
}

/** 配额信息走响应头而不是 body —— body 要保持 OpenAI 兼容形状,扩展侧才不用改解析 */
function setQuotaHeaders(c: Context, snapshot: QuotaSnapshot): void {
  c.header('X-Quota-Used', String(snapshot.used));
  c.header('X-Quota-Limit', String(snapshot.limit));
  c.header('X-Quota-Reset', String(snapshot.resetAt));
}

/** 错误形状对齐 OpenAI,让扩展侧的既有错误处理能直接读懂 */
function errorBody(message: string, type: string): { error: { message: string; type: string } } {
  return { error: { message, type } };
}

export function createApp(cfg: Config, quota: QuotaStore): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    if (!isAllowedOrigin(origin)) {
      return c.json(errorBody('来源不受支持', 'forbidden'), 403);
    }

    if (origin) c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, X-Device-Id');
    // 不暴露这几个头的话,扩展侧读不到剩余额度
    c.header('Access-Control-Expose-Headers', 'X-Quota-Used, X-Quota-Limit, X-Quota-Reset');
    c.header('Vary', 'Origin');

    if (c.req.method === 'OPTIONS') return c.body(null, 204);

    await next();
  });

  app.get('/healthz', (c) =>
    c.json({ ok: true, model: cfg.upstreamModel, global: quota.globalUsage() }),
  );

  /**
   * 查今日额度,不扣减。
   *
   * 设置页靠它显示「今天还剩几次」—— 总不能等用户反推一次才知道自己还有多少。
   */
  app.get('/v1/quota', (c) => {
    const deviceId = readDeviceId(c.req.header('x-device-id'));
    if (!deviceId) {
      return c.json(errorBody('缺少或非法的 X-Device-Id', 'bad_device_id'), 400);
    }
    return c.json(quota.peek(deviceId));
  });

  app.post('/v1/chat/completions', async (c) => {
    const now = Date.now();

    if (hitRateLimit(clientIp(c), now)) {
      return c.json(errorBody('请求过于频繁,请稍后再试', 'rate_limited'), 429);
    }

    const deviceId = readDeviceId(c.req.header('x-device-id'));
    if (!deviceId) {
      return c.json(errorBody('缺少或非法的 X-Device-Id', 'bad_device_id'), 400);
    }

    // 先按声明长度挡一道。base64 图片是大请求体的唯一来源,拦在解析之前更省事
    if (Number(c.req.header('content-length') ?? '0') > cfg.maxBodyBytes) {
      return c.json(errorBody('请求体过大', 'payload_too_large'), 413);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody('请求体不是合法 JSON', 'bad_json'), 400);
    }

    const validated = validateAnalyzeRequest(body);
    if (!validated.ok) {
      return c.json(errorBody(validated.error, 'invalid_request'), 400);
    }

    // 先扣后调:检查与扣减在同一个事务里,不留超发窗口
    const consumed = quota.consume(deviceId, now);
    if (!consumed.ok) {
      setQuotaHeaders(c, consumed.snapshot);

      if (consumed.reason === 'global') {
        // 熔断。文案不要提「额度」,否则用户会以为是自己的问题、反复重试
        return c.json(errorBody('免费服务今日已满负荷,请明天再试', 'budget_exhausted'), 503);
      }

      return c.json(
        errorBody(
          `今天的免费额度已用完(${consumed.snapshot.limit} 次/天)。明天会重置,` +
            `也可以在设置里填入自己的 API Key,那样不受次数限制`,
          'quota_exceeded',
        ),
        429,
      );
    }

    try {
      const content = await callUpstream(cfg, validated.messages);
      setQuotaHeaders(c, consumed.snapshot);

      return c.json({
        id: `promptary-${now}`,
        object: 'chat.completion',
        created: Math.floor(now / 1000),
        model: cfg.upstreamModel,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      });
    } catch (err) {
      // 我们自己出问题不该算在用户头上
      quota.refund(deviceId);

      // 详细原因只写日志:上游的报错正文可能带着不该外泄的细节
      console.error('[promptary-api] 上游调用失败', err);
      if (err instanceof UpstreamError && (err.status === 401 || err.status === 403)) {
        console.error('[promptary-api] 上游鉴权失败 —— 检查 UPSTREAM_API_KEY 是否有效或余额是否耗尽');
      }

      return c.json(errorBody('模型服务暂时不可用,请稍后再试', 'upstream_error'), 502);
    }
  });

  return app;
}
