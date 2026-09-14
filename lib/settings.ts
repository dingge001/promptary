import type { AppSettings } from './db/types';
import { DEFAULT_MODEL_ID } from './vision/models';

/**
 * 设置存在 chrome.storage.local,与 IndexedDB 里的业务数据物理隔离。
 *
 * 这样做的直接好处:「导出备份」只会导出收藏内容,API Key 天然不会被带出去,
 * 用户把备份文件分享给别人时不会泄露密钥。
 */
export const SETTINGS_STORAGE_KEY = 'promptary_settings';

export const DEFAULT_SETTINGS: AppSettings = {
  provider: {
    // 默认指向 DeepSeek(OpenAI 兼容协议),用户改成任何兼容服务都能用
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-v4-flash-vision-exp',
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

/** 判断模型服务是否已配置完整,未配置时 UI 应引导用户去设置页 */
export function isProviderReady(settings: AppSettings): boolean {
  const { baseUrl, apiKey, model } = settings.provider;
  return Boolean(baseUrl.trim() && apiKey.trim() && model.trim());
}
