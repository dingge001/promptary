import { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  exportAsFile,
  exportToDirectory,
  importBackup,
  supportsDirectoryPicker,
} from '@/lib/backup';
import { getStats, recalcTagCounts } from '@/lib/db/repo';
import { IconCopy, IconDownload, IconFolder, IconUpload } from './icons';
import { Button, Checkbox } from './ui';

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 「数据与存储」区块。
 *
 * 存在的理由:用户把几百张图和提示词交给这个扩展,有权知道它们到底在哪、
 * 占了多少空间、怎么拿出来。含糊其辞的工具没人敢往里存东西。
 */
export default function DataSection() {
  const stats = useLiveQuery(() => getStats(), []);
  const [usage, setUsage] = useState<StorageEstimate>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [includeImages, setIncludeImages] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const canPickDir = supportsDirectoryPicker();

  // 数据量一变就重新量一次占用,数字才不会停在旧值上
  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then(setUsage)
      .catch(() => setUsage(undefined));
  }, [stats]);

  const extId = chrome.runtime.id;
  const dataPath = `%LOCALAPPDATA%\\Google\\Chrome\\User Data\\<配置文件>\\IndexedDB\\chrome-extension_${extId}_0.indexeddb.leveldb`;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      setMessage({ ok: true, text: await fn() });
    } catch (err) {
      const e = err as Error;
      // 用户在系统弹窗里点了取消,不是错误,不该弹红字
      if (e?.name === 'AbortError') return;
      setMessage({ ok: false, text: t('data.exportFailed', { message: e.message }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-5">
      <h2 className="mb-2 text-xs font-semibold">{t('data.title')}</h2>

      <div className="mb-2 rounded-lg bg-neutral-100 p-2.5 text-[10px] leading-relaxed dark:bg-neutral-900">
        <div className="mb-1 flex justify-between gap-2">
          <span className="text-neutral-400">{t('data.location')}</span>
          <span>{t('data.locationValue')}</span>
        </div>
        <div className="mb-1 flex justify-between gap-2">
          <span className="text-neutral-400">{t('data.usage')}</span>
          <span>{usage ? formatBytes(usage.usage ?? 0) : t('data.calculating')}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-neutral-400">{t('data.items')}</span>
          <span>
            {stats
              ? `t('data.itemsValue', { total: stats.itemCount, images: stats.imageCount, texts: stats.textCount })`
              : '…'}
          </span>
        </div>
      </div>

      <p className="mb-2 text-[10px] leading-relaxed text-neutral-400">
        {t('data.pathHint')}
      </p>

      <div className="mb-1 text-[10px] font-medium text-neutral-400">{t('data.path')}</div>
      <div className="mb-1.5 rounded-md bg-neutral-100 p-2 text-[10px] leading-relaxed break-all dark:bg-neutral-900">
        {dataPath}
      </div>
      <Button
        size="sm"
        className="mb-3"
        title={t('data.copyPath')}
        icon={<IconCopy />}
        onClick={async () => {
          await navigator.clipboard.writeText(dataPath);
          setMessage({ ok: true, text: t('data.pathCopied') });
        }}
      />

      <div className="mb-1 text-[10px] font-medium text-neutral-400">{t('data.export')}</div>
      <div className="mb-2">
        <Checkbox
          checked={includeImages}
          onChange={setIncludeImages}
          label={t('data.includeImages')}
        />
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          disabled={busy}
          title={t('data.exportFile')}
          icon={<IconDownload />}
          onClick={() =>
            run(async () => {
              await exportAsFile(includeImages);
              return t('data.exportStarted');
            })
          }
        />

        {canPickDir && (
          <Button
            size="sm"
            disabled={busy}
            title={t('data.exportFolder')}
            icon={<IconFolder />}
            onClick={() =>
              run(async () => {
                const res = await exportToDirectory();
                return t('data.exportedTo', { count: res.images });
              })
            }
          />
        )}
      </div>

      <div className="mb-1 text-[10px] font-medium text-neutral-400">{t('data.import')}</div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // 清空 value,同一个文件才能被重复选择
          e.target.value = '';
          if (!file) return;
          void run(async () => {
            const res = await importBackup(file);
            // 导入只做了 id 去重,标签引用计数得整体重算一次才准
            await recalcTagCounts();
            const skipped = res.skipped ? t('data.importSkipped', { count: res.skipped }) : '';
            return t('data.importDone', { items: res.items, tags: res.tags, categories: res.categories, skipped });
          });
        }}
      />
      <Button
        size="sm"
        disabled={busy}
        title={t('data.chooseFile')}
        icon={<IconUpload />}
        onClick={() => fileRef.current?.click()}
      />
      <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">
        {t('data.importHint')}
      </p>

      {message && (
        <div
          className={`mt-2 rounded-md p-2 text-[10px] leading-relaxed ${
            message.ok
              ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400'
              : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}
    </section>
  );
}
