import { t } from '@/lib/i18n';
import type { PromptItem } from '@/lib/db/types';
import { useBlobUrl } from '@/lib/useBlobUrl';
import { IconCheck, IconStar, IconTrash } from './icons';

interface Props {
  item: PromptItem;
  onOpen: (item: PromptItem) => void;
  onDelete: (item: PromptItem) => void;
  onToggleStar: (item: PromptItem) => void;
  /** 批量选择模式:点击卡片变成切换选中,悬停操作按钮让位 */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (item: PromptItem) => void;
}

/** 悬停时浮现的小操作按钮。图片内容颜色不可控,所以给按钮加深色底才看得清 */
const actionBtn =
  'flex h-5 w-5 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-[2px] transition-colors';

/** 库里的单个收藏项。图片优先用缩略图,文字项退化为纯文本卡片 */
export default function ItemCard({
  item,
  onOpen,
  onDelete,
  onToggleStar,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: Props) {
  const thumbUrl = useBlobUrl(item.thumbnailBlob);
  const isText = item.source === 'text';

  return (
    <div
      className={`group relative aspect-square overflow-hidden rounded-lg border bg-neutral-100 transition-colors dark:bg-neutral-900 ${
        selected
          ? 'border-accent ring-2 ring-accent-glow'
          : item.starred
            ? 'border-accent/40'
            : 'border-neutral-200 hover:border-accent dark:border-neutral-800'
      }`}
    >
      {/* 封面单独做成按钮,操作按钮才不会被嵌进 button 里(HTML 不允许按钮套按钮) */}
      <button
        type="button"
        onClick={() => (selectMode ? onToggleSelect?.(item) : onOpen(item))}
        title={item.title}
        className="absolute inset-0 h-full w-full text-left"
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col justify-center gap-1 p-2">
            <span className="text-[10px] font-medium text-accent">{isText ? t('card.text') : t('card.image')}</span>
            <span className="line-clamp-4 text-[10px] leading-snug text-ink-2">
              {item.prompt?.prompt || item.title}
            </span>
          </div>
        )}

        <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-3 pb-1 text-[10px] leading-tight text-white opacity-0 transition-opacity group-hover:opacity-100">
          {item.title}
        </span>
      </button>

      {/* 选择模式下的勾选标记 */}
      {selectMode && (
        <span
          className={`pointer-events-none absolute top-1 left-1 flex h-4 w-4 items-center justify-center rounded-full border-2 transition-colors ${
            selected ? 'border-accent bg-accent text-white' : 'border-white/80 bg-black/35'
          }`}
        >
          {selected && <IconCheck className="h-2.5 w-2.5" />}
        </span>
      )}

      {/* 两个按钮各管各的透明度:星标已选中时常驻(状态要一眼看得见),
          删除则一律只在悬停时出现。选择模式下整体让位,免得和勾选打架 */}
      <div className={`absolute top-1 right-1 flex gap-0.5 ${selectMode ? 'hidden' : ''}`}>
        {/* 删除在前、星标在后 —— flex 里最后一个贴右边,收藏图标才能占住右上角 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
          title={t('card.delete')}
          className={`${actionBtn} opacity-0 group-hover:opacity-100 hover:bg-red-600`}
        >
          <IconTrash className="h-3 w-3" />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar(item);
          }}
          title={item.starred ? t('card.unstar') : t('card.star')}
          className={`${actionBtn} ${
            item.starred ? 'text-amber-400' : 'opacity-0 group-hover:opacity-100'
          } hover:bg-black/75`}
        >
          <IconStar filled={item.starred} className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
