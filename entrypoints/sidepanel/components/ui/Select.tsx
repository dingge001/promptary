import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconChevronDown } from '../icons';

export interface SelectOption {
  value: string;
  label: string;
  /** 可选分组名,有分组时弹层里会显示小标题 */
  group?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * 自定义下拉。
 *
 * 为什么不用原生 <select>:它展开后的选项列表由浏览器自己渲染,
 * CSS 几乎无法触及 —— 无论怎么调样式,拉开来还是系统那副样子。
 * 想让它长得像这个设计的一部分,只能自己画。
 *
 * 弹层走 Portal + fixed 定位:侧边栏的滚动容器会裁剪绝对定位的子元素,
 * 挂到 body 上才能保证不被截断。
 */
export default function Select({
  value,
  onChange,
  options,
  placeholder = '',
  size = 'md',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value);

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    const close = () => setOpen(false);
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    // 弹层是 fixed 定位、不跟随触发器,页面一滚就会飘在原地,所以要关掉。
    // 但必须排除弹层自身的滚动 —— capture 模式下这里能收到所有滚动事件,
    // 不区分来源的话,用户在列表里滚一下就等于自己把下拉关了。
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const groups = [...new Set(options.map((o) => o.group ?? ''))];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        // 宽度交给使用方:这里不能写死 w-full —— Tailwind 的 CSS 里 w-full
        // 排在 w-28 之类的具体宽度之后,会把使用方指定的宽度盖掉
        className={`flex items-center justify-between gap-2 rounded-lg border border-line-strong bg-transparent px-2 text-left text-ink transition-colors outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-accent-glow ${
          size === 'sm' ? 'h-6 text-[10px]' : 'h-7 text-[11px]'
        } ${className}`}
      >
        <span className={`truncate ${current ? '' : 'text-ink-3'}`}>
          {current?.label ?? placeholder}
        </span>
        <IconChevronDown
          className={`h-3 w-3 shrink-0 text-ink-3 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className="animate-fade-in z-[9999] max-h-60 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-[0_8px_28px_rgba(0,0,0,.18)]"
          >
            {groups.map((group) => (
              <div key={group}>
                {group && (
                  <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-medium text-ink-3">{group}</div>
                )}
                {options
                  .filter((o) => (o.group ?? '') === group)
                  .map((option) => {
                    const active = option.value === value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          onChange(option.value);
                          setOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                          active ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-neutral-100'
                        }`}
                      >
                        <span className="truncate">{option.label}</span>
                        {active && <IconCheck className="h-3 w-3 shrink-0" />}
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
