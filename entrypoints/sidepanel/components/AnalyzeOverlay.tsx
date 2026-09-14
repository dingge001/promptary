import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import type { PromptFields } from '@/lib/db/types';
import { formatDimensions } from '@/lib/vision/image';
import { MODEL_PROFILES, getModelProfile } from '@/lib/vision/models';
import { IconCheck, IconClose, IconCopy, IconRefresh } from './icons';
import { Button, Select } from './ui';

export interface AnalysisView {
  status: 'idle' | 'running' | 'done' | 'error';
  fields?: PromptFields;
  error?: string;
  imageUrl?: string;
}

/** 用户在面板里编辑过的结果。保存时以它为准,而不是模型原始返回 */
export interface EditedFields {
  prompt: string;
  negative: string;
  tags: string[];
}

interface Props {
  state: AnalysisView;
  /** 本次反推使用的模型档案 id */
  modelId: string;
  /** 原图尺寸,用于提示用户该设什么比例 */
  sourceWidth?: number;
  sourceHeight?: number;
  /** 结果会写回这条已有收藏,而不是新建一条 */
  updating?: boolean;
  onCancel: () => void;
  onSave: (edited: EditedFields) => void;
  onDismiss: () => void;
  /** 换一个目标模型重新反推 */
  onRegenerate: (modelId: string) => void;
}

const labelCls = 'mb-1 block text-[10px] font-medium text-neutral-400';
const boxCls =
  'w-full resize-none rounded-lg bg-neutral-100 p-2 text-[11px] leading-relaxed outline-none focus:ring-1 focus:ring-accent dark:bg-neutral-900';

export default function AnalyzeOverlay({
  state,
  modelId,
  sourceWidth,
  sourceHeight,
  updating = false,
  onCancel,
  onSave,
  onDismiss,
  onRegenerate,
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [pickModel, setPickModel] = useState(modelId);
  const [copied, setCopied] = useState(false);

  const profile = getModelProfile(modelId);
  const dims = formatDimensions(sourceWidth, sourceHeight);

  // 每次拿到新结果就重置编辑区,避免上一条的内容串到下一条
  useEffect(() => {
    if (state.status === 'done' && state.fields) {
      setPrompt(state.fields.prompt);
      setNegative(state.fields.negative);
      setTags(state.fields.tags);
      setTagInput('');
    }
  }, [state.status, state.fields]);

  useEffect(() => {
    setPickModel(modelId);
  }, [modelId]);

  if (state.status === 'idle') return null;

  const addTag = () => {
    const value = tagInput.trim();
    if (value && !tags.includes(value)) setTags((prev) => [...prev, value]);
    setTagInput('');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默失败,用户还可以手动选中 */
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white/97 backdrop-blur-sm dark:bg-neutral-950/97">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <span className="text-xs font-medium">
          {state.status === 'running' && t('analyze.running')}
          {state.status === 'done' && t('analyze.title')}
          {state.status === 'error' && t('analyze.failed')}
        </span>
        {state.status === 'running' ? (
          <Button
            variant="ghost"
            size="sm"
            square
            onClick={onCancel}
            title={t('common.cancel')}
            icon={<IconClose />}
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            square
            onClick={onDismiss}
            title={t('common.close')}
            icon={<IconClose />}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {state.status === 'running' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-accent" />
            <span className="text-[11px]">{t('analyze.runningHint', { model: profile.name })}</span>
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {state.error}
          </div>
        )}

        {state.status === 'done' && (
          <>
            {state.imageUrl && (
              <img src={state.imageUrl} alt="" className="mb-1 max-h-32 w-full rounded-lg object-contain" />
            )}

            {/* 原图尺寸不写进提示词 —— 那是生成参数,不是提示词内容。
                但用户去生图时得知道该设什么比例,所以在这儿给出来 */}
            {dims && <div className="mb-3 text-[10px] text-ink-3">{t('detail.dimensions')} {dims}</div>}

            {/* 同一张图给不同模型用,写法差别很大,所以模型得能随时换 */}
            <div className="mb-3 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-[10px] text-neutral-400">{t('analyze.targetModel')}</span>
                <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                  {profile.group}
                </span>
              </div>
              <div className="flex gap-1.5">
                <Select
                  size="sm"
                  className="min-w-0 flex-1"
                  value={pickModel}
                  onChange={setPickModel}
                  options={MODEL_PROFILES.map((m) => ({
                    value: m.id,
                    label: m.name,
                    group: m.group,
                  }))}
                />
                <Button
                  size="sm"
                  square
                  disabled={pickModel === modelId}
                  onClick={() => onRegenerate(pickModel)}
                  title={t('analyze.regenerate')}
                  icon={<IconRefresh />}
                />
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">
                {t(getModelProfile(pickModel).hintKey)}
              </p>
            </div>

            <label className={labelCls}>{t('analyze.prompt')}</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              className={`${boxCls} mb-3`}
            />

            {profile.output.negative && (
              <>
                <label className={labelCls}>{t('analyze.negative')}</label>
                <textarea
                  value={negative}
                  onChange={(e) => setNegative(e.target.value)}
                  rows={2}
                  placeholder={t('analyze.negativePlaceholder')}
                  className={`${boxCls} mb-3`}
                />
              </>
            )}

            <label className={labelCls}>{t('analyze.tags')}</label>
            <div className="mb-1.5 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((x) => x !== tag))}
                    className="text-neutral-400 transition-colors hover:text-red-500"
                    title={t('detail.removeTag')}
                  >
                    <IconClose className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              {tags.length === 0 && <span className="text-[10px] text-neutral-400">{t('analyze.noTags')}</span>}
            </div>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTag();
              }}
              placeholder={t('analyze.tagPlaceholder')}
              className="w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-[11px] outline-none focus:border-accent dark:border-neutral-700"
            />
          </>
        )}
      </div>

      {state.status === 'done' && (
        <div className="flex gap-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
          <Button
            variant="primary"
            className="h-8 flex-1"
            disabled={!prompt.trim()}
            title={updating ? t('analyze.update') : t('analyze.save')}
            onClick={() => onSave({ prompt, negative, tags })}
            icon={<IconCheck />}
          >
            {updating ? t('analyze.update') : t('analyze.save')}
          </Button>
          <Button
            size="sm"
            square
            className="h-8 w-8"
            title={copied ? t('common.copied') : t('analyze.copyPromptText')}
            onClick={copy}
            icon={copied ? <IconCheck /> : <IconCopy />}
          />
        </div>
      )}
    </div>
  );
}
