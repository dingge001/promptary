import type { AppSettings, ProviderConfig } from './db/types';
import { builtinProvider } from './providers/builtin';
import { DEFAULT_MODEL_ID } from './vision/models';

/**
 * 设置存在 chrome.storage.local,与 IndexedDB 里的业务数据物理隔离。
 *
 * 这样做的直接好处:「导出备份」只会导出收藏内容,API Key 天然不会被带出去,
 * 用户把备份文件分享给别人时不会泄露密钥。
 */
export const SETTINGS_STORAGE_KEY = 'promptary_settings';

export const DEFAULT_SETTINGS: AppSettings = {
  // 默认走官方渠道:新用户装上就能用,不必先去注册模型服务
  providerMode: 'builtin',
  provider: {
    // 默认指向 DeepSeek(OpenAI 兼容协议),用户改成任何兼容服务都能用。
    // 模型名要跟着上游走:deepseek-v4-flash-vision-exp 已退役,虽然还能靠
    // 兼容路由用,但正式版是 deepseek-flash
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-flash',
    temperature: 0.3,
    imageTransfer: 'auto',
  },
  defaultModelId: DEFAULT_MODEL_ID,
  promptLanguage: 'auto',
  locale: 'auto',
  autoSaveAfterAnalyze: false,
  autoCreateTags: true,
  autoCategorize: true,
  hoverButton: true,
  theme: 'system',
};

/**
 * 读取设置。与默认值做深合并,保证版本升级后新增的配置项在
 * 老用户那里也有合理默认值,而不是 undefined。
 */
export async function getSettings(): Promise<AppSettings> {
  const raw = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const saved = raw[SETTINGS_STORAGE_KEY] as Partial<AppSettings> | undefined;

  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    provider: { ...DEFAULT_SETTINGS.provider, ...saved?.provider },
  };
}

/** 增量保存设置 */
export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const current = await getSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    provider: { ...current.provider, ...patch.provider },
  };
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
}

/**
 * 判断模型服务是否可用,不可用时 UI 应引导用户去设置页。
 *
 * 官方渠道永远算就绪 —— 它不需要用户填任何东西,这正是它存在的意义。
 */
export function isProviderReady(settings: AppSettings): boolean {
  if (settings.providerMode === 'builtin') return true;

  const { baseUrl, apiKey, model } = settings.provider;
  return Boolean(baseUrl.trim() && apiKey.trim() && model.trim());
}

/**
 * 取出这次实际要用的服务配置。
 *
 * 官方渠道的地址和模型是写死的(见 lib/providers/builtin.ts),apiKey 位放的是
 * 设备标识;用户填的那份配置原样留在 settings.provider 里,切回去时还在。
 */
export async function resolveProvider(settings: AppSettings): Promise<ProviderConfig> {
  if (settings.providerMode === 'custom') return settings.provider;
  return builtinProvider();
}
