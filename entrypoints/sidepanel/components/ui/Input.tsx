import type { InputHTMLAttributes, ReactNode } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  /** 放在左侧的图标 */
  icon?: ReactNode;
  /** 右侧插槽,用于放显隐、复制这类行内操作 */
  suffix?: ReactNode;
}

const BASE =
  'w-full rounded-lg border border-line-strong bg-transparent text-[11px] text-ink transition-colors outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent-glow disabled:opacity-40';

export default function Input({ icon, suffix, className = '', ...rest }: Props) {
  if (!icon && !suffix) return <input {...rest} className={`${BASE} h-7 px-2 ${className}`} />;

  return (
    <div className={`relative ${className}`}>
      {icon && (
        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-3">
          {icon}
        </span>
      )}

      <input
        {...rest}
        className={`${BASE} h-7 ${icon ? 'pl-7' : 'pl-2'} ${suffix ? 'pr-14' : 'pr-2'}`}
      />

      {suffix && (
        <span className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
          {suffix}
        </span>
      )}
    </div>
  );
}
