import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';
type Size = 'xs' | 'sm' | 'md';

/**
 * 按钮变体。
 *
 * primary 是全局唯一会「发光」的按钮(带朱砂光晕),一屏最多出现一次 ——
 * 强调色只有一处,视线焦点才成立。其余动作一律用次级或幽灵按钮。
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white shadow-[0_2px_10px_var(--accent-glow)] hover:bg-accent-hover active:scale-[.98]',
  // 静息态不加边框也不加底色,只在鼠标浮上来时才勾出轮廓 ——
  // 满屏的描边按钮会让界面显得碎
  secondary: 'border border-transparent text-ink hover:border-line-strong active:scale-[.98]',
  ghost: 'border border-transparent text-ink hover:border-line-strong',
  accent: 'border border-accent text-accent hover:bg-accent-soft',
  danger: 'border border-transparent text-red-500 hover:border-red-300 hover:bg-red-50 dark:hover:border-red-900/60 dark:hover:bg-red-950/40',
};

const SIZES: Record<Size, string> = {
  xs: 'h-5 gap-1 rounded-md px-1.5 text-[10px]',
  sm: 'h-6 gap-1 rounded-md px-2 text-[10px]',
  md: 'h-7 gap-1.5 rounded-lg px-2.5 text-[11px]',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** 放在文字前的图标 */
  icon?: ReactNode;
  /** 只放图标时的方形按钮 */
  square?: boolean;
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  square = false,
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center font-medium transition-all duration-200 ease-[cubic-bezier(.12,.23,.5,1)] outline-none focus-visible:ring-2 focus-visible:ring-accent-glow disabled:pointer-events-none disabled:opacity-40 ${
        VARIANTS[variant]
      } ${SIZES[size]} ${square ? 'aspect-square px-0' : ''} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}
