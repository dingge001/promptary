import type { TextareaHTMLAttributes } from 'react';

export default function Textarea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={`w-full resize-none rounded-lg border border-line-strong bg-transparent p-2 text-[11px] leading-relaxed text-ink transition-colors outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent-glow ${className}`}
    />
  );
}
