import { useEffect, useState } from 'react';
import { categoryLabel, t } from '@/lib/i18n';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Category, PromptItem, Tag } from '@/lib/db/types';
import { getItem, softDeleteItem, toggleStar, updateItem } from '@/lib/db/repo';
import { useBlobUrl } from '@/lib/useBlobUrl';
import { formatDimensions } from '@/lib/vision/image';
import { getModelProfile, MODEL_PROFILES } from '@/lib/vision/models';
import {
  IconArrowLeft,
  IconClose,
  IconCopy,
  IconInject,
  IconSparkle,
  IconStar,
  IconTrash,
} from './icons';
import { Button, Select } from './ui';

interface Props {
  itemId: string;
  categories: Category[];
  tags: Tag[];
  onClose: () => void;
  /** 对这张图发起反推。带上用户选的模型,否则他不知道会按哪个模型重推 */
  onAnalyze: (item: PromptItem, modelId: string) => void;
  /** 设置里的默认模型,用作选择器的初值 */
  defaultModelId: string;
}

export default function ItemDetail({
  itemId,
  categories,
  tags,
  onClose,
  onAnalyze,
  defaultModelId,
}: Props) {
  // 订阅式读取:在别处修改了这条记录,详情页会自动刷新
  const item = useLiveQuery(() => getItem(itemId), [itemId]);
  const imageUrl = useBlobUrl(item?.imageBlob);

  const [toast, setToast] = useState<string>();
  const [tagInput, setTagInput] = useState('');
  // 优先沿用这条记录当初用的模型,用户想换再换
  const [pickModel, setPickModel] = useState(defaultModelId);

  // item 是订阅式异步读取的,拿到之后才知道这条当初用的哪个模型。
  // 沿用它可以避免用户每点一次「重新反推」都被拽回默认模型。
  useEffect(() => {
    if (item?.targetModel) setPickModel(item.targetModel);
  }, [item?.targetModel]);

  // 记录被删除后自动关掉详情,避免停留在一个已经不存在的条目上
  useEffect(() => {
    if (item?.deletedAt) onClose();
  }, [item?.deletedAt, onClose]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 1600);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!item) return null;

  const tagNames = item.tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter((n): n is string => Boolean(n));

  const copy = async (text: string | undefined, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setToast(t('detail.copiedLabel', { label }));
    } catch {
      setToast(t('detail.copyFailedManual'));
    }
  };

  const addTag = async () => {
    const name = tagInput.trim();
    if (!name) return;
    await updateItem(itemId, { tagNames: [...tagNames, name] });
    setTagInput('');
  };

  const removeTag = async (name: string) => {
    await updateItem(itemId, { tagNames: tagNames.filter((n) => n !== name) });
  };

  /** 把提示词注入当前页面的输入框 —— 生图工具通常就在旁边那个标签页 */
  const injectToPage = async () => {
    const text = item.prompt?.prompt ?? '';
    if (!text) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;

    try {
      const res = (await chrome.tabs.sendMessage(tab.id, {
        type: 'insertPrompt',
        text,
      })) as { ok: boolean; message: string } | undefined;
      setToast(res?.ok ? t('detail.injected') : (res?.message ?? t('detail.injectFailed')));
    } catch {
      // 扩展刚安装或刚更新时,已打开的页面里还没有 content script
      setToast(t('detail.injectFailed'));
    }
  };

  const p = item.prompt;
  const dims = formatDimensions(item.width, item.height);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex items-center gap-1.5 border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">
        <Button size="sm" square onClick={onClose} title={t('common.back')} icon={<IconArrowLeft />} />
        <div className="flex-1" />
        <Button
          size="sm"
          square
          variant={item.starred ? 'accent' : 'secondary'}
          onClick={() => toggleStar(itemId)}
          title={item.starred ? t('card.unstar') : t('card.star')}
          icon={<IconStar filled={item.starred} />}
        />
        <Button
          size="sm"
          square
          variant="danger"
          title={t('card.delete')}
          icon={<IconTrash />}
          onClick={() => {
            // 软删除而已,回收站随时能捞回来 —— 能撤销的操作不该拿确认框挡一道
            softDeleteItem(itemId);
            onClose();
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {imageUrl && (
          <img src={imageUrl} alt={item.title} className="mb-3 w-full rounded-lg object-contain" />
        )}

        <input
          value={item.title}
          onChange={(e) => updateItem(itemId, { title: e.target.value })}
          className="mb-1 w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-sm font-medium outline-none hover:border-neutral-200 focus:border-accent dark:hover:border-neutral-700"
        />

        {/* 记下原图尺寸,用户去生图时才知道该设什么比例 ——
            这张信息不写进提示词(那是生成参数不是提示词内容) */}
        {dims && (
          <div className="mb-3 px-1 text-[10px] text-ink-3">
            {t('detail.dimensions')} {dims}
          </div>
        )}

        <div className="mb-3 flex flex-nowrap items-center gap-1.5">
          <Button
            size="sm"
            square
            title={t('detail.copyPrompt')}
            icon={<IconCopy />}
            onClick={() => copy(p?.prompt, t('detail.prompt'))}
          />
          {p?.negative && (
            <Button
              size="sm"
              square
              title={t('detail.copyNegative')}
              icon={<IconCopy />}
              onClick={() => copy(p.negative, t('detail.negative'))}
            />
          )}
          <Button
            size="sm"
            square
            title={t('detail.inject')}
            icon={<IconInject />}
            onClick={injectToPage}
          />
                  {/* 反推按哪个模型的格式生成,得让用户看得见也改得了 ——
              塞在设置里的话,用户点「重新反推」根本不知道会走哪个。
              下拉用固定窄宽度而不是 flex-1,否则会把这一行撑到换行 */}
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
            variant="accent"
            title={item.prompt ? t('detail.reanalyze') : t('detail.analyze')}
            icon={<IconSparkle />}
            onClick={() => onAnalyze(item, pickModel)}
          >
            {item.prompt ? t('detail.reanalyzeShort') : t('detail.analyzeShort')}
          </Button>
        </div>

        {p?.prompt && (
          <>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-neutral-400">{t('detail.prompt')}</span>
              {item.targetModel && (
                <span className="rounded bg-accent-soft px-1 py-0.5 text-[9px] text-accent">
                  {getModelProfile(item.targetModel).name}
                </span>
              )}
            </div>
            <div className="mb-3 rounded-lg bg-neutral-100 p-2 text-[11px] leading-relaxed select-all dark:bg-neutral-900">
              {p.prompt}
            </div>
          </>
        )}

        {p?.negative && (
          <>
            <div className="mb-1 text-[10px] font-medium text-neutral-400">{t('detail.negative')}</div>
            <div className="mb-3 rounded-lg bg-neutral-100 p-2 text-[11px] leading-relaxed select-all dark:bg-neutral-900">
              {p.negative}
            </div>
          </>
        )}

        <div className="mb-1 text-[10px] font-medium text-neutral-400">{t('detail.category')}</div>
        <Select
          className="mb-3 w-full"
          value={item.categoryId ?? ''}
          onChange={(v) => updateItem(itemId, { categoryId: v || undefined })}
          options={[
            { value: '', label: t('detail.uncategorized') },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />

        <div className="mb-1 text-[10px] font-medium text-neutral-400">{t('detail.tags')}</div>
        <div className="mb-2 flex flex-wrap gap-1">
          {tagNames.map((name) => (
            <span
              key={name}
              className="group flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800"
            >
              {name}
              <button
                type="button"
                onClick={() => removeTag(name)}
                className="text-neutral-400 transition-colors hover:text-red-500"
                title={t('detail.removeTag')}
              >
                <IconClose className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTag();
          }}
          placeholder={t('detail.tagPlaceholder')}
          className="mb-3 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-[11px] outline-none focus:border-accent dark:border-neutral-700"
        />

        <div className="mb-1 text-[10px] font-medium text-neutral-400">{t('detail.note')}</div>
        <textarea
          value={item.note ?? ''}
          onChange={(e) => updateItem(itemId, { note: e.target.value })}
          rows={2}
          className="mb-3 w-full resize-none rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-[11px] outline-none focus:border-accent dark:border-neutral-700"
        />

        {(item.sourceUrl || item.imageUrl) && (
          <div className="mb-2 text-[10px] leading-relaxed text-neutral-400">
            {t('detail.source')}:
            <a
              href={item.sourceUrl || item.imageUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-accent hover:underline"
            >
              {item.sourceUrl || item.imageUrl}
            </a>
          </div>
        )}
      </div>

      {toast && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-ink px-3 py-1.5 text-[11px] text-canvas shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
