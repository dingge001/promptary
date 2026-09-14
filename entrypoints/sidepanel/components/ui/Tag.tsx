import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 传了就显示删除按钮 */
  onRemove?: () => void;
  /** 选中态:朱砂实心 */
  active?: boolean;
  /** 传了整块就变成可点击的 */
  onClick?: () => void;
  /** 删除按钮的 tooltip */
  removeTitle?: string;
  className?: string;
}

/** 胶囊标签。筛选栏、标签列表、分类 chips 共用 */
export default function Tag({
  children,
  onRemove,
  active,
  onClick,
  removeTitle = '',
  className = '',
}: Props) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors duration-150 ${
        active ? 'bg-accent text-white' : 'bg-neutral-100 text-ink-2'
      } ${onClick ? 'cursor-pointer hover:bg-accent-soft hover:text-accent' : ''} ${className}`}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="opacity-60 transition-opacity hover:text-red-500 hover:opacity-100"
          title={removeTitle}
        >
          ×
        </button>
      )}
    </span>
  );
}