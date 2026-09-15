import type { ProviderConfig } from '../db/types';
import type { QuotaInfo } from './types';

/**
 * Promptary 官方提供的免费渠道。
 *
 * 它解决的是这个产品最大的流失点:想用的人得先去注册一个模型服务、充值、
 * 拿到 Key、再回来填对四个字段。绝大多数人到不了最后一步。
 * 有了官方渠道,装上就能用。
 *
 * 代价是模型服务的 Key 落在我们手里,所以服务端有配额和熔断兜底
 * (见仓库根目录的 server/)。这里只负责地址、设备标识,以及把额度读出来给界面显示。
 */

/**
 * 服务端地址。
 *
 * 复用现有域名加路径,不额外申请子域和证书。末尾不带斜杠 ——
 * chatCompletion 自己会拼 /chat/completions。
 */
export const BUILTIN_BASE_URL = 'https://img.aidingge.top/promptary/v1';

/** 展示给用户看的服务商名。官方渠道下这两个是只读的 */
export const BUILTIN_VENDOR = 'DeepSeek';
export const BUILTIN_MODEL = 'deepseek-flash';

const DEVICE_ID_KEY = 'promptary_device_id';

/**
 * 设备标识,服务端靠它算每日额度。
 *
 * 存在 chrome.storage.local 而不是 IndexedDB,是为了让它天然不进导出备份 ——
 * 这是个标识符,不该跟着用户的备份文件到处走。这也和 API Key 的处理一致:
 * 设置与业务数据分离存放。
 *
 * 它是随机 UUID,与用户身份无关;重装扩展会换一个。这是「装上就能用」
 * 必须付的代价,服务端那边由全局预算兜底。
 */
export async function getDeviceId(): Promise<string> {
  const raw = await chrome.storage.local.get(DEVICE_ID_KEY);
  const existing = raw[DEVICE_ID_KEY];
  if (typeof existing === 'string' && existing) return existing;

  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

/**
 * 官方渠道对应的 ProviderConfig。
 *
 * apiKey 位放的是设备 id 而不是密钥 —— 形状复用是为了让 chatCompletion
 * 那条链路不必为官方渠道写分支。
 *
 * headers 里那份 X-Device-Id 才是服务端真正认的:chatCompletion 发的是
 * Authorization: Bearer,而服务端读的是 X-Device-Id。两处都带上是为了
 * 「配置里的 key 非空」这个前置检查能过,同时让服务端读到它要的那个头。
 */
export async function builtinProvider(): Promise<ProviderConfig> {
  const deviceId = await getDeviceId();

  return {
    baseUrl: BUILTIN_BASE_URL,
    apiKey: deviceId,
    model: BUILTIN_MODEL,
    temperature: 0.3,
    imageTransfer: 'auto',
    headers: { 'X-Device-Id': deviceId },
  };
}

// 类型定义在协议层(providers/types.ts),这里转出一次 ——
// 调用方从 builtin 拿就行,不必知道它现在住在哪
export type { QuotaInfo };

/**
 * 查今日额度。
 *
 * 失败一律返回 undefined 而不是抛错:额度只是个展示信息,
 * 读不到就不显示那一行,不该让整个设置页跟着报错。
 */
export async function fetchQuota(): Promise<QuotaInfo | undefined> {
  try {
    const deviceId = await getDeviceId();
    const res = await fetch(`${BUILTIN_BASE_URL}/quota`, {
      headers: { 'X-Device-Id': deviceId },
    });
    if (!res.ok) return undefined;

    const data = (await res.json()) as Partial<QuotaInfo>;
    if (typeof data.used !== 'number' || typeof data.limit !== 'number') return undefined;

    return { used: data.used, limit: data.limit, resetAt: data.resetAt ?? 0 };
  } catch {
    return undefined;
  }
}
