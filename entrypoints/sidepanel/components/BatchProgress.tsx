import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { BATCH_JOB_KEY, type BatchJob } from '@/lib/messages';
import { IconCheck, IconClose } from './icons';
import { Button } from './ui';

interface Props {
  onClose: () => void;
}

/**
 * 批量反推进度。
 *
 * 进度不靠后台推消息,而是侧边栏直接监听 storage.session ——
 * 这样即使用户中途关掉侧边栏再打开,也依然能看到任务还在跑、跑到哪了。
 */
export default function BatchProgress({ onClose }: Props) {
  const [job, setJob] = useState<BatchJob | null>(null);

  useEffect(() => {
    chrome.storage.session.get(BATCH_JOB_KEY).then((raw) => {
      setJob((raw[BATCH_JOB_KEY] as BatchJob) ?? null);
    });

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      const next = changes[BATCH_JOB_KEY]?.newValue as BatchJob | undefined;
      if (next) setJob(next);
    };

    chrome.storage.session.onChanged.addListener(onChanged);
    return () => chrome.storage.session.onChanged.removeListener(onChanged);
  }, []);

  if (!job) return null;

  const running = job.status === 'running';
  const pct = Math.round((job.done / Math.max(1, job.total)) * 100);

  const close = async () => {
    // 任务已结束,把结果清掉,免得下次打开侧边栏又弹出来
    await chrome.storage.session.remove(BATCH_JOB_KEY);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full rounded-xl bg-white p-4 shadow-xl dark:bg-neutral-900">
        <div className="mb-2.5 text-xs font-medium">
          {running ? t('batch.running') : job.status === 'cancelled' ? t('batch.cancelled') : t('batch.done')}
        </div>

        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mb-3 text-[11px] text-neutral-500">
          {t('batch.progress', { done: job.done, total: job.total, saved: job.saved })}
          {job.failed.length > 0 && t('batch.failedCount', { count: job.failed.length })}
        </div>

        {job.status === 'error' && job.error && (
          <div className="mb-3 rounded-md bg-red-50 p-2 text-[10px] leading-relaxed text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {job.error}
          </div>
        )}

        {job.failed.length > 0 && (
          <details className="mb-3">
            <summary className="cursor-pointer text-[10px] text-neutral-400">{t('batch.viewErrors')}</summary>
            <div className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
              {job.failed.map((f, i) => (
                <div key={i} className="truncate text-[10px] text-red-500" title={f.error}>
                  {f.error}
                </div>
              ))}
            </div>
          </details>
        )}

        {running ? (
          <Button
            className="h-8 w-full"
            title={t('batch.cancelHint')}
            icon={<IconClose />}
            onClick={() => chrome.runtime.sendMessage({ type: 'cancelBatch' })}
          >
            {t('batch.cancel')}
          </Button>
        ) : (
          <Button variant="primary" className="h-8 w-full" icon={<IconCheck />} onClick={close}>
            {t('common.done')}
          </Button>
        )}
      </div>
    </div>
  );
}
