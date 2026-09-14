import type { ReactNode } from 'react';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
}

export default function Switch({ checked, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center justify-between gap-3 text-left outline-none"
    >
      {label && <span className="text-[11px] text-ink-2">{label}</span>}
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] ${
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}
