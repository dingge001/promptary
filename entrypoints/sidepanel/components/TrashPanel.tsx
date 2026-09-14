import { useLiveQuery } from 'dexie-react-hooks';
import { t } from '@/lib/i18n';
import { emptyTrash, hardDeleteItem, listDeletedItems, restoreItem } from '@/lib/db/repo';
import { useBlobUrl } from '@/lib/useBlobUrl';
import { IconRestore, IconTrash } from './icons';
import { Button } from './ui';

function formatTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 回收站。删除的收藏先落这里,给用户一个反悔的机会 */
export default function TrashPanel() {
  const items = useLiveQuery(() => listDeletedItems(), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <span className="text-xs font-medium">{t('trash.title')}</span>
        <div className="flex gap-1.5">
          {Boolean(items?.length) && (
            <Button
              size="sm"
              square
              variant="danger"
              title={t('trash.clear', { count: items?.length ?? 0 })}
              icon={<IconTrash />}
              onClick={async () => {
                if (!confirm(t('trash.clearConfirm', { count: items?.length ?? 0 })))
                  return;
                await emptyTrash();
              }}
            />
          )}
          
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {!items?.length ? (
          <p className="px-2 py-4 text-[11px] leading-relaxed text-neutral-400">
            {t('trash.empty')}
            <br />
            {t('trash.emptyHint')}
          </p>
        ) : (
          <div className="space-y-1.5">
            {items.map((item) => (
              <TrashRow key={item.id} id={item.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TrashRow({ id }: { id: string }) {
  // 直接按 id 订阅,恢复或删除后本行会自动消失
  const item = useLiveQuery(() => listDeletedItems().then((all) => all.find((i) => i.id === id)), [id]);
  const thumbUrl = useBlobUrl(item?.thumbnailBlob);

  if (!item) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 p-1.5 dark:border-neutral-800">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[9px] text-neutral-400">{t('card.text')}</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px]">{item.title}</div>
        <div className="text-[10px] text-neutral-400">{t('trash.deletedAt', { time: formatTime(item.deletedAt) })}</div>
      </div>

      <Button
        size="sm"
        square
        variant="accent"
        title={t('common.restore')}
        icon={<IconRestore />}
        onClick={() => restoreItem(id)}
      />
      <Button
        size="sm"
        square
        variant="danger"
        title={t('trash.deleteForever')}
        icon={<IconTrash />}
        onClick={() => {
          if (confirm(t('trash.deleteConfirm'))) hardDeleteItem(id);
        }}
      />
    </div>
  );
}
