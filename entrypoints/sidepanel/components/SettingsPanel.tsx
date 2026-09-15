import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppSettings, PromptLanguage, ProviderConfig, ProviderMode } from '@/lib/db/types';
import {
  BUILTIN_MODEL,
  BUILTIN_VENDOR,
  fetchQuota,
  type QuotaInfo,
} from '@/lib/providers/builtin';
import { testConnection } from '@/lib/providers/openai';
import { listCategories } from '@/lib/db/repo';
import { saveSettings } from '@/lib/settings';
import { getModelProfile, MODEL_PROFILES, resolveLanguage } from '@/lib/vision/models';
import { buildSystemPrompt } from '@/lib/vision/schema';
import { categoryLabel } from '@/lib/i18n';
import DataSection from './DataSection';
import { getLocale, LOCALE_LABELS, LOCALES, t } from '@/lib/i18n';
import { IconBolt, IconCopy, IconEye, IconEyeOff, IconGithub } from './icons';
import { Button, Input, Select, Switch } from './ui';

interface Props {
  settings: AppSettings;
  onChanged: () => void;
}

/** 常见服务预设。模型名可能随服务商更新,以官方文档为准 */
const PRESETS = [
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash-vision-exp',
  },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  {
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-VL-72B-Instruct',
  },
];

const MODEL_GROUP_KEYS: Record<string, string> = {
  标签系: 'modelGroup.tag',
  自然语言系: 'modelGroup.natural',
  参数系: 'modelGroup.param',
  中文系: 'modelGroup.chinese',
};

const labelCls = 'mb-1 block text-[10px] font-medium text-neutral-400';

