import type { ProviderConfig } from '../db/types';
import { t } from '../i18n';
import { ProviderError, type ChatMessage, type ChatOptions, type QuotaInfo } from './types';

/**
 * 拼接接口地址。容忍用户把 baseUrl 填成带或不带结尾斜杠的形式。
 */
function joinUrl(base: string, path: string): string {
  return `${base.trim().replace(/\/+$/, '')}${path}`;
}

/**
 * 关掉推理模型的思考模式。
 *
 * 为什么要关:思考 token 会先吃掉输出预算(实测 1024 被 reasoning 用光时
 * content 是空字符串),而且那几秒延迟对「右键反推」这种交互是纯浪费。
 * 反推提示词是看图说话,不需要深度推理。
 *
 * 为什么不能无条件加:OpenAI 官方收到不认识的字段会直接返回 400
 * (Unrecognized request argument supplied),别的厂商也可能严格校验。
 * 所以只对确认支持的服务打这个补丁。
 *
 * 按模型名而不是域名判断:用户接中转站或 OpenRouter 时域名五花八门,
 * 但模型名里一定还带着 deepseek。
 */
/** 思考模式开关的字段名。打补丁和降级重试都要用,写成常量免得两处拼错 */
const THINKING_FIELD = 'thinking';

function thinkingPatch(cfg: ProviderConfig): Record<string, unknown> {
  const target = `${cfg.model} ${cfg.baseUrl}`.toLowerCase();
  return target.includes('deepseek') ? { [THINKING_FIELD]: { type: 'disabled' } } : {};
}

/**
 * 从响应头读剩余额度。
 *
 * 头不全或不是数字就当没有 —— 这是纯展示用的信息,不值得为它报错。
 * 自带 Key 的渠道根本不会带这几个头,自然也不会走到这里。
 */
function readQuota(headers: Headers): QuotaInfo | undefined {
  // 必须先判 null 再转数字:headers.get() 没有该头时返回 null,
  // 而 Number(null) 是 0 —— 直接 isFinite 检查会把它当成一个合法的 0,
  // 于是自带 Key 的渠道被误报成「剩 0 次」
  const usedRaw = headers.get('X-Quota-Used');
  const limitRaw = headers.get('X-Quota-Limit');
  if (usedRaw === null || limitRaw === null) return undefined;

  const used = Number(usedRaw);
  const limit = Number(limitRaw);
  if (!Number.isFinite(used) || !Number.isFinite(limit)) return undefined;

  const resetAtRaw = headers.get('X-Quota-Reset');
  const resetAt = resetAtRaw === null ? Number.NaN : Number(resetAtRaw);
  return { used, limit, resetAt: Number.isFinite(resetAt) ? resetAt : 0 };
}

/**
 * 从 OpenAI 形状的错误体里取 message。
 *
 * 取不到就返回 undefined,交给调用方走通用兜底 —— 有的中转站返回的是
 * 一段 HTML 或纯文本,不能假设它一定是 JSON。
 *
 * 截断是因为这段话会直接进界面:上游返回一段超长文本时不该把布局撑破。
 */
function readServerMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed?.error?.message;
    if (typeof message !== 'string') return undefined;

    const trimmed = message.trim();
    if (!trimmed) return undefined;
    return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
  } catch {
    return undefined;
  }
}

/**
 * 调用 OpenAI 兼容的 chat/completions 接口。
 *
 * 之所以只做这一种协议:DeepSeek、OpenAI、OpenRouter、硅基流动、各类中转站
 * 全部兼容它。用户换成任何一家,都只是改 baseUrl + model 两行配置,
 * 不需要为每家写适配器。
 *
 * 注意:请求从扩展的 Service Worker 发出,在 host_permissions 加持下不受
 * 页面 CORS 限制,因此可以直接调用任意厂商接口。
 */
export async function chatCompletion(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  if (!cfg.apiKey?.trim()) {
    throw new ProviderError(0, t('error.noApiKey'));
  }
  if (!cfg.baseUrl?.trim() || !cfg.model?.trim()) {
    throw new ProviderError(0, t('error.noBaseUrl'));
  }

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature ?? 0.3,
    ...thinkingPatch(cfg),
  };

  // JSON Output:让模型直接吐结构化结果,省掉一轮「从散文里抠 JSON」的脆弱解析
  if (opts.json) {
    body.response_format = { type: 'json_object' };
  }

  /** 发一次请求。抽出来是为了让降级重试能复用,免得把 header 和错误处理抄一遍 */
  const send = async (payload: Record<string, unknown>): Promise<Response> => {
    try {
      return await fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey.trim()}`,
          ...cfg.headers,
        },
        body: JSON.stringify(payload),
        signal: opts.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw new ProviderError(0, t('error.connectFailed', { message: (err as Error).message }));
    }
  };

  let res = await send(body);

  // 静默降级:有的服务不认 thinking 字段,会直接回 400(OpenAI 官方就是)。
  // 按模型名判断难免有漏网的 —— 比如模型名带 deepseek、服务却是自己实现的。
  //
  // 之所以敢在这里无脑重试:400 意味着请求被拒,根本没跑到模型上,
  // 所以重试的代价只是一次网络往返,不会重复计费。而如果不重试,
  // 用户会对着一个他既看不懂、也无从解决的报错 —— 那才是真正的体验失败。
  if (res.status === 400 && THINKING_FIELD in body) {
    const withoutThinking = { ...body };
    delete withoutThinking[THINKING_FIELD];
    res = await send(withoutThinking);
  }

  // 额度在成功和失败(429)时都会有,所以统一在这里读一次再往下走
  const quota = readQuota(res.headers);
  if (quota) opts.onQuota?.(quota);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');

    // 服务端自己给的话通常比我们拼的通用文案准确:官方渠道额度用完时,
    // 那句提示是写给用户看的,直接透出去;它还会告诉他可以换成自己的 Key
    const serverMessage = readServerMessage(detail);
    if (serverMessage) throw new ProviderError(res.status, serverMessage);

    // 401/403 是最常见的配置错误,给出可操作的提示而不是甩一段原始报文
    const hint =
      res.status === 401 || res.status === 403
        ? t('error.invalidKey')
        : res.status === 404
          ? t('error.badUrl')
          : res.status === 429
            ? t('error.rateLimit')
            : '';
    throw new ProviderError(
      res.status,
      t('error.httpStatus', { status: res.status, hint: hint ? ` (` + hint + `) ` : '', detail: detail.slice(0, 300) }),
    );
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: {
      message?: { content?: unknown; reasoning_content?: unknown };
      finish_reason?: string;
    }[];
  } | null;

  const choice = data?.choices?.[0];
  const content = choice?.message?.content;

  if (typeof content !== 'string' || !content.trim()) {
    // 推理模型把输出预算全花在思考上时,上游会返回 200 + 空 content。
    // 这个形状光看报错完全指不出方向 —— 用户只看到「模型返回了空内容」,
    // 根本想不到是思考模式造成的。所以专门认一下。
    const reasoning = choice?.message?.reasoning_content;
    if (choice?.finish_reason === 'length' && typeof reasoning === 'string' && reasoning) {
      throw new ProviderError(0, t('error.thinkingAteBudget'));
    }
    throw new ProviderError(0, t('error.emptyResponse'));
  }

  return content;
}

/** 轻量连通性测试,供设置页的「测试连接」按钮使用 */
export async function testConnection(cfg: ProviderConfig): Promise<string> {
  const reply = await chatCompletion(cfg, [
    { role: 'user', content: 'Reply with exactly: OK' },
  ]);
  return reply.trim();
}
