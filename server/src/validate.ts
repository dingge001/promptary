/**
 * 请求校验。
 *
 * 这个代理只干一件事:把一张图反推成提示词。校验的目的不是防御精巧的攻击,
 * 而是堵住最省事的那条滥用路径 —— 把它当免费 LLM 网关使。
 * 通用对话请求拿不出图片,也就过不了这一关。
 *
 * 至于 prompt 的具体内容,这里刻意不管:模型档案是客户端的单一来源
 * (lib/vision/models.ts),服务端硬校验文案会制造一份需要同步的副本,
 * 改一次档案就要重新部署服务端。配上强制的输出上限和图片要求,
 * 放开文案的收益远大于风险。
 */

/** system prompt 的长度上限。正常档案约 900~1500 字符,留足余量 */
const MAX_SYSTEM_CHARS = 4000;

export interface ChatMessage {
  role: string;
  content: unknown;
}

export type ValidationResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; error: string };

/** content 是否为合法的图片来源:公网地址或内联 data URL */
function isImagePart(part: unknown): boolean {
  if (typeof part !== 'object' || part === null) return false;

  const p = part as Record<string, unknown>;
  if (p['type'] !== 'image_url') return false;

  const imageUrl = p['image_url'];
  if (typeof imageUrl !== 'object' || imageUrl === null) return false;

  const url = (imageUrl as Record<string, unknown>)['url'];
  if (typeof url !== 'string') return false;

  return /^https?:\/\//i.test(url) || /^data:image\//i.test(url);
}

/** user 消息里是否至少带了一张图 */
function hasImage(messages: ChatMessage[]): boolean {
  return messages.some((m) => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return false;
    return m.content.some(isImagePart);
  });
}

export function validateAnalyzeRequest(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: '请求体必须是 JSON 对象' };
  }

  const messages = (body as Record<string, unknown>)['messages'];
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'messages 必须是非空数组' };
  }

  const parsed: ChatMessage[] = [];
  for (const raw of messages) {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: 'messages 的元素必须是对象' };
    }
    const m = raw as Record<string, unknown>;
    if (typeof m['role'] !== 'string') {
      return { ok: false, error: 'messages 的元素缺少 role' };
    }
    parsed.push({ role: m['role'], content: m['content'] });
  }

  const system = parsed.find((m) => m.role === 'system');
  if (system && typeof system.content === 'string' && system.content.length > MAX_SYSTEM_CHARS) {
    return { ok: false, error: `system prompt 超过 ${MAX_SYSTEM_CHARS} 字符` };
  }

  // 这一条是关键:没有图的请求不是反推请求,直接拒绝
  if (!hasImage(parsed)) {
    return { ok: false, error: '请求中必须包含图片(image_url)' };
  }

  return { ok: true, messages: parsed };
}

/**
 * 设备标识。
 *
 * 由客户端生成并持久化,格式上只接受 UUID,避免有人拿它当任意长度的
 * 字符串塞进数据库 —— 主键列被灌进几 KB 的长字符串会让索引膨胀得很厉害。
 */
export function readDeviceId(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}
