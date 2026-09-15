import { listCategories } from '../db/repo';
import { categoryLabel, getLocale } from '../i18n';
import { t } from '../i18n';
import type { AppSettings, PromptFields } from '../db/types';
import { chatCompletion } from '../providers/openai';
import { ProviderError, type ChatMessage, type QuotaInfo } from '../providers/types';
import { resolveProvider } from '../settings';
import {
  decideStrategy,
  fetchImageBlob,
  processImage,
  siteOf,
  type ProcessedImage,
} from './image';
import { getModelProfile, resolveLanguage, type ModelProfile } from './models';
import { buildSystemPrompt, buildUserPrompt, deriveTitle, parsePromptFields } from './schema';

export interface AnalyzeInput {
  /** 页面上的图片地址。可能为空,此时必须提供 imageBlob */
  imageUrl?: string;
  /** 已知的图片二进制(例如 content script 已经拿到的) */
  imageBlob?: Blob;
  pageUrl?: string;
  pageTitle?: string;
}

export interface AnalyzeResult {
  fields: PromptFields;
  title: string;
  /** 本次使用的目标模型档案 id,保存时一并记进收藏项 */
  modelId: string;
  /** 本地处理后的图片资源。走 URL 直传且未保存时可能为空 */
  processed?: ProcessedImage;
  /** 原始二进制,保存时可直接复用,避免二次下载 */
  sourceBlob?: Blob;
  /** 实际用到的传图方式,便于排查问题 */
  usedStrategy: 'url' | 'base64';
  sourceSite?: string;
}

export interface AnalyzeOptions {
  /** 目标模型档案 id;不传则用设置里的默认模型 */
  modelId?: string;
  signal?: AbortSignal;
  /** 官方渠道返回的额度,原样透传出去 —— 界面拿它显示「还剩几次」 */
  onQuota?: (quota: QuotaInfo) => void;
}

/** system prompt 按目标模型动态生成 —— 换模型就换一整套规则和示例 */
function buildMessages(
  input: AnalyzeInput,
  imageUrl: string,
  profile: ModelProfile,
  categories: string[],
  language: 'zh' | 'en',
): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt(profile, categories, language) },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: buildUserPrompt(profile, {
            pageTitle: input.pageTitle,
            pageUrl: input.pageUrl,
          }, language),
        },
        // detail: high 让模型保留细节,风格与构图判断更准
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
      ],
    },
  ];
}

/**
 * 判断哪些错误值得降级重试。
 * 鉴权失败和限流换成 base64 也一样会失败,重试纯属浪费用户时间。
 */
function worthRetrying(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return true;
  return ![401, 403, 429].includes(err.status);
}

/**
 * 反推主流程。
 *
 * 默认优先让模型服务端按 URL 自己去取图(省流量、避开本地跨域),
 * 一旦失败就自动降级为「本地下载 + base64 上传」重试一次 ——
 * 这条降级路径是必需的,因为防盗链站点相当常见。
 */
export async function analyzeImage(
  input: AnalyzeInput,
  settings: AppSettings,
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const { signal } = options;
  const profile = getModelProfile(options.modelId ?? settings.defaultModelId);

  // 官方渠道还是自带 Key,在这里分岔。只解析一次,后面全程复用
  const provider = await resolveProvider(settings);

  // 自动归类:开关打开、且用户确实建了分类时,才把分类清单交给模型判断
  const categories = settings.autoCategorize
    ? (await listCategories()).map((c) => categoryLabel(c.name))
    : [];

  const language = resolveLanguage(profile, settings.promptLanguage, getLocale());

  const sourceSite = siteOf(input.pageUrl);
  const preferred = decideStrategy(input.imageUrl, provider.imageTransfer);

  if (preferred === 'url' && input.imageUrl) {
    try {
      const raw = await chatCompletion(
        provider,
        buildMessages(input, input.imageUrl, profile, categories, language),
        { json: true, signal, onQuota: options.onQuota },
      );
      const fields = parsePromptFields(raw);
      return {
        fields,
        title: deriveTitle(fields),
        modelId: profile.id,
        usedStrategy: 'url',
        sourceSite,
      };
    } catch (err) {
      if (signal?.aborted || !worthRetrying(err)) throw err;
      // 落到下面走 base64 路径
    }
  }

  const blob =
    input.imageBlob ?? (input.imageUrl ? await fetchImageBlob(input.imageUrl) : undefined);
  if (!blob) throw new Error(t('error.noImageData'));

  const processed = await processImage(blob);
  const raw = await chatCompletion(
    provider,
    buildMessages(input, processed.dataUrl, profile, categories, language),
    { json: true, signal, onQuota: options.onQuota },
  );
  const fields = parsePromptFields(raw);

  return {
    fields,
    title: deriveTitle(fields),
    modelId: profile.id,
    processed,
    sourceBlob: blob,
    usedStrategy: 'base64',
    sourceSite,
  };
}

/**
 * 确保拿到本地图片资源。
 *
 * 走 URL 直传时本地并没有图,但用户收藏时图必须落到自己电脑上,
 * 所以这里按需补一次下载。
 */
export async function ensureLocalImage(
  input: AnalyzeInput,
  existing?: { processed?: ProcessedImage; sourceBlob?: Blob },
): Promise<ProcessedImage | undefined> {
  if (existing?.processed) return existing.processed;

  const blob =
    existing?.sourceBlob ??
    input.imageBlob ??
    (input.imageUrl ? await fetchImageBlob(input.imageUrl) : undefined);

  if (!blob) return undefined;
  return processImage(blob);
}
