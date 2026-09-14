import type { ProviderConfig } from '../db/types';
import { t } from '../i18n';
import { ProviderError, type ChatMessage, type ChatOptions } from './types';

/**
 * 拼接接口地址。容忍用户把 baseUrl 填成带或不带结尾斜杠的形式。
 */
function joinUrl(base: string, path: string): string {
  return `${base.trim().replace(/\/+$/, '')}${path}`;
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
  };

  // JSON Output:让模型直接吐结构化结果,省掉一轮「从散文里抠 JSON」的脆弱解析
  if (opts.json) {
    body.response_format = { type: 'json_object' };
  }

  let res: Response;
  try {
    res = await fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
        ...cfg.headers,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ProviderError(0, t('error.connectFailed', { message: (err as Error).message }));
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
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
    choices?: { message?: { content?: unknown } }[];
  } | null;

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
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