export default function SettingsPanel({ settings, onChanged }: Props) {
  const [draft, setDraft] = useState<ProviderConfig>(settings.provider);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string }>();
  const [showKey, setShowKey] = useState(false);
  const [promptPreview, setPromptPreview] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);

  /**
   * 按当前设置重新拼一份 system prompt。
   * 换模型 / 换提示词语言 / 开关自动归类,拼出来的东西都不一样 ——
   * 预览开着的时候这些一变就得跟着刷新,否则看到的是过期的文本。
   */
  const refreshPreview = useCallback(async () => {
    const profile = getModelProfile(settings.defaultModelId);
    const lang = resolveLanguage(profile, settings.promptLanguage, getLocale());
    const cats = settings.autoCategorize
      ? (await listCategories()).map((c) => categoryLabel(c.name))
      : [];
    setPromptPreview(buildSystemPrompt(profile, cats, lang));
  }, [settings.defaultModelId, settings.promptLanguage, settings.autoCategorize]);

  useEffect(() => {
    if (previewOpen) void refreshPreview();
  }, [previewOpen, refreshPreview]);

  useEffect(() => {
    setDraft(settings.provider);
  }, [settings.provider]);

  /**
   * 失焦时落盘,而不是每次按键都写。
   * 用户改配置时最容易忘的就是「改完没保存」,所以不设保存按钮,自动存。
   */
  const commit = async (patch: Partial<ProviderConfig>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    await saveSettings({ provider: next });
    onChanged();
  };

  const runTest = async () => {
    setTesting(true);
    setTestMsg(undefined);
    try {
      // 先落盘再测,保证测的就是用户眼前这份配置
      await saveSettings({ provider: draft });
      onChanged();
      const reply = await testConnection(draft);
      setTestMsg({ ok: true, text: t('settings.testOk', { reply }) });
    } catch (err) {
      setTestMsg({ ok: false, text: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const switchMode = async (mode: ProviderMode) => {
    await saveSettings({ providerMode: mode });
    onChanged();
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      <section className="mb-5">
        <h2 className="mb-2 text-xs font-semibold">{t('settings.provider')}</h2>

        {/* 渠道二选一。默认落在官方渠道:新用户不必先去注册一个模型服务 */}
        <div className="mb-3 space-y-1">
          <ChannelOption
            active={settings.providerMode === 'builtin'}
            title={t('settings.channelBuiltin')}
            hint={t('settings.channelBuiltinHint')}
            onSelect={() => void switchMode('builtin')}
          />
          <ChannelOption
            active={settings.providerMode === 'custom'}
            title={t('settings.channelCustom')}
            hint={t('settings.channelCustomHint')}
            onSelect={() => void switchMode('custom')}
          />
        </div>

        {settings.providerMode === 'builtin' ? (
          <BuiltinChannel />
        ) : (
          <CustomChannel
            draft={draft}
            setDraft={setDraft}
            commit={commit}
            testing={testing}
            testMsg={testMsg}
            runTest={runTest}
            showKey={showKey}
            setShowKey={setShowKey}
            setTestMsg={setTestMsg}
          />
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-xs font-semibold">{t('settings.defaultModel')}</h2>
        <p className="mb-2 text-[10px] leading-relaxed text-neutral-400">
          {t('settings.defaultModelHint')}
        </p>

        <div className="space-y-1">
          {MODEL_PROFILES.map((m) => {
            const active = settings.defaultModelId === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={async () => {
                  await saveSettings({ defaultModelId: m.id });
                  onChanged();
                }}
                className={`w-full rounded-lg border p-2 text-left transition-colors ${
                  active
                    ? 'border-accent bg-accent-soft dark:bg-blue-950/30'
                    : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium">{m.name}</span>
                  <span className="rounded bg-neutral-100 px-1 py-0.5 text-[9px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {t(MODEL_GROUP_KEYS[m.group] ?? 'modelGroup.tag')}
                  </span>
                  {active && <span className="ml-auto text-[9px] text-accent">{t('settings.currentDefault')}</span>}
                </div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-neutral-400">{t(m.hintKey)}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] text-ink-2">{t('settings.promptLanguage')}</div>
            <div className="truncate text-[10px] text-ink-3">{t('settings.promptLanguageHint')}</div>
          </div>
          <Select
            size="sm"
            className="w-24 shrink-0"
            value={settings.promptLanguage}
            onChange={async (v) => {
              await saveSettings({ promptLanguage: v as PromptLanguage });
              onChanged();
            }}
            options={[
              { value: 'auto', label: t('settings.langAuto') },
              { value: 'zh', label: t('settings.langZh') },
              { value: 'en', label: t('settings.langEn') },
            ]}
          />
        </div>

        {settings.promptLanguage === 'zh' && settings.defaultModelId === 'stable-diffusion' && (
          <p className="mt-2 rounded-md bg-amber-50 p-2 text-[10px] leading-relaxed text-amber-700 dark:bg-amber-950/30 dark:text-amber-500">
            {t('settings.sdChineseWarning')}
          </p>
        )}

        {/* 调试入口。这是「出问题时才需要」的功能,配一整个标题加说明,
            对多数用户只是噪音 —— 折成一行文字链接,并挪到目标模型下面
            (它展示的正是这个模型档案拼出来的 system prompt) */}
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          className="mt-3 text-[10px] text-accent hover:underline"
        >
          {previewOpen ? t('settings.promptPreviewHide') : t('settings.promptPreview')}
        </button>

        {previewOpen && promptPreview && (
          <div className="mt-2">
            <pre className="max-h-72 overflow-auto rounded-lg bg-neutral-100 p-2 text-[10px] leading-relaxed whitespace-pre-wrap select-all dark:bg-neutral-900">
              {promptPreview}
            </pre>
            <Button
              size="xs"
              className="mt-1"
              icon={<IconCopy className="h-3 w-3" />}
              onClick={() => navigator.clipboard.writeText(promptPreview)}
            >
              {t('common.copy')}
            </Button>
          </div>
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-xs font-semibold">{t('settings.behavior')}</h2>

        <div className="mb-2">
          <Switch
            label={t('settings.hoverButton')}
            checked={settings.hoverButton}
            onChange={async (v) => {
              await saveSettings({ hoverButton: v });
              onChanged();
            }}
          />
        </div>
        <p className="mb-3 text-[10px] leading-relaxed text-neutral-400">
          {t('settings.hoverButtonHint')}
        </p>

        <div className="mb-2">
          <Switch
            label={t('settings.autoCategorize')}
            checked={settings.autoCategorize}
            onChange={async (v) => {
              await saveSettings({ autoCategorize: v });
              onChanged();
            }}
          />
        </div>

        <div className="mb-2">
          <Switch
            label={t('settings.autoCreateTags')}
            checked={settings.autoCreateTags}
            onChange={async (v) => {
              await saveSettings({ autoCreateTags: v });
              onChanged();
            }}
          />
        </div>

        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-ink-2">{t('settings.uiLanguage')}</span>
          <Select
            size="sm"
            className="w-28 shrink-0"
            value={settings.locale}
            onChange={async (v) => {
              await saveSettings({ locale: v as AppSettings['locale'] });
              onChanged();
            }}
            options={[
              { value: 'auto', label: t('settings.themeSystem') },
              ...LOCALES.map((id) => ({ value: id, label: LOCALE_LABELS[id] })),
            ]}
          />
        </div>

        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-ink-2">{t('settings.theme')}</span>
          <Select
            size="sm"
            className="w-24 shrink-0"
            value={settings.theme}
            onChange={async (v) => {
              await saveSettings({ theme: v as AppSettings['theme'] });
              onChanged();
            }}
            options={[
              { value: 'system', label: t('settings.themeSystem') },
              { value: 'light', label: t('settings.themeLight') },
              { value: 'dark', label: t('settings.themeDark') },
            ]}
          />
        </div>
      </section>

      <DataSection />

      {settings.providerMode === 'custom' && (
        <p className="text-[10px] leading-relaxed text-neutral-400">
          {t('settings.apiKeyNote')}
        </p>
      )}

      {/* 沉到最下面,只留一个入口 —— 项目说明和问题反馈都能从仓库页进去,
          没必要在设置页里各占一行 */}
      <a
        href="https://github.com/dingge001/promptary"
        target="_blank"
        rel="noreferrer"
        className="mt-5 flex items-center gap-2 rounded-lg border border-line p-2 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
      >
        <IconGithub className="h-4 w-4 shrink-0" />
        <span className="font-medium">{t('settings.githubRepo')}</span>
        <span className="ml-auto text-ink-3">↗</span>
      </a>
    </div>
  );
}

/** 渠道单选项。样式对齐「目标模型」那组卡片,让两处选择看起来是一套东西 */
function ChannelOption({
  active,
  title,
  hint,
  onSelect,
}: {
  active: boolean;
  title: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-2 text-left transition-colors ${
        active
          ? 'border-accent bg-accent-soft dark:bg-blue-950/30'
          : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium">{title}</span>
        {active && (
          <span className="ml-auto text-[9px] text-accent">{t('settings.currentChannel')}</span>
        )}
      </div>
      <div className="mt-0.5 text-[10px] leading-relaxed text-neutral-400">{hint}</div>
    </button>
  );
}

/**
 * 官方渠道。
 *
 * 服务商和模型是只读的 —— 用户选的就是「用官方提供的」,让他改这两个字段
 * 没有意义,只会让请求对不上服务端的配置。想换服务就切到「自己配置」。
 */
function BuiltinChannel() {
  const [quota, setQuota] = useState<QuotaInfo>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void fetchQuota().then((q) => {
      // 组件可能已经卸载,这时 setState 是无意义的
      if (cancelled) return;
      setQuota(q);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const remaining = quota ? Math.max(0, quota.limit - quota.used) : undefined;

  return (
    <div className="rounded-lg border border-line p-2">
      <ReadOnlyRow label={t('settings.vendor')} value={BUILTIN_VENDOR} />
      <ReadOnlyRow label={t('settings.model')} value={BUILTIN_MODEL} />

      <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
        <span className="text-[10px] text-neutral-400">{t('settings.quotaRemaining')}</span>
        <span className="text-[11px] font-medium text-ink">
          {loading
            ? t('settings.quotaLoading')
            : remaining === undefined || !quota
              ? t('settings.quotaUnavailable')
              : t('settings.quotaValue', { remaining, limit: quota.limit })}
        </span>
      </div>

      <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">
        {t('settings.quotaResetHint')}
      </p>
      {/* 走官方渠道意味着请求要过我们的服务器,这一点必须让用户看到 */}
      <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">
        {t('settings.builtinPrivacy')}
      </p>
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[10px] text-neutral-400">{label}</span>
      <span className="text-[11px] text-ink-2">{value}</span>
    </div>
  );
}

interface CustomChannelProps {
  draft: ProviderConfig;
  setDraft: (config: ProviderConfig) => void;
  commit: (patch: Partial<ProviderConfig>) => Promise<void>;
  testing: boolean;
  testMsg?: { ok: boolean; text: string };
  runTest: () => Promise<void>;
  showKey: boolean;
  setShowKey: Dispatch<SetStateAction<boolean>>;
  setTestMsg: (message?: { ok: boolean; text: string }) => void;
}

/** 用户自带的模型服务。这一块和以前完全一样,只是现在被折进了「自己配置」下面 */
function CustomChannel({
  draft,
  setDraft,
  commit,
  testing,
  testMsg,
  runTest,
  showKey,
  setShowKey,
  setTestMsg,
}: CustomChannelProps) {
  return (
    <>
      <p className="mb-2 text-[10px] leading-relaxed text-neutral-400">
        {t('settings.providerHint')}
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <Button
            key={p.name}
            size="sm"
            onClick={() => commit({ baseUrl: p.baseUrl, model: p.model })}
          >
            {p.name}
          </Button>
        ))}
      </div>

      <label className={labelCls}>{t('settings.baseUrl')}</label>
      <Input
        value={draft.baseUrl}
        onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
        onBlur={() => commit({ baseUrl: draft.baseUrl })}
        placeholder="https://api.deepseek.com/v1"
        className="mb-2"
      />

      <label className={labelCls}>API Key</label>
      <Input
        type={showKey ? 'text' : 'password'}
        value={draft.apiKey}
        onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
        onBlur={() => commit({ apiKey: draft.apiKey })}
        placeholder="sk-..."
        className="mb-2"
        suffix={
          <>
            <Button
              size="xs"
              square
              variant="ghost"
              title={showKey ? t('settings.hideKey') : t('settings.showKey')}
              icon={showKey ? <IconEyeOff className="h-3 w-3" /> : <IconEye className="h-3 w-3" />}
              onClick={() => setShowKey((v) => !v)}
            />
            <Button
              size="xs"
              square
              variant="ghost"
              title={t('settings.copyKey')}
              icon={<IconCopy className="h-3 w-3" />}
              onClick={async () => {
                await navigator.clipboard.writeText(draft.apiKey);
                setTestMsg({ ok: true, text: t('settings.keyCopied') });
              }}
            />
          </>
        }
      />

      <label className={labelCls}>{t('settings.model')}</label>
      <Input
        value={draft.model}
        onChange={(e) => setDraft({ ...draft, model: e.target.value })}
        onBlur={() => commit({ model: draft.model })}
        placeholder="deepseek-flash"
        className="mb-2"
      />

      <label className={labelCls}>{t('settings.transfer')}</label>
      <Select
        value={draft.imageTransfer}
        onChange={(v) => commit({ imageTransfer: v as ProviderConfig['imageTransfer'] })}
        className="mb-1 w-full"
        options={[
          { value: 'auto', label: t('settings.transferAuto') },
          { value: 'url', label: t('settings.transferUrl') },
          { value: 'base64', label: t('settings.transferBase64') },
        ]}
      />
      <p className="mb-3 text-[10px] leading-relaxed text-neutral-400">
        {t('settings.transferHint')}
      </p>

      <Button
        variant="primary"
        onClick={runTest}
        disabled={testing}
        className="h-8 w-full"
        icon={<IconBolt />}
      >
        {testing ? t('settings.testing') : t('settings.test')}
      </Button>

      {testMsg && (
        <div
          className={`mt-2 rounded-md p-2 text-[10px] leading-relaxed ${
            testMsg.ok
              ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400'
              : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
          }`}
        >
          {testMsg.text}
        </div>
      )}
    </>
  );
}
