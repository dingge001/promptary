import type { Config } from './config.js';
import type { ChatMessage } from './validate.js';

/**
 * 关掉推理模型的思考模式。
 *
 * 三个理由:
 *   1. 正确性 —— 思考 token 会先吃掉 max_tokens 预算。实测 1024 全部被
 *      reasoning 用光、content 返回空字符串、finish_reason=length,用户拿到
 *      一个空提示词
 *   2. 延迟 —— 思考那几秒对「右键反推」这种交互是纯浪费
 *   3. 成本 —— 思考 token 按输出价计费,能占掉单次开销的大头
 *
 * 反推提示词是看图说话,不需要深度推理。
 *
 * 按模型名判断而不是无条件加:OpenAI 官方收到不认识的字段会直接返回 400。
 * 当前上游写死是 deepseek-flash,但 .env 允许改 —— 无条件加的话,
 * 哪天换个模型就把服务打挂了。
 */
function thinkingPatch(model: string): Record<string, unknown> {
  return model.toLowerCase().includes('deepseek') ? { thinking: { type: 'disabled' } } : {};
}

/**
 * 转发到上游模型服务。
 *
 * 三个参数是强制覆盖的,不采纳客户端传来的值:
 *   model       —— 否则用户能拿我们的 key 去调任意贵的模型
 *   max_tokens  —— 否则一次请求就能把整天的预算烧掉
 *   temperature —— 反推要的是稳定复现,不是创意发挥
 *
 * 响应由调用方按 OpenAI 兼容形状回给客户端,这样扩展侧不必为内置额度
 * 单独写一套解析逻辑。
 */
export async function callUpstream(cfg: Config, messages: ChatMessage[]): Promise<string> {
  const url = `${cfg.upstreamBaseUrl.replace(/\/+$/, '')}/chat/completions`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.upstreamApiKey}`,
      },
      body: JSON.stringify({
        model: cfg.upstreamModel,
        messages,
        temperature: 0.3,
        max_tokens: cfg.maxOutputTokens,
        response_format: { type: 'json_object' },
        ...thinkingPatch(cfg.upstreamModel),
      }),
      signal: AbortSignal.timeout(cfg.upstreamTimeoutMs),
    });
  } catch (err) {
    // 超时、DNS、连接被拒都归到这里。调用方据此退还配额 ——
    // 我们连不上上游不是用户的错
    throw new UpstreamError(0, `连接上游失败:${(err as Error).message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new UpstreamError(res.status, `上游返回 ${res.status}:${detail.slice(0, 300)}`);
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[];
  } | null;

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new UpstreamError(0, '上游返回了空内容');
  }

  return content;
}

/**
 * 上游调用失败。
 *
 * 带回上游的 status 是为了让调用方区分「限流,退配额」和「鉴权失败,退配额但要告警」,
 * 但 message 只写进服务端日志,不会原样回给客户端 —— 上游的报错正文里
 * 可能带着不该外泄的细节。
 */
export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}
