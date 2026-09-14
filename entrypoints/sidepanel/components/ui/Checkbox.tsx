import type { ReactNode } from 'react';
import { IconCheck } from '../icons';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  className?: string;
}

/**
 * 自定义复选框。
 * 原生 checkbox 在不同平台渲染差异很大(Windows 上尤其方正),
 * 和这套圆角柔和的设计放一起会格格不入。
 */
export default function Checkbox({ checked, onChange, label, className = '' }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`group flex items-center gap-2 text-left outline-none ${className}`}
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-all duration-150 ${
          checked ? 'border-accent bg-accent text-white' : 'border-line-strong group-hover:border-accent'
        }`}
      >
        {checked && <IconCheck className="h-2.5 w-2.5" />}
      </span>
      {label && <span className="text-[11px] text-ink-2">{label}</span>}
    </button>
  );
}
